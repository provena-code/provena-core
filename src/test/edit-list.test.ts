import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, expect, it } from 'vitest';
import { EditType, IChangeEvent } from '../edits/EditEvent';
import { EditList } from '../edits/EditList';
import { Author } from '../shared/Author';
import { EditNode, Span } from '../shared/edit-data';
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
      firstEvent = false;
      textHistory.push(event.documentText);
      const realChangeEvent = {
        rangeLength: event.documentText.length,
        rangeOffset: 0,
        text: event.documentText,
      } as IChangeEvent;
      editList.addEdit(realChangeEvent, {
        author: Author.ExistingText,
        startTime: event.time,
        endTime: event.time,
      }, EditType.Edit);
      return;
    }
    const editType = event.reason === 1 ? EditType.Undo : event.reason === 2 ? EditType.Redo : EditType.Edit;
    event.contentChanges.forEach(change => {
      console.log('------------------------- Change -------------------------');
      console.log(change, editType !== EditType.Edit ? `(undo/redo: ${event.reason})` : '');
      const realChangeEvent = {
        rangeLength: change.rangeLength,
        rangeOffset: change.rangeOffset,
        text: change.text,
      } as IChangeEvent;
      editList.addEdit(realChangeEvent, {
        author: Author.User,
        startTime: event.time,
        endTime: event.time,
      }, editType);
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
      { text: 'abc', editType: EditType.Edit, author: 'a1' },
      { text: 'ac', editType: EditType.Edit, author: 'a2' },
      { text: 'abc', editType: EditType.Undo, author: 'a2' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    expect(editList.getAuthors(new Span(0, 2), false)).toEqual(new Set(['a1']));
  });

  it('should handle more complex undo/redo', () => {
    const texts = [
      { text: 'Hello World', editType: EditType.Edit, author: 'a1' },
      { text: 'Hello this cruel World', editType: EditType.Edit, author: 'a2' },
      { text: 'Hello this silly World', editType: EditType.Edit, author: 'a3' },
      { text: 'Hello this cruel World', editType: EditType.Undo, author: 'unknown' },
      { text: 'Hello World', editType: EditType.Undo, author: 'unknown' },
      { text: 'Hello this cruel World', editType: EditType.Redo, author: 'unknown' },
      { text: 'Hello this silly World', editType: EditType.Redo, author: 'unknown' },
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
      { text: 'One Two Four Five', editType: EditType.Edit, author: 'a1' },
      { text: 'One Two Three Four Five', editType: EditType.Edit, author: 'a2' },
      { text: 'One Five', editType: EditType.Edit, author: 'a3' },
      { text: 'One Two Three Four Five', editType: EditType.Undo, author: 'a4' },
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
      { text: 'One Two Four Two', editType: EditType.Edit, author: 'a1' },
      { text: 'One  Four Two', editType: EditType.Edit, author: 'a2' },
      { text: 'One Two Four Two', editType: EditType.Undo, author: 'a3' },
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
      { text: 'Two Four Two', editType: EditType.Edit, author: 'a1' },
      { text: ' Four Two', editType: EditType.Edit, author: 'a2' },
      { text: 'Two Four Two', editType: EditType.Undo, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, texts[texts.length - 1].text.length), false)).toEqual(new Set(['a1']));
  });

  it('should not duplicate nodes or edges unnecessarily', () => {
    const texts = [
      { text: 'World', editType: EditType.Edit, author: 'a1' },
      { text: 'HelWorld', editType: EditType.Edit, author: 'a2' },
      { text: 'Hello World', editType: EditType.Edit, author: 'a2' },
      { text: 'HelWorld', editType: EditType.Undo, author: 'a3' },
      // { text: 'Hello World', editType: EditType.Redo, author: 'a3' },
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
      { text: 'World', editType: EditType.Edit, author: 'a1' },
      { text: 'HelWorld', editType: EditType.Edit, author: 'a2' },
      { text: 'Hello World', editType: EditType.Edit, author: 'a2' },
      { text: 'HelWorld', editType: EditType.Undo, author: 'a3' },
      { text: 'World', editType: EditType.Undo, author: 'a3' },
      { text: 'Hello World', editType: EditType.Redo, author: 'a3' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, 5), false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(new Span(6, 10), false)).toEqual(new Set(['a1']));
  });

    it('should handle simple undo/redo', () => {
    const texts = [
      { text: '#Hello\n\nWorld', editType: EditType.Edit, author: 'a1' },
      { text: '#Hello\n#\nWorld', editType: EditType.Edit, author: 'a2' },
      { text: '#Hello\n\nWorld', editType: EditType.Undo, author: 'a3' },
      { text: '#Hello\n#\nWorld', editType: EditType.Redo, author: 'a3' },
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
      { text: 'Hello World', editType: EditType.Edit, author: 'a1' },
      { text: 'Hello to the World', editType: EditType.Edit, author: 'a2' },
      { text: 'Hello World', editType: EditType.Undo, author: 'unknown' },
      { text: '', editType: EditType.Undo, author: 'unknown' },
      { text: 'Hello World', editType: EditType.Redo, author: 'unknown' },
      { text: 'Hello to the World', editType: EditType.Redo, author: 'unknown' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
    console.log(editList.toString());

    expect(editList.getAuthors(new Span(0, 5), false)).toEqual(new Set(['a1']));
    expect(editList.getAuthors(new Span(6, 12), false)).toEqual(new Set(['a2']));
    expect(editList.getAuthors(new Span(13, 17), false)).toEqual(new Set(['a1']));
  });

  it('should choose the right node to insert on undo/redo under ambiguity', () => {
    const texts = [
      { text: 'a', editType: EditType.Edit, author: 'a1' },
      { text: 'abcd', editType: EditType.Edit, author: 'a1' },
      { text: 'a', editType: EditType.Edit, author: 'a1' },
      { text: '', editType: EditType.Edit, author: 'a1' },
      { text: 'a', editType: EditType.Edit, author: 'a2' },
      { text: 'ab', editType: EditType.Edit, author: 'a2' },
      { text: 'a', editType: EditType.Edit, author: 'a2' },
      { text: '', editType: EditType.Edit, author: 'a2' },
      { text: 'a', editType: EditType.Undo, author: 'unknown' },
      { text: 'ab', editType: EditType.Undo, author: 'unknown' },
      { text: 'a', editType: EditType.Undo, author: 'unknown' },
      { text: '', editType: EditType.Undo, author: 'unknown' },
      { text: 'a', editType: EditType.Undo, author: 'unknown' },
      { text: 'abcd', editType: EditType.Undo, author: 'unknown' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
  });

  it('should handle branching ambiguity in undo/redo', () => {
    const texts = [
      { text: 'abc', editType: EditType.Edit, author: 'a1' },
      { text: 'abcdef', editType: EditType.Edit, author: 'a1' },
      { text: 'abcdefhij', editType: EditType.Edit, author: 'a1' },
      { text: 'abc', editType: EditType.Edit, author: 'a1' },
      { text: 'abcdzz', editType: EditType.Edit, author: 'a1' },
      { text: 'abc', editType: EditType.Undo, author: 'unknown' },
      { text: 'abcdefhij', editType: EditType.Undo, author: 'unknown' },
      { text: 'abcdef', editType: EditType.Undo, author: 'unknown' },
      { text: 'abc', editType: EditType.Undo, author: 'unknown' },
      { text: 'abcdef', editType: EditType.Redo, author: 'unknown' },
      { text: 'abcdefhij', editType: EditType.Redo, author: 'unknown' },
      { text: 'abc', editType: EditType.Redo, author: 'unknown' },
      { text: 'abcdzz', editType: EditType.Redo, author: 'unknown' },
      { text: 'abc', editType: EditType.Redo, author: 'unknown' },
    ] as EditDef[];
    const editList = createEditList(texts, false);
    expect(editList.toPlainText()).toEqual(texts[texts.length - 1].text);
  });

  it('should handle replacing a word with itself', () => {
    const editList = new EditList();
    editList.logError = (...args: any[]) => {
      console.error(...args);
      assert.fail('Error logged during test');
    };
    editList.trace = (...args: any[]) => { console.log(...args); };
    addEdit(editList, {
        rangeOffset: 0,
        rangeLength: 0,
        text: 'Hello World',
      },
      EditType.Edit,
    );
    addEdit(editList, {
        rangeOffset: 6,
        rangeLength: 5,
        text: 'World',
      },
      EditType.Edit,
    );
    addEdit(editList, {
        rangeOffset: 8,
        rangeLength: 3,
        text: 'rldly',
      },
      EditType.Edit,
    );
    addEdit(editList, {
        rangeOffset: 8,
        rangeLength: 5,
        text: 'rld',
      },
      EditType.Undo,
    );
    addEdit(editList, {
        rangeOffset: 6,
        rangeLength: 5,
        text: 'World',
      },
      EditType.Undo,
    );
    addEdit(editList, {
        rangeOffset: 6,
        rangeLength: 5,
        text: 'World',
      },
      EditType.Redo,
    );
    addEdit(editList, {
        rangeOffset: 8,
        rangeLength: 3,
        text: 'rldly',
      },
      EditType.Redo,
    );
  });

});

function addEdit(editList: EditList, changeEvent: IChangeEvent, editType: EditType, author = Author.User) {
  editList.addEdit(changeEvent, {
    author,
    startTime: Date.now(),
    endTime: Date.now(),
  }, editType);
}