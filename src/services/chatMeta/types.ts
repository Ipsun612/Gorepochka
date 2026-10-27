import { z } from 'zod';

export interface ChatTab {
  slot: number;
  name: string;
}

export interface SavedChatMeta {
  tabs: ChatTab[];
  activeSlot: number;
  revision: number;
  updatedAt: string | null;
}

export const chatTabSchema = z.object({
  slot: z.number().int().min(1).max(5),
  name: z.string().min(1).max(32),
});

export const chatMetaUpdateSchema = z
  .object({
    tabs: z.array(chatTabSchema).min(1).max(5),
    activeSlot: z.number().int().min(1).max(5),
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict()
  .refine((value) => value.tabs.some((tab) => tab.slot === value.activeSlot), {
    message: 'activeSlot must match one of the tabs',
  })
  .refine((value) => new Set(value.tabs.map((tab) => tab.slot)).size === value.tabs.length, {
    message: 'tab slots must be unique',
  });

export type ChatMetaUpdate = z.infer<typeof chatMetaUpdateSchema>;

export const chatRenameSchema = z
  .object({
    slot: z.number().int().min(1).max(5),
    name: z.string().trim().min(1).max(32),
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();

export type ChatRename = z.infer<typeof chatRenameSchema>;
