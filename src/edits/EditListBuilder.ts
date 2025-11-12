import { COPY_EVENT_TYPE, CopyEvent, EDIT_EVENT_TYPE, EditEvent, FOCUS_EVENT_TYPE, IChangeEvent, LogEvent, SAVE_EVENT_TYPE, SYNC_EVENT_TYPE } from "./event-types";
import { Author } from "../shared/Author";
import { QueryMatch, Span } from "../shared/edit-data";
import { EditList } from "./EditList";
import { EventListener } from "./EventListener";
import { diffChars } from "diff";

class CopiedText {
    constructor(public readonly text: string, public readonly match: QueryMatch | null) {}
}

class AttributionConfig {
    public constructor(
        /** Any inserted text with a length under this threshold is considered a user edit. */
        public userEditThreshold: number = 5,

        /** Whether to remove redundant text changes when replacing text.
         * Copilot often replaces full lines of text, even when it is only inserting
         * a small amount of new text. Enabling this option helps reduce the number of
         * misleading edits created in these cases.
        */
        public removeRedundantTextChanges: boolean = true,
        /** Minimum length of matching text to consider when removing redundant text changes. */
        public minRedundantTextLength: number = 3,

        public minHistoricalMatchOverlapRatio: number = 0.2,
        public minHistoricalMatchLongestOverlapRatio: number = 0.05,
    ) {}
}

export enum DocumentStatus {
    Synced,
    Modified,
    Irreconcilable,
}

export class EditListBuilder implements EventListener {

    private copiedText: CopiedText | null = null;

    public get lastCopiedText() {
        return this.copiedText?.text;
    }

    constructor(
        public readonly editList: EditList,
        public readonly config: AttributionConfig = new AttributionConfig()
    ) {}

    private getAuthor(edits: readonly IChangeEvent[], isUndoOrRedo: boolean): Author {
        if (isUndoOrRedo) {
            // Undo/redo should not create EditNodes, so if they
            // do, something went wrong, and we don't know the author.
            return Author.Unknown;
        }

        if (edits.length > 1) {
            // TODO: Could check if this text already exists
            // or for common actions (e.g. rename)
            return Author.System;
        }

        const edit = edits[0];

        // Let short text edits be from the user, regardless
        // of the source
        if (edit.text.trim().length < this.config.userEditThreshold) {
            return Author.User;
        }

        if (edit.text === this.lastCopiedText) {
            return Author.ExternalPaste;
        }

        return Author.System;
    }

    public verifyDocumentText(documentText: string, time: number, update: boolean) : DocumentStatus {
        const currentText = this.editList.toPlainText();
        if (currentText === documentText) {
            return DocumentStatus.Synced;
        }
        const historicalMatch = this.editList.searchHistory(documentText);
        if (historicalMatch) {
            if (update) {
                this.editList.revertToHistoricalMatch(historicalMatch, time);
            }
            return DocumentStatus.Modified;
        }

        const parts = diffChars(currentText, documentText);
        const keptLengths = parts.filter(p => !p.added && !p.removed).map(p => p.value.length);
        const totalKeptChars = keptLengths.reduce((a, b) => a + b, 0);
        const overlapRatio = totalKeptChars / Math.max(currentText.length, documentText.length);
        const longestKept = Math.max(...keptLengths, 0);
        const longestKeptRatio = longestKept / Math.max(currentText.length, documentText.length);

        const isReconcilable = overlapRatio >= this.config.minHistoricalMatchOverlapRatio ||
                                longestKeptRatio >= this.config.minHistoricalMatchLongestOverlapRatio;

        if (!update) {
            return isReconcilable ? DocumentStatus.Modified : DocumentStatus.Irreconcilable;
        }

        if (!isReconcilable)
        {
            console.warn(`Significant document text mismatch detected. Restarting.
                Overlap ratio: ${overlapRatio.toFixed(3)},
                Longest kept ratio: ${longestKeptRatio.toFixed(3)}`);
            this.resetText(documentText, time);
            return DocumentStatus.Irreconcilable;
        }

        let offset = 0;
        for (const part of parts) {
            const metadata = {
                author: Author.ExternalEdit,
                startTime: time,
                endTime: time
            };
            if (part.added) {
                this.editList.addEdit({
                    text: part.value,
                    rangeOffset: offset,
                    rangeLength: 0,
                }, {...metadata});
            } else if (part.removed) {
                this.editList.addEdit({
                    text: '',
                    rangeOffset: offset,
                    rangeLength: part.value.length,
                }, {...metadata});
            }
            offset += part.value.length;
        }

        const finalText = this.editList.toPlainText();
        if (finalText !== documentText) {
            console.error('Document text verification failed after applying diffs.');
            this.resetText(documentText, time);
            return DocumentStatus.Irreconcilable;
        }

        return DocumentStatus.Modified;
    }

    private resetText(documentText: string, time: number, author: Author = Author.ExternalEdit) {
        this.editList.clearEdits();
        this.editList.addEdit({
            text: documentText,
            rangeOffset: 0,
            rangeLength: 0,
        }, {
            author,
            startTime: time,
            endTime: time
        });
    }

    public onEvent(event: LogEvent) {
        switch (event.type) {
            case COPY_EVENT_TYPE:
                this.addCopyEvent(event);
                break;
            case EDIT_EVENT_TYPE:
                this.addEditEvent(event);
                break;
        }
    }

    /**
     * Modifies the given change event to remove any redundant text changes, where existing text is
     * replaced with identical text.
     * For example, if the existing text is "Hello World" and the change event replaces it with
     * "Hello New World", the redundant "Hello " and " World" parts will be removed, resulting in
     * a change event that only inserts "New" at the appropriate position.
     * @param changeEvent The original change event to replace
     * @returns The original or modified change event with redundant text removed, or null if no change remains.
     */
    public removeRedundantTextChanges(changeEvent: IChangeEvent): IChangeEvent | null {
        const { text, rangeLength, rangeOffset } = changeEvent;
        // If you're note deleting text, or inserting more text than you're deleting,
        // there's no redundancy to remove.
        if (rangeLength === 0) {
            return changeEvent;
        }

        const existingText = this.editList.getTextInRangeInclusive(new Span(rangeOffset, rangeOffset + rangeLength));

        let sharedStartingLength = 0;
        while (sharedStartingLength < text.length &&
               sharedStartingLength < existingText.length &&
               text[sharedStartingLength] === existingText[sharedStartingLength]) {
            sharedStartingLength++;
        }

        let sharedEndingLength = 0;
        while (sharedEndingLength + sharedStartingLength < text.length &&
               sharedEndingLength + sharedStartingLength < existingText.length &&
               text[text.length - 1 - sharedEndingLength] === existingText[existingText.length - 1 - sharedEndingLength]) {
            sharedEndingLength++;
        }

        if (sharedEndingLength < this.config.minRedundantTextLength) {
            sharedEndingLength = 0;
        }
        if (sharedStartingLength < this.config.minRedundantTextLength) {
            sharedStartingLength = 0;
        }

        const newText = text.substring(sharedStartingLength, text.length - sharedEndingLength);
        const newRangeLength = existingText.length - sharedStartingLength - sharedEndingLength;

        // If there's no actual change, return null
        if (newText.length === 0 && newRangeLength === 0) {
            return null;
        }

        return {
            text: newText,
            rangeOffset: rangeOffset + sharedStartingLength,
            rangeLength: newRangeLength,
        };
    }

    public addEditEvent(event: EditEvent) {
        const { contentChanges: edits, isUndoOrRedo = false, time } = event;

        if (edits.length === 0) {
            return;
        }

        const author = this.getAuthor(edits, isUndoOrRedo);

        for (const originalEdit of edits) {
            let match: QueryMatch | null = null;
            if (author === Author.ExternalPaste && !isUndoOrRedo && this.copiedText) {
                match = this.copiedText.match;
            } else if (author === Author.System && !isUndoOrRedo) {
                // TODO: Need to test this more thoroughly:
                // Does it have edge cases where system text gets upgraded to copied text?

                // Check if text from the System is actually something that's already been typed.
                // Don't search history; too expensive and unlikely to match, and even then
                // may be a false positive.
                match = this.matchText(originalEdit.text, false);
            }

            let edit = originalEdit;
            if (this.config.removeRedundantTextChanges && !match && !isUndoOrRedo) {
                let newEdit = this.removeRedundantTextChanges(originalEdit);
                if (!newEdit) {
                    continue;
                }
                edit = newEdit;
            }

            const metadata = {
                author,
                startTime: time,
                endTime: time,
            };
            this.editList.addEdit(edit, metadata, isUndoOrRedo, match);
        }

    }

    public addCopyEvent(copyEvent: CopyEvent) {
        const text = copyEvent.copiedText;
        if (!text || text.length === 0) {
            this.copiedText = null;
            return;
        }
        if (this.copiedText && this.copiedText.text === text) {
            return;
        }
        const match = this.matchText(text, true);
        this.copiedText = new CopiedText(text, match);
    }

    private matchText(text: string, searchHistory: boolean): QueryMatch | null {
        const currentMatches = this.editList.searchCurrentEdits(text);
        if (currentMatches.length > 0) {
            // TODO: Choose the most generous one
            return currentMatches[0];
        }
        if (!searchHistory) {
            return null;
        }
        const historicalMatch = this.editList.searchHistory(text);
        return historicalMatch;
    }

}