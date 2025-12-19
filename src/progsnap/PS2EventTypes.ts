import { z } from 'zod';

// We only include the columns we actually need,
// not all of the ones defined by the spec
const MainTableEventBase = z.looseObject({
    // Not actually nullable, but not required for us
    EventID: z.string().nullable(),
    EventType: z.string(),
    SubjectID: z.string().nullable(),
    ClientTimestamp: z.string().nullable(),
    // Not technically universal, but we're not
    // enumerating all possible event types here
    Code: z.string().nullable(),
});

const explicitlyDefinedTypes = ['File.Edit', 'File.CopyText'];

const GenericMainTableEvent = MainTableEventBase.extend({
    EventType: z.string().refine((val) => !explicitlyDefinedTypes.includes(val)),
});

export const FileEditEvent = MainTableEventBase.extend({
    EventType: z.literal('File.Edit'),
    EditType: z.string(),
    SourceLocation: z.string().nullable(),
    InsertText: z.string().nullable(),
    DeleteText: z.string().nullable(),
    DeleteLength: z.number().nullable(),
    // Might be needed for file renames.
    // Not actually nullable but might as well
    CodeStateSection: z.string().nullable(),
    ParentEventID: z.string().nullable(),
});

export const FileCopyTextEvent = MainTableEventBase.extend({
    EventType: z.literal('File.CopyText'),
    CopiedText: z.string(),
    SourceLocation: z.string().nullable(),
    CodeStateSection: z.string().nullable(),
});

export const MainTableEvent = z.union([
    FileEditEvent,
    FileCopyTextEvent,

    // Put last, just in case, so it checks explicit types first
    GenericMainTableEvent,
]);

export type MainTableEvent = z.infer<typeof MainTableEvent>;
export type FileEditEvent = z.infer<typeof FileEditEvent>;
export type FileCopyTextEvent = z.infer<typeof FileCopyTextEvent>;

export function isFileEditEvent(event: MainTableEvent): event is FileEditEvent {
    return event.EventType === 'File.Edit';
}

export function isFileCopyTextEvent(event: MainTableEvent): event is FileCopyTextEvent {
    return event.EventType === 'File.CopyText';
}