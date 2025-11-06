import { LogEvent } from "./event-types";

export interface EventListener {
    onEvent(event: LogEvent): void;
}

