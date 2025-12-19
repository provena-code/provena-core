
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
        private readonly editListBuilder = new EditListBuilder(new EditList());
        private readonly editList = this.editListBuilder.editList;
        private readonly history: EditHistoryFrame[] = [];
        private first = false;

        constructor(public readonly addHistory: boolean = false) {

        }

        public getHistory(): readonly EditHistoryFrame[] {
            return this.history;
        }

        public getEditsCopy() {
            return this.editList.copyEdits();
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
                builder.addCopyEvent({
                    copiedText: event.CopiedText,
                    time,
                    type: 'CopyEvent'
                });
            }

            if (!isFileEditEvent(event)) {
                return;
            }

            if (event.EditType === 'Paste' && event.InsertText) {
                // Note: this wouldn't trigger on an empty paste, but I think that's fine
                builder.addCopyEvent({
                    copiedText: event.InsertText,
                    time,
                    type: 'CopyEvent'
                });
            }

            const insertedText = event.InsertText || '';
            const deletedLength = event.DeleteText?.length || event?.DeleteLength || 0;
            const rangeOffset = parseInt(event.SourceLocation!);

            const editedRange = {
                start: rangeOffset,
                end: rangeOffset + insertedText.length,
            };

            if (this.first && insertedText.length > 1) {
                builder.editList.setInitialText(insertedText, time);
            } else {
                builder.addEditEvent({
                    time: time,
                    documentUri: event.CodeStateSection || '',
                    type: 'EditEvent',
                    contentChanges: [{
                        text: insertedText,
                        rangeOffset,
                        rangeLength: deletedLength,
                    }]
                });
            }
            this.first = false;

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