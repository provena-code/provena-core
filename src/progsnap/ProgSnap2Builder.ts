
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

    export function createEditHistory(events: MainTableEvent[], options?: NonHistoryBuilderOptions): readonly EditHistoryFrame[] {
        return createEditListLogic(events, { ...options, addHistory: true }) as readonly EditHistoryFrame[];
    }

    export async function createEditHistoryAsync(events: MainTableEvent[], yielder: () => Promise<any>, options?: NonHistoryBuilderOptions): Promise<readonly EditHistoryFrame[]> {
        const builder = new Builder(true, options?.newLineMode);
        await builder.addEventsAsync(events, yielder);
        return builder.getHistory();
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

    type EventWithChildren = {
        event: MainTableEvent;
        childEvents: MainTableEvent[];
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

        private detectNeedForLineFeedIfNeeded(events: MainTableEvent[]) {
            if (this.newLineMode !== NewlineMode.AutoDetect) {
                return;
            }
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

        private extractEventsWithChildren(events: MainTableEvent[]): EventWithChildren[] {
            const eventsWithChildren: EventWithChildren[] = [];
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
                eventsWithChildren.push({ event, childEvents });
            }
            return eventsWithChildren;
        }

        public async addEventsAsync(events: MainTableEvent[], yielder: () => Promise<void>) {
            this.detectNeedForLineFeedIfNeeded(events);
            const eventsWithChildren = this.extractEventsWithChildren(events);
            let tick = 0;
            for (let i = 0; i < eventsWithChildren.length;) {
                const event = eventsWithChildren[i];
                const nextEvent = eventsWithChildren[i + 1];
                i += this.addEventAndPossiblyNextAndSwap(event, nextEvent);
                if (tick++ % 100 === 0) {
                    await yielder();
                }
            }
        }

        public addEvents(events: MainTableEvent[]) {
            this.detectNeedForLineFeedIfNeeded(events);
            const eventsWithChildren = this.extractEventsWithChildren(events);
            for (let i = 0; i < eventsWithChildren.length;) {
                const event = eventsWithChildren[i];
                const nextEvent = eventsWithChildren[i + 1];
                i += this.addEventAndPossiblyNextAndSwap(event, nextEvent);
            }
        }

        private addEventAndPossiblyNextAndSwap(a: EventWithChildren, b?: EventWithChildren) : number {
            if (this.shouldSwap(a, b)) {
                this.addEvent(b!.event, b!.childEvents);
                this.addEvent(a.event, a.childEvents);
                return 2; // We added both events
            }
            this.addEvent(a.event, a.childEvents);
            return 1; // We added just one event
        }

        private shouldSwap(a: EventWithChildren, b?: EventWithChildren): boolean {
            if (!b) {
                return false;
            }
            const { event: eventA } = a;
            const { event: eventB, childEvents: childEventsB } = b;
            if (!eventA.Code || !isFileEditEvent(eventB) || !eventA.ClientTimestamp || !eventB.ClientTimestamp) {
                return false;
            }

            const timeA = new Date(eventA.ClientTimestamp).getTime();
            const timeB = new Date(eventB.ClientTimestamp).getTime();
            const timeDiff = Math.abs(timeA - timeB);

            // If the events are more a small delta apart, we can be reasonably sure about their order
            // TODO: No magical constants!
            if (timeDiff > 500) {
                return false;
            }

            let targetCode = eventA.Code;
            if (this.shouldAddLineFeed) {
                targetCode = targetCode.replace(/\n/g, '\r\n');
            }

            // If the save-like event matches the current text, no problem
            let currentText = this.editList.toPlainText();
            if (currentText === targetCode) {
                return false;
            }

            const allEditsB = [eventB, ...childEventsB.filter(isFileEditEvent)];

            // If the edits in B would produce the text in A, then we should swap them
            const simulatedText = allEditsB.reduce((text, editEvent) => {
                const changeEvent = this.getChangeEvent(editEvent);
                return text.slice(0, changeEvent.rangeOffset) + changeEvent.text + text.slice(changeEvent.rangeOffset + changeEvent.rangeLength);
            }, currentText);

            const textMatches = simulatedText === targetCode;
            if (textMatches) {
                this.editList.trace(`Swapping events to avoid text conflicts.`,
                    eventA,
                    eventB
                );
            }
            return textMatches;
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