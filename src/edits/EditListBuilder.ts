import { Diff, diffChars } from "diff";
import { Author } from "../shared/Author";
import { QueryMatch, Span } from "../shared/edit-data";
import { EditEvent, EditType, IChangeEvent } from "./EditEvent";
import { continueWithinTimeLimit, EditList } from "./EditList";

export class CopiedText {
    constructor(
        public readonly text: string,
        public readonly match: QueryMatch | null,
        public readonly originUnknown: boolean = false
    ) {}
}

export type EditEventParams = {
    edit: EditEvent;
    editList: EditList;
    copiedText: CopiedText | null;
}

export interface IEditListener {
    onEdit(params: EditEventParams): void;
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

        public maxSearchTimeMs: number = 300,
    ) {}
}

export enum DocumentStatus {
    Synced,
    Modified,
    Irreconcilable,
}

class CodeDiff extends Diff<string> {
  tokenize(value: string) {
    return value.split(/([A-Za-z0-9]+)|([^A-Za-z0-9])/);
  }

  join(tokens: string[]) {
    return tokens.join('');
  }
}

export class EditListBuilder {

    private copiedText: CopiedText | null = null;
    private listeners: IEditListener[] = [];

    public setCopiedText(copiedText: CopiedText) {
        this.trace('Manually setting copied text', copiedText);
        this.copiedText = copiedText;
    }

    public get lastCopiedText() {
        return this.copiedText;
    }

    constructor(
        public readonly editList: EditList,
        public readonly config: AttributionConfig = new AttributionConfig()
    ) {}

    public addListener(listener: IEditListener) {
        this.listeners.push(listener);
    }

    public trace(...args: any[]) {
        this.editList.trace(...args);
    }

    public logError(...args: any[]) {
        this.editList.logError(...args);
    }

    private getAuthor(edits: readonly IChangeEvent[], isUndoOrRedo: boolean): Author {
        if (isUndoOrRedo) {
            // Undo/redo should not create EditNodes, so if they
            // do, something went wrong, and we don't know the author.
            return Author.Unknown;
        }

        // If this edit only inserts whitespace, even if that
        // came from the system, it's cleaner just to call it
        // a user edit, since whitesapce isn't meaningful here.
        if (edits.every(edit => {
            return edit.text.trim().length === 0;
        })) {
            return Author.User;
        }

        // If there are multiple insertions in a single edit, this
        // was likely the IDE's action, whether user-initiated or not.
        if (edits.filter(edit => edit.text.length > 0).length > 1) {
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

        if (edit.text === this.copiedText?.text) {
            if (this.copiedText?.originUnknown) {
                // If the copied text matches but we don't know where it came from,
                // we should mark it that way instead of assuming it's external.
                return Author.Unknown;
            }
            return Author.ExternalPaste;
        }

        return Author.System;
    }

    public verifyDocumentText(documentText: string, time: number, update: boolean) : DocumentStatus {
        const currentText = this.editList.toPlainText();
        if (currentText === documentText) {
            return DocumentStatus.Synced;
        }

        // const historicalMatch = this.editList.searchHistory(documentText);
        // if (historicalMatch) {
        //     if (update) {
        //         console.log('Reverting to historical match', historicalMatch);
        //         this.editList.revertToHistoricalMatch(historicalMatch, time);
        //     }
        //     return DocumentStatus.Modified;
        // }

        // TODO: It would be nice ot diff keeping word in tact, but this would require a rewrite
        // and some major testing...
        const parts = diffChars(currentText, documentText);
        // const parts = new CodeDiff().diff(currentText, documentText);
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
        this.editList.resetUndoRedoHistory();

        if (!isReconcilable)
        {
            this.trace(`Warning: Significant document text mismatch detected. Restarting.
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
                offset += part.value.length;
            } else if (part.removed) {
                this.editList.addEdit({
                    text: '',
                    rangeOffset: offset,
                    rangeLength: part.value.length,
                }, {...metadata});
            } else {
                offset += part.value.length;
            }
        }

        const finalText = this.editList.toPlainText();
        if (finalText !== documentText) {
            this.logError('Document text verification failed after applying diffs.');
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
        const { contentChanges: edits, editType = EditType.Edit, time } = event;

        if (edits.length === 0) {
            return;
        }

        const isUndoOrRedo = editType !== EditType.Edit;
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
            this.editList.addEdit(edit, metadata, editType, match);
        }
        this.onEdit(event);
    }

    private onEdit(edit: EditEvent) {
        const wasCopy = this.copiedText && this.copiedText.text.length > 0 && edit.contentChanges.length === 1 && edit.contentChanges[0].text === this.copiedText.text;
        const copiedText = wasCopy ? this.copiedText : null;
        for (const listener of this.listeners) {
            listener.onEdit({ edit, editList: this.editList, copiedText });
        }
    }

    /**
     * Registers a copy event and attempts to locate the text being copied
     * @param copiedText
     * @returns True if the copied text was successfully matched (or had been previously)
     */
    public addCopyEvent(copiedText: string, sourceLocation?: number): boolean {
        if (!copiedText || copiedText.length === 0) {
            this.copiedText = null;
            return false;
        }
        if (this.copiedText && this.copiedText.text === copiedText) {
            return true;
        }
        let match: QueryMatch | null = null;
        if (sourceLocation !== undefined) {
            const textAtLocation = this.editList.toPlainText().substring(sourceLocation, sourceLocation + copiedText.length);
            if (textAtLocation === copiedText) {
                match = this.editList.getMatchAtIndex(sourceLocation, copiedText.length);
            } else {
                match = this.matchText(copiedText, true);
                // TODO: I'm not sure if it should be an error either way; can't always fix it...
                // Only raise this to the level of an error if we can't correct it with a local match
                const logFn = match ? this.editList.logWarning : this.logError;
                logFn.call(this, "Copied text does not match document text at SourceLocation", sourceLocation, copiedText, 'vs', textAtLocation);
            }
            // If we can't find a match at the source location or elsewhere in the text,
            // we shouldn't try to fake it the match based on the source location.
            // We could look for a partial match, but I think it's better to just say we don't know.
        } else {
            match = this.matchText(copiedText, true);
        }
        const originUnknown = !match && sourceLocation !== undefined;
        this.copiedText = new CopiedText(copiedText, match, originUnknown);
        return match !== null;
    }

    /**
     * Returns the number of characters in this match that were authored by the user.
     * @param match
     */
    private countUserAuthorship(match: QueryMatch): number {
        return match.reduce((count, part) => {
            if (part.node.metadata.author === Author.User) {
                return count + part.range.length;
            }
            return count;
        }, 0);
    }

    private matchText(text: string, searchHistory: boolean): QueryMatch | null {
        const currentMatches = this.editList.searchCurrentEdits(text);
        if (currentMatches.length > 0) {
            return currentMatches.reduce((best, match) => {
                return this.countUserAuthorship(match) > this.countUserAuthorship(best) ? match : best;
            });
        }
        if (!searchHistory) {
            return null;
        }
        const historicalMatch = this.editList.searchHistory(text, continueWithinTimeLimit(this.config.maxSearchTimeMs));
        return historicalMatch;
    }

    addFileCopyEvent(editList: EditList) {
        this.editList.setInitialEdits(editList.copyEdits());
    }
}