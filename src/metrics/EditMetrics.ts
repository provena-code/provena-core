import { EditEventParams } from "../edits/EditListBuilder";
import { IMetricCalculator } from "./MetricBuilder";

export class EditMetricsCalculator implements IMetricCalculator {
    category = "Edit";

    insertCount = 0;
    deleteCount = 0;
    insertLength = 0;
    deleteLength = 0;
    pasteCount = 0;
    pasteLength = 0;
    externalPasteCount = 0;
    externalPasteLength = 0;

    onEdit(params: EditEventParams): void {
        const { edit, copiedText } = params;
        for (const change of edit.contentChanges) {
            if (change.text.length > 0) {
                this.insertCount++;
                this.insertLength += change.text.length;
                if (copiedText) {
                    this.pasteCount++;
                    this.pasteLength += change.text.length;
                    if (copiedText.match) {
                        this.externalPasteCount++;
                        this.externalPasteLength += change.text.length;
                    }
                }
            }
            if (change.rangeLength > 0) {
                this.deleteCount++;
                this.deleteLength += change.rangeLength;
            }
        }
    }

    calculateMetrics() {
        return {
            insertCount: this.insertCount,
            deleteCount: this.deleteCount,
            insertLength: this.insertLength,
            deleteLength: this.deleteLength,
            pasteCount: this.pasteCount,
            pasteLength: this.pasteLength,
            externalPasteCount: this.externalPasteCount,
            externalPasteLength: this.externalPasteLength
        }
    }
}
