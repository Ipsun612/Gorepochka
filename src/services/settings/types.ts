import { z } from 'zod';

export const themeSchema = z.enum(['light', 'dark']);
export const settingsUpdateSchema = z
  .object({
    theme: themeSchema,
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export interface SavedSettings {
  theme: z.infer<typeof themeSchema>;
  revision: number;
  updatedAt: string | null;
}
