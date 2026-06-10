import { z } from 'zod';

// We only include the columns we actually need,
// not all of the ones defined by the spec
const MainTableEventBase = z.looseObject({
    // Not actually nullable, but not required for us
    EventID: z.string().optional(),
    EventType: z.string(),
    SubjectID: z.string().optional(),
    ClientTimestamp: z.string().optional(),
    // Might be needed for file renames.
    // Not actually nullable but might as well
    CodeStateSection: z.string().optional(),
    // Not technically universal, but we're not
    // enumerating all possible event types here
    Code: z.string().optional(),
});

const explicitlyDefinedTypes = ['File.Edit', 'File.CopyText', 'File.Rename'];

const GenericMainTableEvent = MainTableEventBase.extend({
    EventType: z.string().refine((val) => !explicitlyDefinedTypes.includes(val)),
});

export const FileEditEvent = MainTableEventBase.extend({
    EventType: z.literal('File.Edit'),
    EditType: z.string(),
    SourceLocation: z.string().optional(),
    InsertText: z.string().optional(),
    DeleteText: z.string().optional(),
    DeleteLength: z.number().optional(),
    ParentEventID: z.string().optional(),
});

export const FileCopyTextEvent = MainTableEventBase.extend({
    EventType: z.literal('File.CopyText'),
    CopiedText: z.string(),
    SourceLocation: z.string().optional(),
    CodeStateSection: z.string().optional(),
});

export const FileRenameEvent = MainTableEventBase.extend({
    EventType: z.literal('File.Rename'),
    CodeStateSection: z.string(),
    DestinationCodeStateSection: z.string(),
});

export const MainTableEvent = z.union([
    FileEditEvent,
    FileCopyTextEvent,
    FileRenameEvent,

    // Put last, just in case, so it checks explicit types first
    GenericMainTableEvent,
]);

export type MainTableEvent = z.infer<typeof MainTableEvent>;
export type FileEditEvent = z.infer<typeof FileEditEvent>;
export type FileCopyTextEvent = z.infer<typeof FileCopyTextEvent>;
export type FileRenameEvent = z.infer<typeof FileRenameEvent>;

export function isFileEditEvent(event: MainTableEvent): event is FileEditEvent {
    return event.EventType === 'File.Edit';
}

export function isFileCopyTextEvent(event: MainTableEvent): event is FileCopyTextEvent {
    return event.EventType === 'File.CopyText';
}

export function isFileRenameEvent(event: MainTableEvent): event is FileRenameEvent {
    return event.EventType === 'File.Rename';
}