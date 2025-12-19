
import { EditList, EditListBuilder, EditRange } from "../index";
import { isFileCopyTextEvent, isFileEditEvent, MainTableEvent } from "./PS2EventTypes";

export namespace PS2 {

    export type EditHistoryFrame = {
        edits: EditRange[];
        editedRange: { start: number; end: number } | null;
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
            events.forEach((event) => this.addEvent(event));
        }

        public addEvent(event: MainTableEvent) {
            if (!event) {
                console.error("Event is undefined or null");
                return;
            }

            const builder = this.editListBuilder;
             // parse event.ClientTimestamp as ISO string
            const time = new Date(event?.ClientTimestamp || '').getTime();

            // If we're given the exact code, we should just update the document text

            if (event.Code) {
                builder.verifyDocumentText(event.Code, time, true);
                return;
            }

            // TODO: Handle copied text from other documents!
            if (isFileCopyTextEvent(event)) {
                builder.addCopyEvent(event.CopiedText);
            }

            if (!isFileEditEvent(event)) {
                return;
            }

            if (event.EditType === 'Paste' && event.InsertText) {
                // Note: we don't count empty copies
                builder.addCopyEvent(event.InsertText);
            }

            const insertedText = event.InsertText || '';
            const deletedLength = event.DeleteText?.length || event?.DeleteLength || 0;
            const rangeOffset = parseInt(event.SourceLocation!);

            const editedRange = {
                start: rangeOffset,
                end: rangeOffset + insertedText.length,
            };

            const isUndoOrRedo = event.EditType === 'Undo' || event.EditType === 'Redo';
            builder.addEditEvent({
                time: time,
                contentChanges: [{
                    text: insertedText,
                    rangeOffset,
                    rangeLength: deletedLength,
                }],
                isUndoOrRedo: isUndoOrRedo,
            });

            if (!this.addHistory) {
                return;
            }
            this.history.push({
                edits: builder.editList.copyEdits(),
                editedRange: editedRange,
                wasInsertion: insertedText.length > 0,
                wasDeletion: deletedLength > 0,
            });
        }
    }
}