
import { EditList, EditListBuilder, EditRange, IChangeEvent } from "../index";
import { FileEditEvent, isFileCopyTextEvent, isFileEditEvent, MainTableEvent } from "./PS2EventTypes";

export namespace PS2 {

    export type EditedRange = {
        start: number;
        end: number;
    }

    export type EditHistoryFrame = {
        edits: EditRange[];
        editedRanges: EditedRange[];
        wasInsertion: boolean;
        wasDeletion: boolean;
    }

    export function createEditList(events: MainTableEvent[]): EditRange[] {
        return createEditListLogic(events, false) as EditRange[];
    }

    export function createEditHistory(events: MainTableEvent[]): EditHistoryFrame[] {
        return createEditListLogic(events, true) as EditHistoryFrame[];
    }

    function createEditListLogic(events: MainTableEvent[], withHistory: boolean): readonly EditHistoryFrame[] | EditRange[] {
        const builder = new Builder(withHistory);
        builder.addEvents(events);
        return withHistory ? builder.getHistory() : builder.getEditsCopy();
    }

    export class Builder {
        public readonly editListBuilder = new EditListBuilder(new EditList());
        public readonly editList = this.editListBuilder.editList;
        private readonly history: EditHistoryFrame[] = [];

        constructor(public readonly addHistory: boolean = false) {

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

        public addEvents(events: MainTableEvent[]) {
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                const childEvents: MainTableEvent[] = [];
                for (let j = i + 1; j < events.length; j++) {
                    const nextEvent = events[j];
                    if (event.EventID === nextEvent.ParentEventID) {
                        childEvents.push(nextEvent);
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

            const builder = this.editListBuilder;
             // parse event.ClientTimestamp as ISO string
            const time = new Date(event?.ClientTimestamp || '').getTime();

            // If we're given the exact code, we should just update the document text

            if (event.Code) {
                const status = builder.verifyDocumentText(event.Code, time, true);
                // console.log(`Status: ${status}; Resetting text for ${event.CodeStateSection} to`, event.Code);
                return;
            }

            // TODO: Handle copied text from other documents!
            if (isFileCopyTextEvent(event)) {
                builder.addCopyEvent(event.CopiedText);
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
            this.history.push({
                edits: builder.editList.copyEdits(),
                editedRanges: changeEvents.map(ce => this.getEditedRange(ce)),
                wasInsertion: changeEvents.some(ce => ce.text.length > 0),
                wasDeletion: changeEvents.some(ce => ce.rangeLength > 0),
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