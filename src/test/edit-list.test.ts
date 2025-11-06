import { assert, expect, it, describe} from 'vitest';
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditList } from 'provena';
import { IChangeEvent } from 'provena';
import { EditNode, Span } from 'provena';
import { Author } from 'provena';
import { EditDef, WILDCARD, createEditList, getEdges } from './edit-utils';

export type OldEventLog = {
    contentChanges: readonly IChangeEvent[];
    reason: number | undefined;
    documentText: string;
    documentUri: string;
    time: number;
};

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function readTestFile(name: string): OldEventLog[] {
  const filePath = join(__dirname, 'data', name);
  let content = readFileSync(filePath, 'utf-8').trim();
  if (content.endsWith(',')) {
    content = content.slice(0, -1) + ']';
  }
  return JSON.parse(content); // Validate JSON
}

function testFile(name: string, checkReproduction: boolean, checkHistorySearch: boolean) {
  const data = readTestFile(name);
  const editList = new EditList();
  editList.trace = (...args: any[]) => { console.log(...args); };
  editList.logError = (...args: any[]) => {
    console.error(...args);
    assert.fail('Error logged during test');
  };
  console.log(`Testing file ${name} with ${data.length} events`);
  let firstEvent = true;
  let textHistory = [];
  data.forEach(event => {
    if (firstEvent) {
      editList.setInitialText(event.documentText, event.time);
      firstEvent = false;
      textHistory.push(event.documentText);
      return;
    }
    const isUndoRedo = event.reason !== undefined;
    event.contentChanges.forEach(change => {
      console.log('------------------------- Change -------------------------');
      console.log(change, isUndoRedo ? `(undo/redo: ${event.reason})` : '');
      const realChangeEvent = {
        rangeLength: change.rangeLength,
        rangeOffset: change.rangeOffset,
        text: change.text,
      } as IChangeEvent;
      editList.addEdit(realChangeEvent, {
        author: Author.User,
        startTime: event.time,
        endTime: event.time,
      }, isUndoRedo);
    });
    const editText = normalizeLineEndings(editList.toPlainText());
    const documentText = normalizeLineEndings(event.documentText);
    if (checkReproduction) {
      expect(editText).toMatch(documentText);
    }
    textHistory.push(event.documentText);
    if (checkHistorySearch) {
      for (let i = 0; i < textHistory.length; i++) {
        const history = textHistory[i];
        const match = editList.searchHistory(history);
        if (!match) {
          console.log(`Searching for history item ${i}/${textHistory.length}/${data.length} failed: ${history.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
          editList.searchHistory(history);
        }
        expect(match).not.toBeNull();
      }
    }
  });
  return editList;
}



function testHistorySearch(changes: string[], additionalSearchTexts: string[] = []) {
  const editList = createEditList(changes, false);
  for (let i = 0; i < changes.length; i++) {
    const searchText = changes[i];
    const match = editList.searchHistory(searchText);
    if (!match) {
      console.log(`Failed to find match for history item ${i}: \n${searchText.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`);
    }
    expect(match).not.toBeNull();
  }
  for (const searchText of additionalSearchTexts) {
    const match = editList.searchHistory(searchText);
    expect(match).not.toBeNull();
  }
}


describe('Edit List', () => {
  it('should reproduce test1', () => {
    testFile('test1.log', true, false);
  });
  it('should reproduce test2', () => {
    testFile('test2.log', true, false);
  });
  it('should reproduce test3', () => {
    testFile('test3.log', true, false);
  });
  it('should match history for test1', () => {
    testFile('test1.log', false, true);
  });
  it('should match history for test2', () => {
    testFile('test2.log', false, true);
  });

  it('should handle deletions in history search', () => {
    const texts = [
      'Hello World',
      'Hello ld',
    ];
    testHistorySearch(texts);
  });

  it('should handle insertions in history search', () => {
    const texts = [
      'Hello World',
      'Hello cruel World',
    ];
    testHistorySearch(texts);
  });

    it('should handle appends in history search', () => {
    const texts = [
      'Hello World',
      'Hello cWorld',
      'Hello crWorld',
      'Hello cruWorld',
      'Hello crueWorld',
      'Hello cruelWorld',
      'Hello cruel World',
    ];
    testHistorySearch(texts);
  });

  it('should handle deletions', () => {
    const texts = [
      'Hello World',
      'Hello ld',
    ];
    const editList = createEditList(texts, false);
    console.dir((editList.getEdits()[0] as EditNode).toPrintable(), { depth: 5 });

    let e1, e2, e3;
    assert.equal((e1 = getEdges(editList, 'Hello ', 'ld')).length, 1);
    assert.equal((e2 = getEdges(editList, 'Hello ', 'Wor')).length, 1);
    assert.equal((e3 = getEdges(editList, 'Wor', 'ld')).length, 1);

    assert.strictEqual(e1[0][1], e3[0][1]);
    assert.strictEqual(e1[0][0], e2[0][0]);
    assert.strictEqual(e2[0][1], e3[0][0]);
  });

  it('should handle insertions', () => {
    const texts = [
      'Hello World',
      'Hello cruel World',
    ];
    const editList = createEditList(texts, false);
    console.dir((editList.getEdits()[0] as EditNode).toPrintable(), { depth: 5 });

    let e1, e2, e3;
    assert.equal((e1 = getEdges(editList, 'Hello ', 'World')).length, 1);
    assert.equal((e2 = getEdges(editList, 'Hello ', 'cruel ')).length, 1);
    assert.equal((e3 = getEdges(editList, 'cruel ', 'World')).length, 1);

    assert.strictEqual(e1[0][1], e3[0][1]);
    assert.strictEqual(e1[0][0], e2[0][0]);
    assert.strictEqual(e2[0][1], e3[0][0]);
  });

  it('should handle very simple undo/redo', () => {
    const texts = [
      { text: 'abc', isUndoRedo: false, author: 'a1' },
      { text: 'ac', isUndoRedo: false, author: 'a2' },
      { text: 'abc', isUndoRedo: true, author: 'a2' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    expect(editList.getAuthors(new Span(0, 2), false)).toEqual(new Set(['a1']));
  });

  it('should handle more complex undo/redo', () => {
    const texts = [
      { text: 'Hello World', isUndoRedo: false, author: 'a1' },
      { text: 'Hello this cruel World', isUndoRedo: false, author: 'a2' },
      { text: 'Hello this silly World', isUndoRedo: false, author: 'a3' },
      { text: 'Hello this cruel World', isUndoRedo: true, author: 'a1' },
      { text: 'Hello World', isUndoRedo: true, author: 'a1' },
      { text: 'Hello this silly World', isUndoRedo: true, author: 'a1' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    expect(editList.getAuthors(new Span(0, 5), false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(new Span(7, 10), false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(new Span(11, 15), false)).toEqual(new Set(['a3']));
    expect(editList.getAuthors(new Span(17, 21), false)).toEqual(new Set(['a1']));
  });

  it('should handle undoing a deletion with multiple authors', () => {
    const texts = [
      { text: 'One Two Four Five', isUndoRedo: false, author: 'a1' },
      { text: 'One Two Three Four Five', isUndoRedo: false, author: 'a2' },
      { text: 'One Five', isUndoRedo: false, author: 'a3' },
      { text: 'One Two Three Four Five', isUndoRedo: true, author: 'a4' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    const wordRanges = [];
    let length = 0;
    for (const word of texts[texts.length - 1].text.split(' ')) {
      wordRanges.push(new Span(length, length + word.length));
      length += word.length + 1;
    }
    console.log(editList.toString());

    expect(editList.getAuthors(wordRanges[0], false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(wordRanges[1], false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(wordRanges[2], false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(wordRanges[3], false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(wordRanges[4], false)).toEqual(new Set(['a1']));
  });

  it('should handle undoing a deletion of text that exists in multiple locations', () => {
    const texts = [
      { text: 'One Two Four Two', isUndoRedo: false, author: 'a1' },
      { text: 'One  Four Two', isUndoRedo: false, author: 'a2' },
      { text: 'One Two Four Two', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, texts[texts.length - 1].text.length), false)).toEqual(new Set(['a1']));
  });

  it('should correctly attribute testUndo.log', () => {
    const editList = testFile('testUndo.log', true, false);
    expect(editList.getAuthors(new Span(0, 6), false)).toEqual(new Set(['existing-text']));
  });

  it('should handle undo/redo of the first character', () => {
    const texts = [
      { text: 'Two Four Two', isUndoRedo: false, author: 'a1' },
      { text: ' Four Two', isUndoRedo: false, author: 'a2' },
      { text: 'Two Four Two', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, texts[texts.length - 1].text.length), false)).toEqual(new Set(['a1']));
  });

  it('should not duplicate nodes or edges unnecessarily', () => {
    const texts = [
      { text: 'World', isUndoRedo: false, author: 'a1' },
      { text: 'HelWorld', isUndoRedo: false, author: 'a2' },
      { text: 'Hello World', isUndoRedo: false, author: 'a2' },
      { text: 'HelWorld', isUndoRedo: true, author: 'a3' },
      // { text: 'Hello World', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);

    const toLoEdges = getEdges(editList, WILDCARD, 'lo ');
    console.log('->lo Edges', toLoEdges.map(e => e[0].toPrintable()));

    const loNodes = new Set<EditNode>();
    for (const edge of toLoEdges) {
      loNodes.add(edge[1]);
    }

    const toWorldEdges = getEdges(editList, WILDCARD, 'World');
    console.log('->World Edges', toWorldEdges.map(e => e[0].toPrintable()));

    const worldNodes = new Set<EditNode>();
    for (const edge of toWorldEdges) {
      worldNodes.add(edge[1]);
    }

    expect(loNodes.size).toBe(1);
    expect(toLoEdges.length).toBe(1);
    expect(worldNodes.size).toBe(1);
    expect(toWorldEdges.length).toBe(2);
  });

  it('should handle undo/redo that split a node\'s text', () => {
    const texts = [
      { text: 'World', isUndoRedo: false, author: 'a1' },
      { text: 'HelWorld', isUndoRedo: false, author: 'a2' },
      { text: 'Hello World', isUndoRedo: false, author: 'a2' },
      { text: 'HelWorld', isUndoRedo: true, author: 'a3' },
      { text: 'World', isUndoRedo: true, author: 'a3' },
      { text: 'Hello World', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, 5), false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(new Span(6, 10), false)).toEqual(new Set(['a1']));
  });

    it('should handle simple undo/redo', () => {
    const texts = [
      { text: '#Hello\n\nWorld', isUndoRedo: false, author: 'a1' },
      { text: '#Hello\n#\nWorld', isUndoRedo: false, author: 'a2' },
      { text: '#Hello\n\nWorld', isUndoRedo: true, author: 'a3' },
      { text: '#Hello\n#\nWorld', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, 6), false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(new Span(8, 14), false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(new Span(7, 7), false)).toEqual(new Set(['a2']));
  });

  it('should handle undo/redo to empty', () => {
    const texts = [
      { text: 'Hello World', isUndoRedo: false, author: 'a1' },
      { text: 'Hello to the World', isUndoRedo: false, author: 'a2' },
      { text: '', isUndoRedo: true, author: 'a2' },
      { text: 'Hello to the World', isUndoRedo: true, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, 5), false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(new Span(6, 12), false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(new Span(13, 17), false)).toEqual(new Set(['a1']));
  });


});