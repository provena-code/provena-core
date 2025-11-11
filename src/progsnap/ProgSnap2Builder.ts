
import { EditList, EditListBuilder, EditRange } from "../index";

export namespace PS2 {
    export type MainTableRow = {
        ServerTimestamp: string;
        SourceLocation: string | null;
        InsertText: string | null;
        DeleteText: string | null;
        CodeStateSection: string | null;
    }

    export type EditHistoryFrame = {
        edits: EditRange[];
        editedRange: { start: number; end: number } | null;
        wasInsertion: boolean;
        wasDeletion: boolean;
    }

    export function createEditList(events: MainTableRow[]): EditRange[] {
        return createEditListLogic(events, false) as EditRange[];
    }

    export function createEditHistory(events: MainTableRow[]): EditHistoryFrame[] {
        return createEditListLogic(events, true) as EditHistoryFrame[];
    }

    function createEditListLogic(events: MainTableRow[], withHistory: boolean): EditHistoryFrame[] | EditRange[] {
        const builder = new EditListBuilder(new EditList());

        let first = true;
        const history: EditHistoryFrame[] = [];
        for (const event of events) {
            // parse event.ServerTimestamp as ISO string
            const time = new Date(event.ServerTimestamp).getTime();
            const insertedText = event.InsertText || '';
            const deletedLength = (event.DeleteText || '').length;
            const rangeOffset = parseInt(event.SourceLocation!);

            const editedRange = {
                start: rangeOffset,
                end: rangeOffset + insertedText.length,
            };

            if (first && insertedText.length > 1) {
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
            first = false;

            if (!withHistory) {
                continue;
            }
            history.push({
                edits: builder.editList.copyEdits(),
                editedRange: editedRange,
                wasInsertion: insertedText.length > 0,
                wasDeletion: deletedLength > 0,
            });
        }

        if (!withHistory) {
            return builder.editList.copyEdits();
        }

        return history;
    }

}