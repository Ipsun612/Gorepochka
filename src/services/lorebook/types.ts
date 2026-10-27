import { z } from 'zod';

export const LOREBOOK_LIMITS = {
  entries: 3,
  commentChars: 40,
  contentChars: 300,
  keywords: 10,
  keywordChars: 60,
} as const;
export const PRIMARY_MAX_CHARS = 12000;
export const cleanLoreText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim();
export const normalizeKeyword = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/gu, ' ').trim();

function entrySchema(maxChars: number) {
  return z
    .object({
      // Missing titles in existing JSON/SQLite entries remain readable without rewriting storage.
      comment: z
        .string()
        .max(LOREBOOK_LIMITS.commentChars * 2)
        .default('')
        .transform(cleanLoreText)
        .transform((text) => text.replace(/\n/g, ' '))
        .refine((text) => Array.from(text).length <= LOREBOOK_LIMITS.commentChars, 'Название: до 40 символов.'),
      key: z
        .array(
          z
            .string()
            .max(LOREBOOK_LIMITS.keywordChars * 2)
            .transform(cleanLoreText)
            .refine(
              (key) => normalizeKeyword(key).length > 0 && Array.from(key).length <= LOREBOOK_LIMITS.keywordChars,
              'Ключевое слово: от 1 до 60 символов.',
            ),
        )
        .max(LOREBOOK_LIMITS.keywords)
        .transform((keys) =>
          keys.filter(
            (key, index) => keys.findIndex((other) => normalizeKeyword(other) === normalizeKeyword(key)) === index,
          ),
        ),
      content: z
        .string()
        .max(maxChars * 2)
        .transform(cleanLoreText)
        .refine(
          (text) => text.length > 0 && Array.from(text).length <= maxChars,
          `Текст: от 1 до ${maxChars} символов.`,
        ),
      constant: z.boolean(),
    })
    .strict()
    .refine(
      (entry) => entry.constant || entry.key.length > 0,
      'Добавьте ключевое слово или включите постоянную запись.',
    );
}

export const userEntrySchema = entrySchema(LOREBOOK_LIMITS.contentChars);
export const userEntriesSchema = z.array(userEntrySchema).max(LOREBOOK_LIMITS.entries);
export const lorebookUpdateSchema = z
  .object({
    entries: userEntriesSchema,
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export const primaryLorebookSchema = z
  .object({ entries: z.record(z.string().regex(/^(0|[1-9]\d{0,5})$/), entrySchema(PRIMARY_MAX_CHARS)) })
  .strict()
  .refine(
    ({ entries }) =>
      Object.keys(entries).length > 0 &&
      Object.keys(entries).length <= 64 &&
      Object.values(entries).reduce((sum, entry) => sum + Array.from(entry.content).length, 0) <= PRIMARY_MAX_CHARS,
    'Основной лорбук: 1–64 записи, суммарно не более 12000 символов текста.',
  );
export type LoreEntry = z.infer<typeof userEntrySchema>;
export type LorebookUpdate = z.infer<typeof lorebookUpdateSchema>;
export interface SavedLorebook {
  entries: LoreEntry[];
  revision: number;
  updatedAt: string | null;
}
export const emptyLorebook = (): SavedLorebook => ({ entries: [], revision: 0, updatedAt: null });
