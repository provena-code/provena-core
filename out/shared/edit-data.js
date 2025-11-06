export function copyMetadata(metadata) {
    // May be more complex at some point
    return { ...metadata };
}
export function copyEditRange(edit) {
    return {
        range: edit.range.copy(),
        text: edit.text,
        metadata: { ...edit.metadata }
    };
}
export function toPOJO(obj) {
    return Object.assign({}, obj);
}
export class EditNode {
    constructor(range, text, metadata) {
        this.range = range;
        this.text = text;
        this.metadata = metadata;
        this.outEdges = [];
        this.parents = [];
    }
    getChildren() {
        return this.outEdges.map(edge => edge.child);
    }
    getOutEdges() {
        return this.outEdges;
    }
    getParents() {
        return this.parents;
    }
    addChildren(children) {
        children.forEach(child => this.addChild(child));
    }
    addChild(child) {
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
        this.outEdges.unshift({
            textIndices: [this.text.length],
            child
        });
        child.parents.push(this);
    }
    removeChild(child, removeFromParents = true) {
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
    splitAndRemove(splitPosition) {
        if (splitPosition <= this.range.start || splitPosition >= this.range.end) {
            throw new Error(`Invalid split position ${this.range} at ${splitPosition}`);
        }
        const leftEdit = new EditNode(new Span(this.range.start, splitPosition), this.text.substring(0, splitPosition - this.range.start), copyMetadata(this.metadata));
        const rightEdit = new EditNode(new Span(splitPosition, this.range.end), this.text.substring(splitPosition - this.range.start), copyMetadata(this.metadata));
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
            parent.addChild(leftEdit);
        });
        this.removeConnections();
        return { leftEdit, rightEdit };
    }
    shallowCopy() {
        const copy = new EditNode(this.range.copy(), this.text, { ...this.metadata });
        copy.outEdges.push(...this.outEdges);
        return copy;
    }
    searchEdges(queryParams, nQueryIndex, nNodeIndex, startNodeIndex) {
        // We matched all of this node, but not the whole query,
        // so continue the search in each of the children
        for (const edge of this.outEdges) {
            if (!edge.textIndices.includes(nNodeIndex)) {
                continue;
            }
            const match = edge.child.search(queryParams, nQueryIndex);
            if (match) {
                match.unshift({
                    node: this,
                    range: new Span(startNodeIndex, nNodeIndex - 1)
                });
                return match;
            }
        }
        return null;
    }
    search(queryParams, queryIndex = 0) {
        // Destructure parameters for easier access
        const { query, exactIndex, checked = new Map(), subsequentEdit } = queryParams;
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
        }
        else {
            const checkedIndices = checked.get(this);
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
                    const matchedEdges = this.getOutEdges().filter(e => e.child === subsequentEdit &&
                        e.textIndices.includes(nNodeIndex));
                    // If not it isn't a valid match, and we can stop here
                    if (matchedEdges.length === 0) {
                        return null;
                    }
                }
                return [{
                        node: this,
                        range: new Span(startNodeIndex, Math.min(nNodeIndex - 1, this.text.length - 1))
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
        for (const edge of this.outEdges) {
            const match = edge.child.search(queryParams, queryIndex);
            if (match) {
                return match;
            }
        }
        return null;
    }
    toPrintable() {
        return {
            text: this.text,
            children: this.outEdges.map(c => ({ textIndices: c.textIndices, child: c.child.toPrintable() })),
        };
    }
}
export class Span {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        if (start > end) {
            throw new Error(`Invalid span: start ${start} > end ${end}`);
        }
    }
    contains(position) {
        return position >= this.start && position <= this.end;
    }
    containsProperly(position) {
        return position > this.start && position < this.end;
    }
    shift(delta) {
        return new Span(this.start + delta, this.end + delta);
    }
    toString() {
        return `[${this.start}, ${this.end}]`;
    }
    copy() {
        return new Span(this.start, this.end);
    }
}
//# sourceMappingURL=edit-data.js.map