
import { EditList, EditListBuilder, EditRange, IChangeEvent } from "../index";
import { FileEditEvent, isFileCopyTextEvent, isFileEditEvent, MainTableEvent } from "./PS2EventTypes";

export namespace PS2 {

    export type EditedRange = {
        start: number;
        end: number;
    }

    export type EditHistoryFrame = {
        eventIDs: string[];
        edits: EditRange[];
        editedRanges: EditedRange[];
        wasInsertion: boolean;
        wasDeletion: boolean;
        isInternallyConsistent: boolean;
    }

    export type BuilderOptions = {
        addHistory?: boolean;
        newLineMode?: NewlineMode;
    }

    export type NonHistoryBuilderOptions = Omit<BuilderOptions, 'addHistory'>;

    export function createEditList(events: MainTableEvent[], options?: NonHistoryBuilderOptions): EditRange[] {
        return createEditListLogic(events, { ...options, addHistory: false }) as EditRange[];
    }

    export function createEditHistory(events: MainTableEvent[], options?: NonHistoryBuilderOptions): EditHistoryFrame[] {
        return createEditListLogic(events, { ...options, addHistory: true }) as EditHistoryFrame[];
    }

    function createEditListLogic(events: MainTableEvent[], options: BuilderOptions): readonly EditHistoryFrame[] | EditRange[] {
        const builder = new Builder(options.addHistory, options.newLineMode);
        builder.addEvents(events);
        return options.addHistory ? builder.getHistory() : builder.getEditsCopy();
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
                console.error("Failed to parse event:", event, e);
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
            if (!event) {
                console.error("Event is undefined or null");
                return;
            }

            if (this.addHistory) {
                this.unrecordedEvents.push(event);
                this.unrecordedEvents.push(...childEvents);
            }

            const builder = this.editListBuilder;
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
                builder.addCopyEvent(event.CopiedText);
                return;
            }

            if (!isFileEditEvent(event)) {
                return;
            }

            const isUndoOrRedo = event.EditType === 'Undo' || event.EditType === 'Redo';

            const allEvents: FileEditEvent[] = [event];

            for (const child of childEvents) {
                if (!isFileEditEvent(child)) {
                    console.error("Child events must share EventTypes", event, child);
                    continue;
                }
                const isChildUndoOrRedo = child.EditType === 'Undo' || child.EditType === 'Redo';
                if (isUndoOrRedo !== isChildUndoOrRedo) {
                    console.error("Mismatched Undo/Redo between parent and child events", event, child);
                    continue;
                }
                allEvents.push(child);
            }

            // If we know this event was a paste, make sure the builder registers
            // the the inserted text was copied before we add the edit event.
            if (event.EditType === 'Paste' && event.InsertText) {
                // Note: we don't count empty copies
                builder.addCopyEvent(event.InsertText);
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
            const eventIDs = this.unrecordedEvents.map(e => e.EventID || '');
            this.unrecordedEvents.length = 0; // Clear the unrecorded events
            this.history.push({
                eventIDs: eventIDs,
                edits: builder.editList.copyEdits(),
                editedRanges: changeEvents.map(ce => this.getEditedRange(ce)),
                wasInsertion: changeEvents.some(ce => ce.text.length > 0),
                wasDeletion: changeEvents.some(ce => ce.rangeLength > 0),
                isInternallyConsistent: builder.editList.isInternallyConsistent(),
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