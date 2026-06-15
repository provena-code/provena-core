import { IMetricCalculator } from "./MetricBuilder";
import { EditEventParams } from "../edits/EditListBuilder";

function getMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class LinearityMetricsCalculator implements IMetricCalculator {
    public readonly category = "Linearity";

    private readonly distances: number[] = [];
    private lastIndex = 0;

    onEdit(params: EditEventParams) {
        const { edit } = params;
        for (const change of edit.contentChanges) {
            const startIndex = change.rangeOffset;
            const difference = Math.abs(startIndex - this.lastIndex);
            this.distances.push(difference);
            this.lastIndex = startIndex;
        }
    }

    calculateMetrics() {
        return {
            averageDistance: this.distances.reduce((a, b) => a + b, 0) / this.distances.length || 0,
            medianDistance: getMedian(this.distances),
            allDistances: [...this.distances]
        };
    }
}