import { z } from 'zod';

export enum EditType {
    Edit = 'edit',
    Undo = 'undo',
    Redo = 'redo'
}

// IChangeEvent schema
const IChangeEvent = z.object({
  text: z.string(),
  rangeLength: z.number(),
  rangeOffset: z.number(),
});

// Specific event schemas

export const EditEvent = z.object({
  time: z.number(),
  contentChanges: z.array(IChangeEvent).readonly(),
  editType: z.enum(EditType).optional(),
});

export type EditEvent = z.infer<typeof EditEvent>;
export type IChangeEvent = z.infer<typeof IChangeEvent>;
