
import { DocumentStatus, EditList, EditListBuilder, EditRange, EditType, IChangeEvent } from "../index";
import { MetricBuilder } from "../metrics/MetricBuilder";
import { FileEditEvent, FileRenameEvent, isFileCopyTextEvent, isFileEditEvent, isFileRenameEvent, MainTableEvent } from "./PS2EventTypes";

export namespace PS2 {

    export type EditedRange = {
        start: number;
        end: number;
    }

    type AnnotatedDocumentBase = {
        edits: EditRange[];
        errors: any[][];
        isInternallyConsistent: boolean;
    }

    export type AnnotatedDocument = AnnotatedDocumentBase & {
        metrics: Record<string, Record<string, any>>;
    }

    export type EditHistoryFrame = AnnotatedDocumentBase & {
        eventIDs: string[];
        editedRanges: EditedRange[];
        wasInsertion: boolean;
        wasDeletion: boolean;
        currentClipboard: string;
        hadDiscontinuity: boolean;
    }

    export type BuilderOptions = {
        addHistory?: boolean;
        newLineMode?: NewlineMode;
    }

    export type NonHistoryBuilderOptions = Omit<BuilderOptions, 'addHistory'>;

    export function createEditList(events: MainTableEvent[], options?: NonHistoryBuilderOptions): AnnotatedDocument {
        return createEditListLogic(events, { ...options, addHistory: false }) as AnnotatedDocument;
    }

    export function createEditHistory(events: MainTableEvent[], options?: NonHistoryBuilderOptions): Builder {
        return createEditListLogic(events, { ...options, addHistory: true }) as Builder;
    }

    export async function createEditHistoryAsync(events: MainTableEvent[], yielder: () => Promise<any>, options?: NonHistoryBuilderOptions): Promise<Builder> {
        const builder = new Builder(true, options?.newLineMode);
        await builder.addEventsAsync(events, yielder);
        return builder;
    }

    function createEditListLogic(events: MainTableEvent[], options: BuilderOptions): Builder | AnnotatedDocument {
        const builder = new Builder(options.addHistory, options.newLineMode);
        builder.addEvents(events);
        return options.addHistory ? builder : {
            edits: builder.getEditsCopy(),
            errors: builder.errors.slice(),
            isInternallyConsistent: builder.editList.isInternallyConsistent(),
            metrics: builder.calculateMetrics(),
        };
    }

    export enum NewlineMode {
        UseSource,
        AddLineFeed,
        AutoDetect
    }

    type EventWithChildren = {
        event: MainTableEvent;
        childEvents: MainTableEvent[];
    }

    export class MultiFileBuilder {
        private readonly builders: Map<string, Builder> = new Map();

        public get builderMap(): ReadonlyMap<string, Builder> {
            return this.builders;
        }

        private getOrCreateBuilder(filePath?: string): Builder {
            if (!filePath) {
                filePath = this.currentFile;
            }
            if (!this.builders.has(filePath)) {
                this.builders.set(filePath, new Builder(this.options.addHistory, this.options.newLineMode));
            }
            return this.builders.get(filePath)!;
        }

        private currentFile = '';

        constructor(
            public readonly options: BuilderOptions,
        ) { }

        private logWarning(...args: any[]) {

        }

        private isRelevantEvent(event: MainTableEvent): boolean {
            return isFileEditEvent(event) || isFileCopyTextEvent(event) || isFileRenameEvent(event) || event.Code !== undefined;
        }

        public addEvents(events: MainTableEvent[]) {
            let eventsToAdd: MainTableEvent[] = [];
            const me = this;
            function flushEvents() {
                if (eventsToAdd.length > 0) {
                    const builder = me.getOrCreateBuilder();
                    builder.addEvents(eventsToAdd);
                    eventsToAdd = [];
                }
            }

            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                if (isFileRenameEvent(event)) {
                    // No need to flush events because this may not even
                    const from = event.CodeStateSection;
                    const to = event.DestinationCodeStateSection;
                    if (!this.builders.has(from)) {
                        this.logWarning(`Received File.Rename event for unknown CodeStateSection ${from}.`);
                    }
                    this.builders.set(to, this.getOrCreateBuilder(from));
                    this.builders.delete(from);
                    if (this.currentFile === from) {
                        this.currentFile = to;
                    }
                } else if (
                    // Only flush if we've done something edit-relevant with another event, which could depend
                    // on or affect other files.
                    this.isRelevantEvent(event) &&
                    event.CodeStateSection !== undefined && event.CodeStateSection !== this.currentFile
                ) {
                    flushEvents();
                    const copiedText = this.getOrCreateBuilder().editListBuilder.lastCopiedText;
                    this.currentFile = event.CodeStateSection;
                    if (copiedText) {
                        this.getOrCreateBuilder().editListBuilder.setCopiedText(copiedText);
                    }
                } else if (event.Code !== undefined) {
                    const builder = this.getOrCreateBuilder();
                    // If we're setting code for a previously unseen file, it may be that the file
                    // was copied from an existing file (we can't detect File.Copy events, so we have
                    // to infer them).
                    if (builder.editList.isEmpty()) {
                        for (const [filePath, otherBuilder] of this.builders) {
                            if (otherBuilder.editList.toPlainText() === event.Code) {
                                builder.editList.trace(`Inferring File.Copy event for file ${event.CodeStateSection} from identical code in file ${filePath}.`);
                                builder.editListBuilder.addFileCopyEvent(otherBuilder.editList);
                                break;
                            }
                        }
                    }
                }
                eventsToAdd.push(event);
            }
            flushEvents();
        }
    }

    export class Builder {
        public readonly editListBuilder = new EditListBuilder(new EditList());
        public readonly editList = this.editListBuilder.editList;
        private readonly history: EditHistoryFrame[] = [];
        // Used to keep track of events we haven't added to the history yet
        private readonly unrecordedEvents: MainTableEvent[] = [];
        // We track the last recorded error index so we can get just the
        // errors for the current frame when building history
        private lastRecordedErrorLength = 0;
        public readonly errors: any[][] = [];
        private currentClipboard: string = '';

        private detectedLinefeed = false;

        private get shouldAddLineFeed() {
            return this.newLineMode === NewlineMode.AddLineFeed ||
                (this.newLineMode === NewlineMode.AutoDetect && this.detectedLinefeed);
        }

        private readonly metricBuilder = MetricBuilder.createWithAll();

        constructor(
            public readonly addHistory = false,
            public readonly newLineMode = NewlineMode.UseSource
        ) {
            this.editListBuilder.addListener(this.metricBuilder);
        }

        public calculateMetrics() {
            return this.metricBuilder.calculateMetrics();
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
                this.editListBuilder.logError("Failed to parse event:", event, e);
            }
            return undefined;
        }

        private detectNeedForLineFeedIfNeeded(events: MainTableEvent[]) {
            if (this.newLineMode !== NewlineMode.AutoDetect) {
                return;
            }
            let newlines = 0;
            let linefeeds = 0;
            for (const event of events) {
                if (isFileEditEvent(event) && event.EditType === 'Insert') {
                    const insertedText = event.InsertText || '';
                    if (insertedText.includes('\n')) {
                        newlines++;
                    }
                    if (insertedText.includes('\r')) {
                        linefeeds++;
                    }
                }
            }
            if (linefeeds > 0) {
                this.detectedLinefeed = true;
            }
            if (linefeeds > 0 && linefeeds < newlines) {
                // TODO: Figure out what to do here...
                console.warn(`Detected mix of newlines and linefeeds in inserted text. Newlines: ${newlines}, Linefeeds: ${linefeeds}. Defaulting to adding linefeeds.`);
            }
        }

        private extractEventsWithChildren(events: MainTableEvent[]): EventWithChildren[] {
            const eventsWithChildren: EventWithChildren[] = [];
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                const childEvents: MainTableEvent[] = [];
                for (let j = i + 1; j < events.length; j++) {
                    const nextEvent = events[j];
                    if (event.EventID === nextEvent.ParentEventID) {
                        childEvents.push(nextEvent);
                        i = j; // Move the outer loop index to skip over child events
                    } else {
                        break;
                    }
                }
                eventsWithChildren.push({ event, childEvents });
            }
            return eventsWithChildren;
        }

        public async addEventsAsync(events: MainTableEvent[], yielder: () => Promise<void>) {
            this.detectNeedForLineFeedIfNeeded(events);
            const eventsWithChildren = this.extractEventsWithChildren(events);
            let tick = 0;
            for (let i = 0; i < eventsWithChildren.length;) {
                const event = eventsWithChildren[i];
                const nextEvent = eventsWithChildren[i + 1];
                i += this.addEventAndPossiblyNextAndSwap(event, nextEvent);
                if (tick++ % 100 === 0) {
                    await yielder();
                }
            }
            this.recordHistoryFrame([], false);
        }

        public addEvents(events: MainTableEvent[]) {
            this.detectNeedForLineFeedIfNeeded(events);
            const eventsWithChildren = this.extractEventsWithChildren(events);
            for (let i = 0; i < eventsWithChildren.length;) {
                const event = eventsWithChildren[i];
                const nextEvent = eventsWithChildren[i + 1];
                i += this.addEventAndPossiblyNextAndSwap(event, nextEvent);
            }
            this.recordHistoryFrame([], false);
        }

        private addEventAndPossiblyNextAndSwap(a: EventWithChildren, b?: EventWithChildren) : number {
            this.fixCopyEventWithEdit(a, b);
            if (this.shouldSwap(a, b)) {
                this.addEvent(b!.event, b!.childEvents);
                this.addEvent(a.event, a.childEvents);
                return 2; // We added both events
            }
            this.addEvent(a.event, a.childEvents);
            return 1; // We added just one event
        }

        private shouldSwap(a: EventWithChildren, b?: EventWithChildren): boolean {
            if (!b) {
                return false;
            }
            return this.shouldSwapSaveAndEdit(a, b) || this.shouldSwapCopyAndSave(a, b);
        }

        private shouldSwapCopyAndSave(a: EventWithChildren, b: EventWithChildren): boolean {
            const eventA = a.event;
            const eventB = b.event;
            if (!isFileCopyTextEvent(eventA) || !eventA.SourceLocation || !eventA.CopiedText) {
                return false;
            }
            const currentCode = this.editList.toPlainText();
            const copiedText = eventA.CopiedText || '';
            const sourceLocation = parseInt(eventA.SourceLocation);
            if (currentCode.substring(sourceLocation, sourceLocation + copiedText.length) === copiedText) {
                // Text already matches; no need to swap
                return false;
            }

            if (eventB.Code) {
                const newCode = eventB.Code;
                // If the text matches after the new code is applied (presumably when a discontinuity occurred)
                // then we should swap
                if (newCode.substring(sourceLocation, sourceLocation + copiedText.length) === copiedText) {
                    return true;
                }

                // If it's not an exact match at the source location (i.e. due to discontinuity)
                // but still does only appear in the new text, it might make more sense to swap anyway,
                // but remove the no-longer-accurate SourceLocation.
                if (newCode.includes(copiedText) && !currentCode.includes(copiedText)) {
                    this.editList.logWarning(`Swapping File.CopyText and File.Save events to avoid text conflicts, and removing SourceLocation from CopyText event`, eventA, eventB);
                    delete eventA.SourceLocation;
                    return true;
                }
            }

            // If we already have the code somewhere, don't check edits
            if (currentCode.includes(copiedText) || !isFileEditEvent(eventB)) {
                return false;
            }

            // If we create the copied text after the edits, swap
            const simulatedText = this.simulateEdits(currentCode, b);
            return simulatedText.includes(copiedText);
        }

        // Sometimes an edit event is delayed (e.g. due to waiting on clipboard) and
        // happens after a save event, when it should really have occurred before.
        private shouldSwapSaveAndEdit(a: EventWithChildren, b: EventWithChildren): boolean {
            const { event: eventA } = a;
            const { event: eventB, childEvents: childEventsB } = b;
            if (!eventA.Code || !isFileEditEvent(eventB) || !eventA.ClientTimestamp || !eventB.ClientTimestamp) {
                return false;
            }

            const timeA = new Date(eventA.ClientTimestamp).getTime();
            const timeB = new Date(eventB.ClientTimestamp).getTime();
            const timeDiff = Math.abs(timeA - timeB);

            // If the events are more a small delta apart, we can be reasonably sure about their order
            // TODO: No magical constants!
            if (timeDiff > 500) {
                return false;
            }

            let targetCode = eventA.Code;
            if (this.shouldAddLineFeed) {
                targetCode = targetCode.replace(/\n/g, '\r\n');
            }

            // If the save-like event matches the current text, no problem
            let currentText = this.editList.toPlainText();
            if (currentText === targetCode) {
                return false;
            }

            const simulatedText = this.simulateEdits(currentText, b);

            const textMatches = simulatedText === targetCode;
            if (textMatches) {
                this.editList.trace(`Swapping events to avoid text conflicts.`,
                    eventA,
                    eventB
                );
            }
            return textMatches;
        }

        private simulateEdits(currentText: string, edits: EventWithChildren): string {
            const allEditsB = [edits.event, ...edits.childEvents].filter(isFileEditEvent);

            // If the edits in B would produce the text in A, then we should swap them
            const simulatedText = allEditsB.reduce((text, editEvent) => {
                const changeEvent = this.getChangeEvent(editEvent);
                return text.slice(0, changeEvent.rangeOffset) + changeEvent.text + text.slice(changeEvent.rangeOffset + changeEvent.rangeLength);
            }, currentText);
            return simulatedText;
        }

        private fixCopyEventWithEdit(a: EventWithChildren, b?: EventWithChildren) {
            const aEvent = a.event;

            // Sometimes we get a copy with a false SourceLocation that was caused by
            // a bug in the logger. If the SourceLocation matches a subsequent edit/paste event,
            // and the text matches as well, we should remove the SourceLocation.
            if (!isFileCopyTextEvent(aEvent) || !aEvent.SourceLocation || !b || !isFileEditEvent(b.event)) {
                return;
            }

            const sourceLocation = parseInt(aEvent.SourceLocation);

            const currentText = this.editList.toPlainText();
            const textAtLocation = currentText.substring(sourceLocation, aEvent.CopiedText.length);
            if (textAtLocation === aEvent.CopiedText) {
                // If the text at the SourceLocation already matches the copied text,
                // we can assume the SourceLocation is correct, and matches text before the edit occurred.
                return;
            }
            if (currentText.includes(aEvent.CopiedText)) {
                // If the text exists somewhere else in the document, it's possible the SourceLocation
                // is just wrong, but this could plausible have been a local copy.
                return;
            }

            const allEventsB = [b.event, ...b.childEvents.filter(isFileEditEvent)];

            // If the text wasn't in the document before this edit, and this edit pastes it
            // it's almost certain that the SourceLocation was erroneously set "in the future"
            // to the location of the paste itself and should be discarded.
            const matchingEdit = allEventsB.find(editEvent => editEvent.InsertText === aEvent.CopiedText);

            if (matchingEdit) {
                this.editList.logWarning(`Removing false SourceLocation from File.CopyText event`, aEvent, allEventsB);
                delete aEvent.SourceLocation;
            }
        }


        // Private because we might have multiple events with the same
        // parent, so those need to be processed together
        private addEvent(event: MainTableEvent, childEvents: MainTableEvent[] = []) {
            const builder = this.editListBuilder;

            builder.editList.logError = (...args: any[]) => {
                console.error(...args);
                this.errors.push(args);
            }

            if (!event) {
                builder.logError("Event is undefined or null");
                return;
            }

            if (this.addHistory) {
                this.unrecordedEvents.push(event);
                this.unrecordedEvents.push(...childEvents);
            }

             // parse event.ClientTimestamp as ISO string
            const time = new Date(event?.ClientTimestamp || '').getTime();

            // If we're given the exact code, we should just update the document text

            if (event.Code) {
                let code = event.Code;
                if (this.shouldAddLineFeed) {
                    code = code.replace(/\n/g, '\r\n');
                }
                let firstFrame = false;
                if (builder.editList.isEmpty()) {
                    builder.editList.setInitialText(code, time);
                    firstFrame = true;
                }

                const status = builder.verifyDocumentText(code, time, true);
                const isDiscontinuity = status !== DocumentStatus.Synced;

                // The text is only changed if there's a discontinuity, and
                // we don't really need a frame if the file wasn't actually changed.
                if (firstFrame || isDiscontinuity) {
                    this.recordHistoryFrame([], isDiscontinuity);
                }
                return;
            }

            if (isFileCopyTextEvent(event)) {
                let sourceLocation = event.SourceLocation ? parseInt(event.SourceLocation) : undefined;
                if (sourceLocation !== undefined && isNaN(sourceLocation)) {
                    sourceLocation = undefined;
                }
                builder.addCopyEvent(event.CopiedText, sourceLocation);
                this.currentClipboard = event.CopiedText;
                // console.log('Copy!', event.CopiedText, event, builder.lastCopiedText);
                return;
            }

            if (!isFileEditEvent(event)) {
                return;
            }

            const editType = this.toEditType(event.EditType);

            const allEvents: FileEditEvent[] = [event];

            for (const child of childEvents) {
                if (!isFileEditEvent(child)) {
                    builder.logError("Child events must share EventTypes", event, child);
                    continue;
                }
                const childEditType = this.toEditType(child.EditType);
                if (editType !== childEditType) {
                    builder.logError("Mismatched edit types between parent and child events", event, child);
                    continue;
                }
                allEvents.push(child);
            }

            // If we know this event was a paste, make sure the builder registers
            // the the inserted text was copied before we add the edit event.
            if (event.EditType === 'Paste' && event.InsertText) {
                // Note: we don't count empty copies
                builder.addCopyEvent(event.InsertText);
                this.currentClipboard = event.InsertText;
            }

            const changeEvents = allEvents.map(e => this.getChangeEvent(e));

            builder.addEditEvent({
                time: time,
                contentChanges: changeEvents,
                editType: editType,
            });

            this.recordHistoryFrame(changeEvents);
        }

        private toEditType(editType: string): EditType {
            switch (editType) {
                case 'Undo':
                    return EditType.Undo;
                case 'Redo':
                    return EditType.Redo;
                default:
                    return EditType.Edit;
            }
        }

        private recordHistoryFrame(changeEvents: IChangeEvent[], didTextJump = false) {
            if (!this.addHistory || this.unrecordedEvents.length === 0) {
                return;
            }

            // Get just the errors for this frame
            const errors = this.errors.slice(this.lastRecordedErrorLength);
            this.lastRecordedErrorLength = this.errors.length;

            const builder = this.editListBuilder;

            const eventIDs = this.unrecordedEvents.map(e => e.EventID || '');
            this.unrecordedEvents.length = 0; // Clear the unrecorded events
            this.history.push({
                eventIDs: eventIDs,
                edits: builder.editList.copyEdits(),
                editedRanges: changeEvents.map(ce => this.getEditedRange(ce)),
                wasInsertion: changeEvents.some(ce => ce.text.length > 0),
                wasDeletion: changeEvents.some(ce => ce.rangeLength > 0),
                isInternallyConsistent: builder.editList.isInternallyConsistent(),
                errors: errors,
                currentClipboard: this.currentClipboard,
                hadDiscontinuity: didTextJump,
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