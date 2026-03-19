import { describe, expect, it } from 'vitest';
import { EditList } from '../edits/EditList';
import { DocumentStatus, EditListBuilder } from '../edits/EditListBuilder';
import { Author } from '../shared/Author';
import { Span } from '../shared/edit-data';
import { createEditEvent, createNewEditList, createUserEditEvents, extractEdits } from './edit-utils';

describe('EditListBuilder', () => {
  describe('createEditListWithEvents', () => {
    it('should correctly attribute copied text', () => {
      const texts = [
        '',
        'Hello ',
        'Hello  World',
        'Hello Hello  World World',
      ];

      const edits = extractEdits(texts);

      const editListBuilder = new EditListBuilder(createNewEditList(false));

       // Set initial text
      editListBuilder.verifyDocumentText(texts[0], 0, true);
      // Write out the the first edit by keystrokes
      createUserEditEvents(edits[0]).forEach(e => editListBuilder.addEditEvent(e));
      editListBuilder.addEditEvent(createEditEvent(edits[1]));
      editListBuilder.addCopyEvent('Hello  World');
      editListBuilder.addEditEvent(createEditEvent(edits[2]));

      const editList = editListBuilder.editList;

      expect(editList.toPlainText()).toBe(texts[texts.length - 1]);
      expect(editList.getAuthors(new Span(0, 12), true)).toEqual(new Set([Author.User]));
      expect(editList.getAuthors(new Span(13, 24), true)).toEqual(new Set([Author.System]));

    });
  });

  describe('removeRedundantTextChanges', () => {
    it('should handle insertions with redundant text', () => {
      const builder = new EditListBuilder(new EditList());
      const originalText = 'This is my original text';
      builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
      const originalEdit = { text: 'This is my new original text', rangeOffset: 0, rangeLength: originalText.length };
      const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

      expect(modifiedEdit).toEqual({ text: 'new ', rangeOffset: 11, rangeLength: 0 });
    });

    it('should handle replacements with redundant text', () => {
      const builder = new EditListBuilder(new EditList());
      const originalText = 'This is my original text';
      builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
      const originalEdit = { text: 'This is my new text', rangeOffset: 0, rangeLength: originalText.length };
      const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

      expect(modifiedEdit).toEqual({ text: 'new', rangeOffset: 11, rangeLength: 'original'.length });
    });

    it('should return null for identical content', () => {
      const builder = new EditListBuilder(new EditList());
      const originalText = 'This is my original text';
      builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
      const originalEdit = { text: 'This is my original text', rangeOffset: 0, rangeLength: originalText.length };
      const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

      expect(modifiedEdit).toBeNull();
    });

    it('should handle pure deletions', () => {
        const builder = new EditListBuilder(new EditList());
        const originalText = 'This is my original text';
        builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
        const originalEdit = { text: 'This is my text', rangeOffset: 0, rangeLength: originalText.length };
        const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

        expect(modifiedEdit).toEqual({ text: '', rangeOffset: 11, rangeLength: 'original '.length });
    });

    it('should handle replacements at the beginning', () => {
        const builder = new EditListBuilder(new EditList());
        const originalText = 'This is my original text';
        builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
        const originalEdit = { text: 'Cats is my original text', rangeOffset: 0, rangeLength: originalText.length };
        const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

        expect(modifiedEdit).toEqual({ text: 'Cat', rangeOffset: 0, rangeLength: 'Thi'.length });
    });

    it('should handle replacements at the end', () => {
        const builder = new EditListBuilder(new EditList());
        const originalText = 'This is my original text';
        builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
        const originalEdit = { text: 'This is my original document', rangeOffset: 0, rangeLength: originalText.length };
        const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

        expect(modifiedEdit).toEqual({ text: 'document', rangeOffset: 'This is my original '.length, rangeLength: 'text'.length });
    });

    it('should handle insertion with overlapping prefix/suffix', () => {
        const builder = new EditListBuilder(new EditList());
        const originalText = 'aaabbb';
        builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
        const originalEdit = { text: 'aaaxbbb', rangeOffset: 0, rangeLength: originalText.length };
        const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);

        expect(modifiedEdit).toEqual({ text: 'x', rangeOffset: 3, rangeLength: 0 });
    });

      it('should respect the config', () => {
        const builder = new EditListBuilder(new EditList());
        const originalText = 'ab';
        builder.addEditEvent(createEditEvent({ text: originalText, rangeOffset: 0, rangeLength: originalText.length }));
        const originalEdit = { text: 'axb', rangeOffset: 0, rangeLength: originalText.length };
        const modifiedEdit = builder.removeRedundantTextChanges(originalEdit);
        expect(modifiedEdit).toEqual(originalEdit);

        builder.config.minRedundantTextLength = 1;
        const modifiedEdit2 = builder.removeRedundantTextChanges(originalEdit);
        expect(modifiedEdit2).toEqual({ text: 'x', rangeOffset: 1, rangeLength: 0 });
    });
  });

  describe('verifyDocumentText', () => {
    it('should verify if the text is unchanged', () => {
      const builder = new EditListBuilder(new EditList());
      builder.editList.setInitialText('Hello World', 0);
      const status = builder.verifyDocumentText('Hello World', 1, true);
      expect(status).toBe(DocumentStatus.Synced);
    });

    it('should treat changes as insertions and deletions', () => {
      const builder = new EditListBuilder(new EditList());
      const editList = builder.editList;
      createUserEditEvents(extractEdits(['', 'Hello This World'])[0]).forEach(e => builder.addEditEvent(e));
      const status = builder.verifyDocumentText('Hello World Bingo', 1, true);
      expect(status).toBe(DocumentStatus.Modified);
      expect(editList.toPlainText()).toBe('Hello World Bingo');
      expect(editList.getAuthors(new Span(0, 11), true)).toEqual(new Set([Author.User]));
      expect(editList.getAuthors(new Span(12, 18), true)).toEqual(new Set([Author.ExternalEdit]));
    });

    it('should reset text if irreconcilable', () => {
      const builder = new EditListBuilder(new EditList());
      const editList = builder.editList;
      createUserEditEvents(extractEdits(['', 'Hello World'])[0]).forEach(e => builder.addEditEvent(e));
      const status = builder.verifyDocumentText('Completely different text', 1, true);
      expect(status).toBe(DocumentStatus.Irreconcilable);
      expect(editList.toPlainText()).toBe('Completely different text');
      expect(editList.getAuthors(new Span(0, 26), true)).toEqual(new Set([Author.ExternalEdit]));
    });
  });
});