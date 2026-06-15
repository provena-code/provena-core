import { EditEventParams } from "../edits/EditListBuilder";
import { IMetricCalculator } from "./MetricBuilder";

export class TimeMetricsCalculator implements IMetricCalculator {
    category = "Time";

    lastEditTime: number | null = null;
    activeTime = 0;
    timeIntervals: number[] = [];
    nEdits = 0;
    nInsertions = 0;

    onEdit(params: EditEventParams): void {
        const { edit } = params;
        if (this.lastEditTime !== null) {
            const interval = edit.time - this.lastEditTime;
            this.timeIntervals.push(interval);
            // Consider edits within 3 minutes as active time per
            // Leinonen et al. 2017
            if (interval <= 3 * 60 * 1000) {
                this.activeTime += interval;
            }
        }
        this.nEdits++;
        if (edit.contentChanges.some(change => change.text.length > 0)) {
            this.nInsertions++;
        }
        this.lastEditTime = edit.time;
    }

    calculateMetrics() {
        let editsPerSecond = 0, insertionsPerSecond = 0;
        if (this.activeTime > 0) {
            editsPerSecond = this.nEdits / (this.activeTime / 1000);
            insertionsPerSecond = this.nInsertions / (this.activeTime / 1000);
        }
        return {
            activeTime: this.activeTime,
            timeIntervals: [...this.timeIntervals],
            editsPerSecond: editsPerSecond,
            insertionsPerSecond: insertionsPerSecond,
        }
    }

}