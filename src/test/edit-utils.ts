import { assert } from "vitest";
import { EditList } from "../edits/EditList";
import { COPY_EVENT_TYPE, CopyEvent, EDIT_EVENT_TYPE, EditEvent, FOCUS_EVENT_TYPE, FocusDocumentEvent, IChangeEvent, LogEvent } from "../edits/event-types";
import { Author } from "../shared/Author";
import { EditNode, Metadata } from "../shared/edit-data";
import { EditListBuilder } from "../edits/EditListBuilder";

/**
 * Extracts the edit information between two strings.
 * The strings must differ only by a single edit:
 * some (potentially empty) text replaced by other (potentially empty) text.
 * @param s0 The original string.
 * @param s1 The modified string.
 * @returns The edit information.
 */
export function extractEdit(s0: string, s1: string): IChangeEvent {
  let replacedStart = 0;
  for (; replacedStart < s0.length && replacedStart < s1.length; replacedStart++) {
    if (s0[replacedStart] !== s1[replacedStart]) {
      break;
    }
  }
  let replacedEnd = s0.length - 1;
  for (; replacedEnd >= replacedStart; replacedEnd--) {
    let s1Index = replacedEnd + (s1.length - s0.length);
    if (s1Index < 0 || s1Index < replacedStart) {
      break;
    }
    if (s0[replacedEnd] !== s1[s1Index]) {
      break;
    }
  }
  const insertedText = s1.slice(replacedStart, s1.length - (s0.length - replacedEnd - 1));
  const rangeLength = replacedEnd - replacedStart + 1;
  if (replacedEnd < 0) {
    replacedEnd = 0;
  }
  return {
    rangeLength,
    rangeOffset: replacedStart,
    text: insertedText,
  };
}

export type EditDef = {
  text: string;
  isUndoRedo?: boolean;
  author?: string;
}
export type EditDefInput = string | EditDef;

export function extractEdits(texts: string[]) {
  const edits: IChangeEvent[] = [];
  for (let i = 0; i < texts.length - 1; i++) {
    const edit = extractEdit(texts[i], texts[i + 1]);
    edits.push(edit);
  }
  return edits;
}


export function createGenericMetadata(author = Author.Unknown) : Metadata {
  return {
    author,
    startTime: Date.now(),
    endTime: Date.now(),
  };
}

export const WILDCARD = '<*>';

export function getEdges(editList: EditList, from: string, to: string) {
  const headChildren = editList.getHeadChildren();
  let edges = [] as [EditNode, EditNode][];
  const seen = new Set<EditNode>();
  for (const headChild of headChildren) {
    getEdgesRecursive(headChild, from, to, edges, seen);
  }
  return edges;
}

function getEdgesRecursive(node: EditNode, from: string, to: string, edges: [EditNode, EditNode][], seen: Set<EditNode>) {
  if (seen.has(node)) {
    return;
  }
  seen.add(node);
  for (const child of node.getChildren()) {
    if ((from === WILDCARD || node.text === from) &&
        (to === WILDCARD || child.text === to)) {
      edges.push([node, child]);
    }
    getEdgesRecursive(child, from, to, edges, seen);
  }
  return edges;
}

export function createUserEditEvents(change: IChangeEvent): EditEvent[] {
  if (change.text.length === 0) {
    return [createEditEvent(change)];
  }
  const events: EditEvent[] = [];
  if (change.rangeLength > 0) {
    // Deletion event
    const deletionEvent = createEditEvent({
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: '',
    });
    events.push(deletionEvent);
  }
  for (let i = 0; i < change.text.length; i++) {
    const charChange: IChangeEvent = {
      rangeOffset: change.rangeOffset + i,
      rangeLength: 0,
      text: change.text[i],
    };
    events.push(createEditEvent(charChange));
  }
  return events;
}

export function createEditEvent(change: IChangeEvent, isUndoOrRedo: boolean = false) : EditEvent {
  return {
    type: EDIT_EVENT_TYPE,
    time: 0,
    documentUri: 'test-document',
    contentChanges: [change],
    isUndoOrRedo,
  };
}

export function createFocusEvent(initialText: string): FocusDocumentEvent {
  return {
    type: FOCUS_EVENT_TYPE,
    time: 0,
    documentUri: 'test-document',
    documentText: initialText,
  };
}

export function createCopyEvent(copiedText: string): CopyEvent {
  return {
    type: COPY_EVENT_TYPE,
    time: 0,
    copiedText: copiedText,
  };
}

export function createEditEvents(textDefs: EditDefInput[]): LogEvent[] {
  // Remove undo/redo markers from texts
  const texts = textDefs.map(t => t instanceof Object ? t.text : t);
  const editDefs = textDefs.map(t => t instanceof Object ? t : { text: t });

  var edits = extractEdits(texts);
  const initEvent = createFocusEvent(texts[0]);
  const editEvents = edits.map((e, i) => createEditEvent(e, editDefs[i].isUndoRedo));

  return [initEvent, ...editEvents];
}

export function createNewEditList(silently = false) {
  const editList = new EditList();
  if (!silently) {
    editList.trace = (...args: any[]) => { console.log(...args); };
  }
  editList.logError = (...args: any[]) => {
    console.error(...args);
    assert.fail('Error logged during test');
  };
  return editList;
}

export function createEditListWithEvents(textDefsOrEdits: (EditDefInput | EditEvent)[], silently: boolean) {
  const isTextEdit = textDefsOrEdits.map(x => !Object.keys(x).includes('type'));
  const textDefs = textDefsOrEdits.filter((x, i) => isTextEdit[i]) as EditDefInput[];
  const editEvents = createEditEvents(textDefs);
  const events = [];
  let editEventIndex = 0;
  for (let i = 0; i < textDefsOrEdits.length; i++) {
    if (isTextEdit[i]) {
      events.push(editEvents[editEventIndex++]);
    } else {
      events.push(textDefsOrEdits[i] as EditEvent);
    }
  }
  const editListBuilder = new EditListBuilder(createNewEditList(silently));
  events.forEach(e => editListBuilder.onEvent(e));
  return editListBuilder.editList;
}

export function createEditList(textDefs: EditDefInput[], silently: boolean): EditList {

  // Remove undo/redo markers from texts
  const texts = textDefs.map(t => t instanceof Object ? t.text : t);
  const editDefs = textDefs.map(t => t instanceof Object ? t : { text: t });

  var edits = extractEdits(texts);

  const editList = createNewEditList(silently);

  editList.addEdit({
    text: texts[0],
    rangeOffset: 0,
    rangeLength: 0,
  }, createGenericMetadata(editDefs[0]?.author as Author || Author.ExistingText));

  edits.forEach((edit, i) => {
    const editDef = editDefs[i + 1];
    const metadata = createGenericMetadata();
    if (editDef.author) {
      metadata.author = editDef.author as Author;
    }
    console.log('------------------------- Adding Edit -------------------------');
    console.log(edit);
    editList.addEdit(edit, metadata, editDef.isUndoRedo);
  });
  return editList;
}
