import { assert } from "vitest";
import { createEditList, extractEdits } from "./edit-utils";

describe('Extract Edits', () => {
   it('extract edits correctly', () => {
    const texts = [
      'Hello World',
      'Hello',
      'Hell is o',
      'Hell is others',
      'Hello world, others',
    ];
    const edits = extractEdits(texts);
    edits.forEach(e => console.log(e));
    const editList = createEditList(texts, false);

    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });

  it('handles internal deletions', () => {
    const texts = [
      'Hello World',
      'Hello ld',
    ];
    const edits = extractEdits(texts);
    assert.equal(edits.length, 1);
    const edit = edits[0];
    assert.equal(edit.rangeOffset, 6);
    assert.equal(edit.rangeLength, 3);
    assert.equal(edit.text, '');
    const editList = createEditList(texts, false);
    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });

  it('handles internal deletions surrounded by the same character', () => {
    const texts = [
      'baba',
      'ba',
    ];
    const edits = extractEdits(texts);
    edits.forEach(e => console.log(e));

    const edit = edits[0];
    assert.equal(edit.rangeOffset, 2);
    assert.equal(edit.rangeLength, 2);
    assert.equal(edit.text, '');

    const editList = createEditList(texts, false);

    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });

  it('handles internal deletions surrounded by the same character', () => {
    const texts = [
      'Hello this World',
      'Hello World',
    ];
    const edits = extractEdits(texts);
    edits.forEach(e => console.log(e));

    const edit = edits[0];
    assert.equal(edit.rangeOffset, 6);
    assert.equal(edit.rangeLength, 5);
    assert.equal(edit.text, '');

    const editList = createEditList(texts, false);

    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });

    it('handles deletions at the start', () => {
    const texts = [
      'Hello World',
      'World',
    ];
    const edits = extractEdits(texts);
    assert.equal(edits.length, 1);
    const edit = edits[0];
    assert.equal(edit.rangeOffset, 0);
    assert.equal(edit.rangeLength, 6);
    assert.equal(edit.text, '');
    const editList = createEditList(texts, false);
    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });

  it('handles insertions at the start', () => {
    const texts = [
      'World',
      'Hello World',
    ];
    const edits = extractEdits(texts);
    assert.equal(edits.length, 1);
    const edit = edits[0];
    assert.equal(edit.rangeOffset, 0);
    assert.equal(edit.rangeLength, 0);
    assert.equal(edit.text, 'Hello ');
    const editList = createEditList(texts, false);
    assert.equal(editList.toPlainText(), texts[texts.length - 1]);
  });
});