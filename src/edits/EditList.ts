import { Author } from '../shared/Author';
import { copyEditRange, EditNode, EditRange, Metadata, QueryMatch, Span } from '../shared/edit-data';
import { IChangeEvent } from './EditEvent';

function createHeadNode(): EditNode {
    return new EditNode(new Span(0, 0), '', { author: Author.ExistingText, startTime: 0, endTime: 0 });
}

export function continueWithinTimeLimit(ms: number): () => boolean {
    const startTime = Date.now();
    return () => Date.now() - startTime < ms;
}

/**
 * Manages a history of edits with associated metadata from a code file.
 * All edits are non-overlapping and sorted by their start position.
 */
// TODO: All indexOf calls could be replaced with binary search for efficiency
// or a map from range to edit could be maintained
export class EditList {
    private edits = [] as EditNode[];
    private head = createHeadNode();

    trace: (...args: any[]) => void = (..._args: any[]) => { };
    logError: (...args: any[]) => void = (..._args: any[]) => { console.error(..._args); };

    getEdits(): readonly EditRange[] {
        return this.edits;
    }

    copyEdits(): EditRange[] {
        return this.edits.map(edit => copyEditRange(edit));
    }

    getHeadChildren(): readonly EditNode[] {
        return this.head.getChildren();
    }

    searchCurrentEdits(query: string): QueryMatch[] {
        const currentText = this.toPlainText();
        const allIndices = [];
        let index = currentText.indexOf(query);
        while (index !== -1) {
            allIndices.push(index);
            index = currentText.indexOf(query, index + 1);
        }
        return allIndices.map(startIndex => {
            const endIndex = startIndex + query.length - 1;
            let editIndex = this.findLastEditBefore(startIndex) + 1;
            const matchPath: QueryMatch = [];
            while (editIndex < this.edits.length) {
                const edit = this.edits[editIndex];
                // Bound the range to be within this text
                const rangeSubset = new Span(
                    Math.max(edit.range.start, startIndex),
                    Math.min(edit.range.end, endIndex)
                );
                // QueryResults use local ranges, so shift to be relative to the
                // start of this edit
                const localRange = rangeSubset.shift(-edit.range.start);
                matchPath.push({
                    node: edit,
                    range: localRange
                });
                // If we've reached the end of the query, stop
                if (rangeSubset.end === endIndex) {
                    break;
                }
                editIndex++;
            }
            return matchPath;
        });
    }

    searchHistory(query: string, continueSearch?: () => boolean): QueryMatch | null {
        for (const headChild of this.head.getChildren()) {
            // console.log(headChild.treeIndexCount());
            const match = headChild.search({ query, exactIndex: false, continueSearch });
            if (match) {
                return match;
            }
        }
        return null;
    }

    isEmpty(): boolean {
        return this.edits.length === 0;
    }

    // Use binary search to find the edit at a given position
    // This method is a bit confusing, since there could be
    // two edits abutting the position; currently unused
    // findEditAt(position: number): EditNode | undefined {
    //     let low = 0;
    //     let high = this.edits.length - 1;
    //     while (low <= high) {
    //         const mid = Math.floor((low + high) / 2);
    //         const edit = this.edits[mid];
    //         if (edit.range.contains(position)) return edit;
    //         if (edit.range.end < position) low = mid + 1;
    //         else high = mid - 1;
    //     }
    //     return undefined;
    // }

    public findEditsWithinRange(span: Span, ignoreAbutting = true): EditNode[] {
        const result: EditNode[] = [];
        let lastBefore = this.findLastEditBefore(span.start);
        for (let i = lastBefore + 1; i < this.edits.length; i++) {
            // Ignore edits that abut but do not overlap
            const editRange = this.edits[i].range;
            let lowerBound = span.start;
            let upperBound = span.end;
            if (ignoreAbutting) {
                lowerBound += 1;
                upperBound -= 1;
            }
            if (editRange.end < lowerBound) {
                continue;
            }
            if (editRange.start > upperBound) {
                break;
            }
            result.push(this.edits[i]);
        }
        return result;
    }

    public getAuthors(span: Span, ignoreAbutting: boolean): Set<string> {
        const authors = new Set<string>();
        const edits = this.findEditsWithinRange(span, ignoreAbutting);
        for (const edit of edits) {
            authors.add(edit.metadata.author);
        }
        return authors;
    }

    public getTextInRangeInclusive(span: Span): string {
        const edits = this.findEditsWithinRange(span, false);
        let result = '';
        for (const edit of edits) {
            const overlapStart = Math.max(edit.range.start, span.start);
            const overlapEnd = Math.min(edit.range.end, span.end);
            const localStart = overlapStart - edit.range.start;
            const localEnd = overlapEnd - edit.range.start;
            result += edit.text.substring(localStart, localEnd);
        }
        return result;
    }

    private findLastEditBefore(position: number): number {
        let low = 0;
        let high = this.edits.length - 1;
        let result = -1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const edit = this.edits[mid];
            if (edit.range.end <= position) {
                result = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return result;
    }

    private findFirstEditAfter(position: number): number {
        let low = 0;
        let high = this.edits.length - 1;
        let result = this.edits.length;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const edit = this.edits[mid];
            if (edit.range.start >= position) {
                result = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return result;
    }

    public clearEdits() {
        this.edits = [];
        this.head = createHeadNode();
    }

    setInitialText(text: string, time: number) {
        if (this.edits.length > 0) {
            throw new Error('Initial text can only be set on an empty EditList');
        }
        const range = new Span(0, text.length);
        const child = new EditNode(range, text, { author: Author.ExistingText, startTime: time, endTime: time });
        this.edits.push(child);
        this.head.addChild(child);
    }

    public revertToHistoricalMatch(match: QueryMatch, time: number) {
        this.edits = [];
        // TODO: Likely have to do something with updating text and ranges for partial matches!!
        this.insertQueryMatch(0, match, time, 0);
    }

    addEdit(changeEvent: IChangeEvent, metadata: Metadata, isUndoOrRedo = false, pasteMatch: QueryMatch | null = null) {
        this.trace('Current edits:', this.toStringWithRanges());

        const { text, rangeLength, rangeOffset } = changeEvent;
        const replacedSpan = new Span(rangeOffset, rangeLength + rangeOffset);
        this.trace(`Adding edit: "${text}" at ${replacedSpan}`);
        const overlappingEdits = this.findEditsWithinRange(replacedSpan);
        const containedEdits = [];
        for (const edit of overlappingEdits) {
            const containsStart = edit.range.containsProperly(replacedSpan.start);
            const containsEnd = edit.range.containsProperly(replacedSpan.end);
            if (containsStart && containsEnd) {
                if (replacedSpan.start === replacedSpan.end) {
                    // If it's a 0-length edit (insertion)
                    // Only need one split, and nothing is contained, since this edit
                    // doesn't replace anything. It just splits existing text in two.
                    this.splitEdit(edit, replacedSpan.start);
                } else {
                    // If the edit completely contains the change range, split it into three parts
                    // Left part (before), middle part (to be replaced), right part (after)
                    const { rightEdit } = this.splitEdit(edit, replacedSpan.start);
                    const { leftEdit } = this.splitEdit(rightEdit, replacedSpan.end);
                    containedEdits.push(leftEdit);
                }
            } else if (containsStart) {
                // If the edit contains only the start of the change range, split off the end
                const { rightEdit } = this.splitEdit(edit, replacedSpan.start);
                containedEdits.push(rightEdit);
            } else if (containsEnd) {
                // If the edit contains only the end of the change range, split off the start
                const { leftEdit } = this.splitEdit(edit, replacedSpan.end);
                containedEdits.push(leftEdit);
            } else if (replacedSpan.start <= edit.range.start && replacedSpan.end >= edit.range.end) {
                // If the span completely contains the edit, just remove it;
                // No need to split it up
                containedEdits.push(edit);
            } else {
                this.trace(`Overlapping edits should be split: contains start ${containsStart}, contains end ${containsEnd}`, edit, replacedSpan);
            }
        }

        // Remove contained edits, which are now superseded by this edit
        if (containedEdits.length > 0) {
            let before = this.findLastEditBefore(replacedSpan.start);
            let after = this.findFirstEditAfter(replacedSpan.end);
            if (after === -1) {
                after = this.edits.length;
            }

            if (before !== -1 && after !== this.edits.length) {
                // If there are edits both before and after the removed edits,
                // connect them
                this.edits[before].addChild(this.edits[after]);
            }

            const expectedLength = after - before - 1;
            if (expectedLength !== containedEdits.length) {
                this.trace('Before:', this.toStringWithRanges());
                this.trace(`Finding edits between ${before} and ${after}, expected ${containedEdits.length}, found ${expectedLength}`);
                this.trace('Contained edits:', containedEdits.map(e => e.text + `${e.range}`).join(', '));
                throw new Error('Internal error: mismatch in contained edits');
            }
            this.trace('Removing edits:\n', containedEdits.map(e => e.text + `${e.range}`).join(', '));
            this.edits.splice(before + 1, expectedLength);
        }

        // We don't have to worry about shifting edits that overlap with
        // the change because they will be removed
        this.shiftEdits(replacedSpan.end, replacedSpan, text);

        this.trace('After splits, shifts and removals:', this.toStringWithRanges());

        if (text.length !== 0) {
            const index = this.findLastEditBefore(replacedSpan.start) + 1;
            const priorEdit = this.edits[index - 1];
            const subsequentEdit = this.edits[index];
            let matchPath: QueryMatch | null = this.findUndoOrRedoMatch(isUndoOrRedo, index, subsequentEdit, text);
            if (matchPath) {
                // If we've created this text at this position before, just reconnect to that edit
                this.trace('Reusing existing edit', matchPath[0]);
                this.insertQueryMatch(replacedSpan.start, matchPath, metadata.endTime, index);

            } else if (pasteMatch) {
                this.trace('Using paste match', pasteMatch);
                const nodes = [];
                let spanStart = replacedSpan.start;
                let lastNode = priorEdit;
                for (const match of pasteMatch) {
                    const text = match.node.text.substring(match.range.start, match.range.end + 1);
                    const range = new Span(spanStart, spanStart + text.length);
                    spanStart += text.length;
                    const nodeMetadata = {
                        ...metadata,
                        author: match.node.metadata.author
                    };
                    const newNode = new EditNode(range, text, nodeMetadata);
                    nodes.push(newNode);
                    if (lastNode) {
                        lastNode.addChild(newNode);
                    }
                    lastNode = newNode;
                }
                if (subsequentEdit) {
                    if (spanStart !== subsequentEdit.range.start) {
                        this.logError('Internal error: paste match does not align with subsequent edit', spanStart, subsequentEdit.range.start);
                    }
                    nodes[nodes.length - 1].addChild(subsequentEdit);
                }
                this.edits.splice(index, 0, ...nodes);
            } else if (priorEdit && priorEdit.metadata.author === metadata.author && priorEdit.range.end === replacedSpan.start &&
                // We only append if this doesn't delete text and it inserts in an existing gap
                replacedSpan.start === replacedSpan.end && overlappingEdits.length === 0
            ) {
                // If this edit is immediately after an edit by the same author, merge them
                this.trace('Merging with prior edit', priorEdit, `${priorEdit.text} -> "${priorEdit.text + text}"`);
                priorEdit.range = new Span(priorEdit.range.start, replacedSpan.start + text.length);
                priorEdit.text += text;
                priorEdit.metadata.endTime = metadata.endTime;

                for (const edge of priorEdit.getOutEdges()) {
                    // Only update the active edge
                    if (edge.child === subsequentEdit) {
                        edge.textIndices.push(priorEdit.text.length);
                    }
                }

                // No need to connect to subsequent edit; split would have already done so
            } else {
                // Otherwise, insert a new edit
                this.trace(`Adding edit: "${text}" at ${replacedSpan}`);
                const editRange = new Span(replacedSpan.start, replacedSpan.start + text.length);
                const edit = new EditNode(editRange, text, metadata);
                this.trace('Inserting at', index);
                this.edits.splice(index, 0, edit);

                if (priorEdit && priorEdit.range.end === edit.range.start) {
                    // If this edit is immediately after an edit, connect them
                    this.trace('Connecting to prior edit');
                    priorEdit.addChild(edit);
                }
                if (subsequentEdit && subsequentEdit.range.start === edit.range.end) {
                    // If this edit is immediately before an edit, connect them
                    this.trace('Connecting to subsequent edit');
                    edit.addChild(subsequentEdit);
                }
            }
        }

        // this.defragment();

        if (this.edits.length > 0 && !this.head.getChildren().includes(this.edits[0])) {
            this.head.addChild(this.edits[0]);
        }

        this.trace('Final edits:', this.toStringWithRanges());
    }

    private insertQueryMatch(rangeStart: number, matchPath: QueryMatch, updateTime: number, insertionIndex: number) {
        // These nodes are already in the graph, so just update the edits list
        const nodes = matchPath.map(m => m.node);
        nodes.forEach(n => {
            n.metadata.endTime = updateTime;
            n.range = new Span(rangeStart, rangeStart + n.text.length);
            rangeStart += n.text.length;
        });
        this.edits.splice(insertionIndex, 0, ...nodes);
    }

    private findUndoOrRedoMatch(isUndoOrRedo: boolean, index: number, subsequentEdit: EditNode, text: string) {
        if (!isUndoOrRedo) {
            return null;
        }

        // TODO: Handle index = 0
        const priorEdit = index === 0 ? this.head : this.edits[index - 1];

        let matchPath;
        for (const edge of priorEdit.getOutEdges()) {
            // Recreate the ignoreMap each time, so it doesn't accumulate
            const ignoreMap: Map<EditNode, number[]> = new Map();
            for (let i = index; i < this.edits.length; i++) {
                // Don't search any edits that are already active; these
                // cannot be the target of an undo/redo operation
                ignoreMap.set(this.edits[i], [0]);
            }

            // Only look for children that come from the very end of this edit
            if (!edge.textIndices.includes(priorEdit.text.length)) {
                continue;
            }
            matchPath = edge.child.search({ query: text, exactIndex: true, checked: ignoreMap, subsequentEdit: subsequentEdit }); // TODO: change to true when done testing
            if (matchPath) {
                break;
            }
        }
        if (!matchPath) {
            // TODO: Remove; juts for debugging
            // this.findUndoOrRedoMatch(true, index, subsequentEdit, text);
            this.logError('Internal error: undo/redo edit not found in subsequent edit');
            return null;
        }

        // TODO: I can't think of any way this would happen. If so,
        // then I could definitely optimize search by requiring whole ranges.
        for (const match of matchPath) {
            if (match.range.start !== 0 || match.range.end !== match.node.text.length - 1) {
                this.logError('Internal error: undo/redo match is not a full edit');
            }
        }

        // Split nodes

        return matchPath;
    }

    // Not needed, since we append to existing edits, and we don't actually
    // want to heal splits in the graph
    // Could actually be useful now that we have edge indices edits, could be moreso if
    // we also have edge indices to the child
    private defragment() {
        for (let i = 0; i < this.edits.length - 1; i++) {
            const current = this.edits[i];
            const next = this.edits[i + 1];
            // this.trace(`Checking ${current.range} and ${next.range}`);
            if (current.range.end === next.range.start &&
                current.metadata.author === next.metadata.author
            ) {
                this.trace('Merging edits');
                // Merge next into current
                const mergedEdit = new EditNode(
                    new Span(current.range.start, next.range.end),
                    current.text + next.text,
                    {
                        author: current.metadata.author,
                        startTime: Math.min(current.metadata.startTime, next.metadata.startTime),
                        endTime: Math.max(current.metadata.endTime, next.metadata.endTime)
                    }
                );
                for (const child of current.getChildren()) {
                    if (child !== next) {
                        mergedEdit.addChild(child);
                    }
                }
                for (const child of next.getChildren()) {
                    mergedEdit.addChild(child);
                }
                this.edits.splice(i, 2, mergedEdit);
                i--; // Recheck at this index
            }
        }
    }

    private splitEdit(edit: EditNode, splitPosition: number) {
        this.trace(`Splitting edit ${edit.text} at ${splitPosition}`);

        const { leftEdit, rightEdit } = edit.splitAndRemove(splitPosition);

        const index = this.edits.indexOf(edit);
        this.edits.splice(index, 1, leftEdit, rightEdit);
        if (this.head.getChildren().includes(edit)) {
            this.head.removeChild(edit);
        }
        return { leftEdit, rightEdit };
    }

    private shiftEdits(start: number, replacedRange: Span, text: string) {
        const delta = text.length - (replacedRange.end - replacedRange.start);
        if (delta === 0) {
            return;
        }
        for (const edit of this.edits) {
            if (edit.range.end <= start) {
                continue;
            }
            edit.range = edit.range.shift(delta);
        }
    }

    toPlainText(): string {
        return this.edits.map(edit => edit.text).join('');
    }

    toStringWithRanges(): string {
        return this.edits.map(edit => {
            return `<[${edit.metadata.author}]${edit.text}${edit.range}/>`;
        }).join('');
    }

    toString(): string {
        return this.edits.map(edit => {
            return `<[${edit.metadata.author}]${edit.text}/>`;
        }).join('');
    }

    // TODO: Not sure how I want to copy the nodes
    // or if that's even necessary with the new approach
    copy() {
        const newList = new EditList();
        // TODO: Note shallow copy
        newList.edits = this.edits.map(e => e.shallowCopy());
        return newList;
    }
}
