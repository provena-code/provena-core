
import { Author } from '../shared/Author';
import { EditNode, Span } from '../shared/edit-data';
import { assert, expect, test, } from 'vitest';

function createNode(text: string): EditNode {
    return new EditNode(new Span(0, text.length), text, {
        author: Author.Unknown,
        startTime: Date.now(),
        endTime: Date.now(),
    });
}

describe('EditNode search', () => {
    it('finds text in single node', () => {
        const node = createNode('Hello world');
        const match = node.search({query: 'world', exactIndex: false});
        expect(match).not.toBeNull();
        expect(match?.length).toBe(1);
        expect(match?.[0].node).toBe(node);
        expect(match?.[0].range.start).toBe(6);
        expect(match?.[0].range.end).toBe(10);
    });

    it('finds text across multiple nodes', () => {
        const parent = createNode('Hello ');
        const child = createNode('world');
        parent.addChild(child);
        const match = parent.search({query: 'llo wo', exactIndex: false});
        expect(match).not.toBeNull();
        expect(match?.length).toBe(2);
        expect(match?.[0].node).toBe(parent);
        expect(match?.[0].range.start).toBe(2);
        expect(match?.[0].range.end).toBe(5);
        expect(match?.[1].node).toBe(child);
        expect(match?.[1].range.start).toBe(0);
        expect(match?.[1].range.end).toBe(1);
    });

    it('finds matches in children when that parent does not match', () => {
        const parent = createNode('Hello ');
        const child1 = createNode('world');
        parent.addChild(child1);
        const match = parent.search({query: 'orl', exactIndex: false});
        expect(match).not.toBeNull();
        expect(match?.length).toBe(1);
        expect(match?.[0].node).toBe(child1);
        expect(match?.[0].range.start).toBe(1);
        expect(match?.[0].range.end).toBe(3);
    });
    it('finds the most recent match of multiple', () => {
        const root = createNode('Start ');
        const child1 = createNode('Hello world');
        const child2 = createNode('Goodbye world');
        root.addChild(child1);
        root.addChild(child2);
        const match = root.search({query: 'world', exactIndex: false});
        expect(match).not.toBeNull();
        expect(match?.length).toBe(1);
        expect(match?.[0].node).toBe(child2);
        expect(match?.[0].range.start).toBe(8);
        expect(match?.[0].range.end).toBe(12);
    });
    it('returns null when no match', () => {
        const node = createNode('Hello world');
        const match = node.search({query: 'world!', exactIndex: false});
        expect(match).toBeNull();

        const match2 = node.search({query: 'Helloworld', exactIndex: false});
        expect(match2).toBeNull();

        const match3 = node.search({query: 'Oh Hello', exactIndex: false});
        expect(match3).toBeNull();
    });
    it('empty query gives error', () => {
        const node = createNode('Hello world');
        expect(() => node.search({query: '', exactIndex: false})).toThrowError('Query cannot be empty');
    });
});