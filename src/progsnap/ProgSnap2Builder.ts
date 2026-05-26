
import { EditList, EditListBuilder, EditRange, IChangeEvent } from "../index";
import { FileEditEvent, isFileCopyTextEvent, isFileEditEvent, MainTableEvent } from "./PS2EventTypes";

export namespace PS2 {

    export type EditedRange = {
        start: number;
        end: number;
    }

    export type AnnotatedDocument = {
        edits: EditRange[];
        errors: any[][];
        isInternallyConsistent: boolean;
    }

    export type EditHistoryFrame = AnnotatedDocument & {
        eventIDs: string[];
        editedRanges: EditedRange[];
        wasInsertion: boolean;
        wasDeletion: boolean;
        currentClipboard: string;
    }

    export type BuilderOptions = {
        addHistory?: boolean;
        newLineMode?: NewlineMode;
    }

    export type NonHistoryBuilderOptions = Omit<BuilderOptions, 'addHistory'>;

    export function createEditList(events: MainTableEvent[], options?: NonHistoryBuilderOptions): AnnotatedDocument {
        return createEditListLogic(events, { ...options, addHistory: false }) as AnnotatedDocument;
    }

    export function createEditHistory(events: MainTableEvent[], options?: NonHistoryBuilderOptions): EditHistoryFrame[] {
        return createEditListLogic(events, { ...options, addHistory: true }) as EditHistoryFrame[];
    }

    function createEditListLogic(events: MainTableEvent[], options: BuilderOptions): readonly EditHistoryFrame[] | AnnotatedDocument {
        const builder = new Builder(options.addHistory, options.newLineMode);
        builder.addEvents(events);
        return options.addHistory ? builder.getHistory() : {
            edits: builder.getEditsCopy(),
            errors: builder.errors.slice(),
            isInternallyConsistent: builder.editList.isInternallyConsistent(),
        };
    }

    export enum NewlineMode {
        UseSource,
        AddLineFeed,
        AutoDetect
    }

    export class Builder {
        public readonly editListBuilder = new EditListBuilder(new EditList());
        public readonly editList = this.editListBuilder.editList;
        private readonly history: EditHistoryFrame[] = [];
        // Used to keep track of events we haven't added to the history yet
        private readonly unrecordedEvents: MainTableEvent[] = [];
        // We track the last recorded error index so we can get just the
        // errors for the current frame when building history
        private lastRecordedErrorLength = 0;
        public readonly errors: any[][] = [];
        private currentClipboard: string = '';

        private detectedLinefeed = false;

        private get shouldAddLineFeed() {
            return this.newLineMode === NewlineMode.AddLineFeed ||
                (this.newLineMode === NewlineMode.AutoDetect && this.detectedLinefeed);
        }

        constructor(
            public readonly addHistory = false,
            public readonly newLineMode = NewlineMode.UseSource) {
        }

        public getHistory(): readonly EditHistoryFrame[] {
            return this.history;
        }

        public getEditsCopy() {
            return this.editList.copyEdits();
        }

        public addEventsUnsafe(events: object[]) {
            events.forEach((event) => {
                this.addEventUnsafe(event);
            });
        }

        public addEventUnsafe(event: object): MainTableEvent | undefined {
            try {
                const parsedEvent = MainTableEvent.parse(event);
                this.addEvent(parsedEvent);
                return parsedEvent;
            } catch (e) {
                this.editListBuilder.logError("Failed to parse event:", event, e);
            }
            return undefined;
        }

        private detectNeedForLineFeed(events: MainTableEvent[]) {
            let newlines = 0;
            let linefeeds = 0;
            for (const event of events) {
                if (isFileEditEvent(event) && event.EditType === 'Insert') {
                    const insertedText = event.InsertText || '';
                    if (insertedText.includes('\n')) {
                        newlines++;
                    }
                    if (insertedText.includes('\r')) {
                        linefeeds++;
                    }
                }
            }
            if (linefeeds > 0) {
                this.detectedLinefeed = true;
            }
            if (linefeeds > 0 && linefeeds < newlines) {
                // TODO: Figure out what to do here...
                console.warn(`Detected mix of newlines and linefeeds in inserted text. Newlines: ${newlines}, Linefeeds: ${linefeeds}. Defaulting to adding linefeeds.`);
            }
        }

        public addEvents(events: MainTableEvent[]) {
            if (this.newLineMode === NewlineMode.AutoDetect) {
                this.detectNeedForLineFeed(events);
            }
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                const childEvents: MainTableEvent[] = [];
                for (let j = i + 1; j < events.length; j++) {
                    const nextEvent = events[j];
                    if (event.EventID === nextEvent.ParentEventID) {
                        childEvents.push(nextEvent);
                        i = j; // Move the outer loop index to skip over child events
                    } else {
                        break;
                    }
                }
                this.addEvent(event, childEvents);
            }
        }

        // Private because we might have multiple events with the same
        // parent, so those need to be processed together
        private addEvent(event: MainTableEvent, childEvents: MainTableEvent[] = []) {
            const builder = this.editListBuilder;

            builder.editList.logError = (...args: any[]) => {
                console.error(...args);
                this.errors.push(args);
            }

            if (!event) {
                builder.logError("Event is undefined or null");
                return;
            }

            if (this.addHistory) {
                this.unrecordedEvents.push(event);
                this.unrecordedEvents.push(...childEvents);
            }

             // parse event.ClientTimestamp as ISO string
            const time = new Date(event?.ClientTimestamp || '').getTime();

            // If we're given the exact code, we should just update the document text

            if (event.Code) {
                let code = event.Code;
                if (this.shouldAddLineFeed) {
                    code = code.replace(/\n/g, '\r\n');
                }
                if (builder.editList.isEmpty()) {
                    builder.editList.setInitialText(code, time);
                }

                const status = builder.verifyDocumentText(code, time, true);
                // console.log(`Status: ${status}; Resetting text for ${event.CodeStateSection} to`, code);
                return;
            }

            // TODO: Handle copied text from other documents!
            if (isFileCopyTextEvent(event)) {
                let sourceLocation = event.SourceLocation ? parseInt(event.SourceLocation) : undefined;
                if (sourceLocation !== undefined && isNaN(sourceLocation)) {
                    sourceLocation = undefined;
                }
                builder.addCopyEvent(event.CopiedText, sourceLocation);
                this.currentClipboard = event.CopiedText;
                // console.log('Copy!', event.CopiedText, event, builder.lastCopiedText, builder.lastCopiedTextMatch);
                return;
            }

            if (!isFileEditEvent(event)) {
                return;
            }

            const isUndoOrRedo = event.EditType === 'Undo' || event.EditType === 'Redo';

            const allEvents: FileEditEvent[] = [event];

            for (const child of childEvents) {
                if (!isFileEditEvent(child)) {
                    builder.logError("Child events must share EventTypes", event, child);
                    continue;
                }
                const isChildUndoOrRedo = child.EditType === 'Undo' || child.EditType === 'Redo';
                if (isUndoOrRedo !== isChildUndoOrRedo) {
                    builder.logError("Mismatched Undo/Redo between parent and child events", event, child);
                    continue;
                }
                allEvents.push(child);
            }

            // If we know this event was a paste, make sure the builder registers
            // the the inserted text was copied before we add the edit event.
            if (event.EditType === 'Paste' && event.InsertText) {
                // Note: we don't count empty copies
                builder.addCopyEvent(event.InsertText);
                this.currentClipboard = event.InsertText;
            }

            const changeEvents = allEvents.map(e => this.getChangeEvent(e));

            builder.addEditEvent({
                time: time,
                contentChanges: changeEvents,
                isUndoOrRedo: isUndoOrRedo,
            });

            if (!this.addHistory) {
                return;
            }

            // Get just the errors for this frame
            const errors = this.errors.slice(this.lastRecordedErrorLength);
            this.lastRecordedErrorLength = this.errors.length;

            const eventIDs = this.unrecordedEvents.map(e => e.EventID || '');
            this.unrecordedEvents.length = 0; // Clear the unrecorded events
            this.history.push({
                eventIDs: eventIDs,
                edits: builder.editList.copyEdits(),
                editedRanges: changeEvents.map(ce => this.getEditedRange(ce)),
                wasInsertion: changeEvents.some(ce => ce.text.length > 0),
                wasDeletion: changeEvents.some(ce => ce.rangeLength > 0),
                isInternallyConsistent: builder.editList.isInternallyConsistent(),
                errors: errors,
                currentClipboard: this.currentClipboard,
            });
        }

        private getEditedRange(changeEvent: IChangeEvent) {
            return {
                start: changeEvent.rangeOffset,
                end: changeEvent.rangeOffset + changeEvent.text.length,
            };
        }

        private getChangeEvent(event: FileEditEvent): IChangeEvent {
            const insertedText = event.InsertText || '';
            const deletedLength = event.DeleteText?.length || event?.DeleteLength || 0;
            const rangeOffset = parseInt(event.SourceLocation!);

            return {
                text: insertedText,
                rangeOffset,
                rangeLength: deletedLength,
            };
        }
    }
}