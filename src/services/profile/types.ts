import { z } from 'zod';
import { config } from '../../config/config.js';

export interface Birthday {
  day: number;
  month: number;
  year?: number;
}
export interface SavedProfile {
  biography: string;
  birthday: Birthday | null;
  revision: number;
  updatedAt: string | null;
}

export function validBirthday(value: Birthday, now = new Date()): boolean {
  const year = value.year ?? 2000; // February 29 is valid without a year.
  const days = new Date(Date.UTC(year, value.month, 0)).getUTCDate();
  if (value.day > days) return false;
  if (value.year !== undefined) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (Date.UTC(year, value.month - 1, value.day) > today) return false;
  }
  return true;
}

export const birthdaySchema = z
  .object({
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).max(9999).optional(),
  })
  .strict()
  .refine((value) => validBirthday(value), 'Укажите существующую дату рождения, не позднее сегодняшнего дня.');

export const profileUpdateSchema = z
  .object({
    biography: z
      .string()
      .max(config.PROFILE_BIO_MAX_CHARS * 2)
      .transform((text) =>
        text
          .replace(/\r\n?/g, '\n')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
          .trim(),
      )
      .refine(
        (text) => Array.from(text).length <= config.PROFILE_BIO_MAX_CHARS,
        `О себе: не более ${config.PROFILE_BIO_MAX_CHARS} символов.`,
      ),
    birthday: birthdaySchema.nullable(),
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export const emptyProfile = (): SavedProfile => ({ biography: '', birthday: null, revision: 0, updatedAt: null });
export class ProfileConflict extends Error {}
