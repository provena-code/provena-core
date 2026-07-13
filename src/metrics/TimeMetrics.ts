import { EditEventParams } from "../edits/EditListBuilder";
import { IMetricCalculator } from "./MetricBuilder";

const SHORT_BREAK_THRESHOLD = 3 * 60 * 1000; // 3 minutes
const LONG_BREAK_THRESHOLD = 15 * 60 * 1000; // 15 minutes
// const MAX_EPS_BREAK_THRESHOLD = 15 * 1000; // 15 seconds

export class TimeMetricsCalculator implements IMetricCalculator {
    category = "Time";

    lastEditTime: number | null = null;
    activeTime = 0;
    timeIntervals: number[] = [];
    nEdits = 0;
    nInsertions = 0;
    nShortBreaks = 0;
    nLongBreaks = 0;

    onEdit(params: EditEventParams): void {
        const { edit } = params;
        if (this.lastEditTime !== null) {
            const interval = edit.time - this.lastEditTime;
            this.timeIntervals.push(interval);

            // Consider edits within 3 minutes as active time per
            // Leinonen et al. 2017
            if (interval <= SHORT_BREAK_THRESHOLD) {
                this.activeTime += interval;
            } else if (interval <= LONG_BREAK_THRESHOLD) {
                this.nShortBreaks++;
            } else {
                this.nLongBreaks++;
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

        // let variance = 0;
        // const nonbreakEdits = this.timeIntervals.filter(interval => interval <= MAX_EPS_BREAK_THRESHOLD).sort((a, b) => a - b);
        // if (nonbreakEdits.length > 0) {
            // const meanInterval = nonbreakEdits.reduce((sum, interval) => sum + interval, 0) / nonbreakEdits.length;
            // variance = nonbreakEdits.reduce((sum, interval) => sum + Math.pow(interval - meanInterval, 2), 0) / nonbreakEdits.length;
        // }

        const sortedIntervals = [...this.timeIntervals].sort((a, b) => a - b);
        const editTimeIQR = sortedIntervals.length >= 4
                ? sortedIntervals[Math.floor(0.75 * sortedIntervals.length)] - sortedIntervals[Math.floor(0.25 * sortedIntervals.length)]
                : 0;

        return {
            activeTime: this.activeTime,
            timeIntervals: [...this.timeIntervals],
            editsPerSecond: editsPerSecond,
            insertionsPerSecond: insertionsPerSecond,
            editTimeIQR: editTimeIQR,
            nShortBreaks: this.nShortBreaks,
            nLongBreaks: this.nLongBreaks,
        }
    }

}