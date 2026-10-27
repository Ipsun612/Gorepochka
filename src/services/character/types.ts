import { z } from 'zod';
import { TRAITS, defaultTraits, type TraitValues } from './definition.js';

const shape = Object.fromEntries(TRAITS.map((trait) => [trait.id, z.number().int().min(0).max(2)]));
export const traitsSchema = z
  .object(shape)
  .strict()
  .transform((values) => values as TraitValues);
export const characterUpdateSchema = z
  .object({
    traits: traitsSchema,
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export interface SavedCharacter {
  traits: TraitValues;
  revision: number;
  updatedAt: string | null;
}
export type CharacterUpdate = z.infer<typeof characterUpdateSchema>;
export const emptyCharacter = (): SavedCharacter => ({ traits: defaultTraits(), revision: 0, updatedAt: null });
