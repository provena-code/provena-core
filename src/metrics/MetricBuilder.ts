import { EditMetricsCalculator } from "./EditMetrics";
import { LinearityMetricsCalculator } from "./LinearityMetrics";
import { TimeMetricsCalculator } from "./TimeMetrics";
import { EditEventParams, IEditListener } from "../edits/EditListBuilder";


export interface IMetricCalculator extends IEditListener {
    category: string;
    calculateMetrics(): Record<string, any>;
}

export class MetricBuilder implements IEditListener {
    constructor(public readonly calculators: IMetricCalculator[]) {}

    onEdit(params: EditEventParams) {
        for (const calculator of this.calculators) {
            calculator.onEdit(params);
        }
    }

    calculateMetrics(): Record<string, Record<string, any>> {
        const metrics: Record<string, Record<string, any>> = {};
        for (const calculator of this.calculators) {
            metrics[calculator.category] = calculator.calculateMetrics();
        }
        return metrics;
    }

    static createWithAll() {
        return new MetricBuilder([
            new EditMetricsCalculator(),
            new LinearityMetricsCalculator(),
            new TimeMetricsCalculator()
        ]);
    }
}