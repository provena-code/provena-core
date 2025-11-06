import { z } from 'zod';

// Base event
const EventBase = z.object({
  type: z.string(), // will refine in specific events
  time: z.number(),
});

// Document-related base
const DocumentEventBase = EventBase.extend({
  documentUri: z.string(),
  /** Hash of the document text *after* the event has occurred. */
  documentTextHash: z.string(),
  /** Text of the document *after* the event has occurred. */
  documentText: z.string().optional(),
});

// IChangeEvent schema
const IChangeEvent = z.object({
  text: z.string(),
  rangeLength: z.number(),
  rangeOffset: z.number(),
});

// Specific event schemas

export const EDIT_EVENT_TYPE = 'EditEvent';
export const EditEvent = DocumentEventBase.extend({
  type: z.literal(EDIT_EVENT_TYPE),
  contentChanges: z.array(IChangeEvent),
  isUndoOrRedo: z.boolean().optional(),
});

export const COPY_EVENT_TYPE = 'CopyEvent';
export const CopyEvent = EventBase.extend({
  type: z.literal(COPY_EVENT_TYPE),
  copiedText: z.string(),
});

export const SAVE_EVENT_TYPE = 'SaveEvent';
export const SaveEvent = DocumentEventBase.extend({
  type: z.literal(SAVE_EVENT_TYPE),
  documentText: z.string(), // required on save
});

export const FOCUS_EVENT_TYPE = 'FocusDocumentEvent';
export const FocusDocumentEvent = DocumentEventBase.extend({
  type: z.literal(FOCUS_EVENT_TYPE),
});

export const SYNC_EVENT_TYPE = 'SyncEvent';
export const SyncEvent = DocumentEventBase.extend({
  type: z.literal(SYNC_EVENT_TYPE),
  documentText: z.string(), // required on sync
});

const eventTypes = [
  EditEvent,
  CopyEvent,
  SaveEvent,
  FocusDocumentEvent,
  SyncEvent,
] as const;

// Discriminated union of all events
export const LogEvent = z.discriminatedUnion('type', eventTypes);

// TypeScript types inferred from Zod
export type IChangeEvent = z.infer<typeof IChangeEvent>;
export type EditEvent = z.infer<typeof EditEvent>;
export type CopyEvent = z.infer<typeof CopyEvent>;
export type SaveEvent = z.infer<typeof SaveEvent>;
export type FocusDocumentEvent = z.infer<typeof FocusDocumentEvent>;
export type LogEvent = z.infer<typeof LogEvent>;

