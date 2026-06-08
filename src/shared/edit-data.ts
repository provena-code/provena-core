import { Author } from "./Author";
import { Devaluable } from "../serialization/serialization-types";

export type Metadata = {
    author: Author;
    startTime: number;
    endTime: number;
}

export function copyMetadata(metadata: Metadata): Metadata {
    // May be more complex at some point
    return { ...metadata };
}

export interface EditRange {
    range: Span;
    text: string;
    metadata: Metadata;
}

export function copyEditRange(edit: EditRange): EditRange {
    return {
        range: edit.range.copy(),
        text: edit.text,
        metadata: { ...edit.metadata }
    };
}

export function toPOJO(obj: any): any {
    return Object.assign({}, obj);
}

type SimplifiedEditNode = {
    text: string;
    children: { textIndices: number[]; child: SimplifiedEditNode }[];
}

type EditEdge = {
    /**
     * The lengths of the parent node's text after which the child node could come.
     * For example, if the parent is "Hello", and the indices are [2, 3, 4], then this edge represents
     * edges from "He", "Hel", and "Hell" to the child node.
     */
    textIndices: number[];
    child: EditNode;
}

export class EditNode implements EditRange, Devaluable {
    private readonly outEdges: EditEdge[] = [];
    private readonly parents: EditNode[] = [];

    constructor(
        public range: Span,
        public text: string,
        public metadata: Metadata
    ) {

    }

    toPOJO() {
        return {
            ...this,
            // Avoid circular references in serialization;
            // these will be reconstructed during deserialization
            parents: null
        };
    }

    static fromPOJO(data: any): EditNode {
        const node = new EditNode(data.range, data.text, data.metadata);
        if (data.outEdges) {
            (node as any).outEdges = data.outEdges;
        }
        if (data.parents) {
            (node as any).parents = data.parents;
        }
        // Just set the parents for this node's children, since
        // the children should already be reconstructed
        node.outEdges.forEach(edge => {
            edge.child.parents.push(node);
        });
        return node;
    }

    treeSize(): number {
        return this.outEdges.reduce((size, edge) => size + edge.child.treeSize(), 0);
    }

    treeIndexCount(): number {
        return this.outEdges.reduce((count, edge) => count + edge.textIndices.length + edge.child.treeIndexCount(), 0);
    }

    getChildren(): readonly EditNode[] {
        return this.outEdges.map(edge => edge.child);
    }

    getOutEdges(): readonly EditEdge[] {
        return this.outEdges;
    }

    iterateOutEdges(reverse = false): Iterable<EditEdge> {
        return iterate(this.outEdges, reverse);
    }

    getParents(): readonly EditNode[] {
        return this.parents;
    }

    addChildren(children: readonly EditNode[]) {
        children.forEach(child => this.addChild(child));
    }

    addChild(child: EditNode) {
        if (child === this) {
            throw new Error('Cannot add self as child');
        }
        const edge = this.outEdges.find(edge => edge.child === child);
        if (edge) {
            if (edge.textIndices.includes(this.text.length)) {
                return;
            }
            edge.textIndices.push(this.text.length);
            return;
        }
        // Add to the end so that the first index always represents
        // the original subsequent edit. This is helpful for tracking
        // undo/redo, since an multi-edit insertion that's broken up
        // later will point to the parent in the history, and we can
        // follow index 0 to find the subsequent edit.
        this.outEdges.push({
            textIndices: [this.text.length],
            child
        });
        child.parents.push(this);
    }

    replaceChild(oldChild: EditNode, newChild: EditNode) {
        const edgeIndex = this.outEdges.findIndex(edge => edge.child === oldChild);
        if (edgeIndex === -1) {
            throw new Error('Cannot replace child that does not exist');
        }
        this.outEdges[edgeIndex].child = newChild;
        newChild.parents.push(this);
    }

    removeChild(child: EditNode, removeFromParents = true) {
        const edgeIndex = this.outEdges.findIndex(edge => edge.child === child);
        if (edgeIndex !== -1) {
            this.outEdges.splice(edgeIndex, 1);
            if (removeFromParents) {
                const parentIndex = child.parents.indexOf(this);
                if (parentIndex !== -1) {
                    child.parents.splice(parentIndex, 1);
                }
            }
        }
    }

    removeConnections() {
        this.parents.forEach(parent => {
            parent.removeChild(this, false);
        });
        this.outEdges.forEach(edge => {
            const index = edge.child.parents.indexOf(this);
            if (index !== -1) {
                edge.child.parents.splice(index, 1);
            }
        });
        this.parents.length = 0;
        this.outEdges.length = 0;
    }

    splitAndRemove(splitPosition: number): { leftEdit: EditNode; rightEdit: EditNode } {
        if (splitPosition <= this.range.start || splitPosition >= this.range.end) {
            throw new Error(`Invalid split position ${this.range} at ${splitPosition}`);
        }

        const leftEdit: EditNode = new EditNode(
            new Span(this.range.start, splitPosition),
            this.text.substring(0, splitPosition - this.range.start),
            copyMetadata(this.metadata)
        );
        const rightEdit: EditNode = new EditNode(
            new Span(splitPosition, this.range.end),
            this.text.substring(splitPosition - this.range.start),
            copyMetadata(this.metadata)
        );

        for (const edge of this.getOutEdges()) {
            const leftIndices = edge.textIndices.filter(index => index <= leftEdit.text.length);
            const rightIndices = edge.textIndices.filter(index => index > leftEdit.text.length)
                .map(index => index - leftEdit.text.length);
            if (leftIndices.length > 0) {
                leftEdit.outEdges.push({ textIndices: leftIndices, child: edge.child });
                edge.child.parents.push(leftEdit);
            }
            if (rightIndices.length > 0) {
                rightEdit.outEdges.push({ textIndices: rightIndices, child: edge.child });
                edge.child.parents.push(rightEdit);
            }
        }
        leftEdit.addChild(rightEdit);

        this.getParents().forEach(parent => {
            parent.replaceChild(this, leftEdit);
        });

        this.removeConnections();

        return { leftEdit, rightEdit };
    }

    shallowCopy(): EditNode {
        const copy = new EditNode(
            this.range.copy(),
            this.text,
            { ...this.metadata }
        );
        copy.outEdges.push(...this.outEdges);
        return copy;
    }

    private searchEdges(queryParams: QueryParams, nQueryIndex: number, nNodeIndex: number, startNodeIndex: number): QueryMatch | null {
        // We matched all of this node, but not the whole query,
        // so continue the search in each of the children
        for (let edge of this.iterateOutEdges(queryParams.reverseOrder)) {
            if (!edge.textIndices.includes(nNodeIndex)) {
                continue;
            }
            const match = edge.child.search(queryParams, nQueryIndex);
            if (match) {
                match.unshift({
                    node: this,
                    range: new Span(startNodeIndex, nNodeIndex)
                });
                return match;
            }
        }
        return null;
    }

    search(queryParams: QueryParams, queryIndex: number = 0): QueryMatch | null {
        // Stop early if requested. This allows us to bound search by time or other conditions
        if (queryParams.continueSearch && !queryParams.continueSearch()) {
            return null;
        }

        // Destructure parameters for easier access
        const {
            query,
            exactIndex,
            checked = new Map<EditNode, number[]>(),
            subsequentEdit
        } = queryParams;

        // In the future could support this as a parameter, but I don't have a use case for it yet
        let nodeIndex = 0;

        if (query.length === 0) {
            throw new Error('Query cannot be empty');
        }

        // This is a DAG and we're using depth-first search, so we might hit nodes
        // multiple times. To make things more efficient, we keep track of which nodes
        // we've already checked for a given queryIndex, and skip them if we hit them again.
        // This should never happen *during* a recursive call from this node, so it's ok to
        // return null; if the answer wasn't null, we'd have already returned it.
        if (!checked.has(this)) {
            checked.set(this, [queryIndex]);
        } else {
            const checkedIndices = checked.get(this)!;
            if (checkedIndices.includes(queryIndex)) {
                return null;
            }
            checkedIndices.push(queryIndex);
        }

        // If exactIndex is true, we only want to match starting at nodeIndex
        // Otherwise, we can start matching anywhere in this node's text
        const maxLength = exactIndex ? Math.min(this.text.length - 1, nodeIndex) : this.text.length - 1;

        for (; nodeIndex <= maxLength; nodeIndex++) {
            let nQueryIndex = queryIndex;
            let nNodeIndex = nodeIndex;
            const startNodeIndex = nNodeIndex;
            // TODO: In theory could use rabin-karp hasing or similar to speed this up
            // TODO: Will ultimately stop early when we use indexing within the parent
            while (nQueryIndex < query.length && nNodeIndex < this.text.length
                && query.charAt(nQueryIndex) === this.text.charAt(nNodeIndex)) {
                nQueryIndex++;
                nNodeIndex++;

                // If we're ready to break out of the loop, skip checking children
                if (nQueryIndex < query.length && nNodeIndex < this.text.length) {
                    const match = this.searchEdges(queryParams, nQueryIndex, nNodeIndex, startNodeIndex);
                    if (match) {
                        return match;
                    }
                }
            }
            // We've matched the entire query, so we have a match!
            if (nQueryIndex === query.length) {
                if (subsequentEdit) {
                    // Ensure that this match can lead to the subsequent edit
                    const matchedEdges = this.getOutEdges().filter(e =>
                        e.child === subsequentEdit &&
                        e.textIndices.includes(nNodeIndex)
                    );
                    // If not it isn't a valid match, and we can stop here
                    if (matchedEdges.length === 0) {
                        return null;
                    }
                }
                return [{
                    node: this,
                    range: new Span(startNodeIndex, Math.min(nNodeIndex, this.text.length))
                }];
            }
            // We didn't find a full match starting at this index
            if (nNodeIndex < this.text.length) {
                continue;
            }

            const match = this.searchEdges(queryParams, nQueryIndex, nNodeIndex, startNodeIndex);
            if (match) {
                return match;
            }
        }

        if (exactIndex) {
            return null;
        }

        // The query doesn't match this node, so try the children
        for (const edge of this.iterateOutEdges(queryParams.reverseOrder)) {
            const match = edge.child.search(queryParams, queryIndex);
            if (match) {
                return match;
            }
        }
        return null;
    }

    toPrintable(): SimplifiedEditNode {
        return {
            text: this.text,
            children: this.outEdges.map(c => ({ textIndices: c.textIndices, child: c.child.toPrintable() })),
        };
    }
}

export function* iterate<T>(array: T[], reverse: boolean) {
    if (reverse) {
        for (let i = array.length - 1; i >= 0; i--) {
            yield array[i];
        }
    } else {
        for (const item of array) {
            yield item;
        }
    }
}

export type QueryMatchPart = {
    node: EditNode;
    /** A range of indices (start, exclusive end) within the node's text that match. */
    range: Span;
}
export type QueryMatch = QueryMatchPart[];

export type QueryParams = {
    query: string;
    /**
     * If true, only matches starting at the specified index in the node will be considered.
     * Otherwise, matches can start in any descendant of the node.
     */
    exactIndex: boolean;
    /** Temporary map of already checked nodes and indices. */
    checked?: Map<EditNode, number[]>;
    /**
     * If provided, on returns matches that can lead to this subsequent edit.
     * This is used primarily to find nodes as part of an undo/redo edit.
     */
    subsequentEdit?: EditNode;
    /** Function to determine if the search should continue. */
    continueSearch?: () => boolean;
    reverseOrder?: boolean;
}

export class Span implements Devaluable {
    constructor(
        /** Start index of the span, inclusive */
        public readonly start: number,
        /** End index of the span, exclusive */
        public readonly end: number
    ) {
        if (start > end) {
            throw new Error(`Invalid span: start ${start} > end ${end}`);
        }
    }

    static tryCreate(start: number, end: number): Span | null {
        if (start > end) {
            return null;
        }
        return new Span(start, end);
    }

    toPOJO() {
        return toPOJO(this);
    }

    static fromPOJO(data: any): Span {
        return new Span(data.start, data.end);
    }

    // Note: The end index is exclusive for EditNodes
    get length() {
        return this.end - this.start;
    }

    contains(position: number) {
        return position >= this.start && position <= this.end;
    }

    containsProperly(position: number) {
        return position > this.start && position < this.end;
    }

    shift(delta: number): Span {
        return new Span(this.start + delta, this.end + delta);
    }

    toString() {
        return `[${this.start}, ${this.end}]`;
    }

    copy() {
        return new Span(this.start, this.end);
    }
}
