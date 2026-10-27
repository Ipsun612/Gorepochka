import fs from 'node:fs';
import path from 'node:path';
import { primaryLorebookSchema, type LoreEntry } from './types.js';

let cached: Record<string, LoreEntry> | undefined;
/** One developer-owned file, outside the static webapp and ordered system prompts. */
export function loadPrimaryLorebook(
  filename = path.resolve(process.cwd(), 'lorebooks/gorepochka.json'),
): Record<string, LoreEntry> {
  try {
    if (fs.statSync(filename).size > 256 * 1024) throw new Error('Oversized lorebook');
    const parsed = primaryLorebookSchema.parse(JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')));
    cached = parsed.entries;
    return structuredClone(cached);
  } catch {
    // Never echo file content (which may contain private developer-authored lore).
    throw new Error(
      'Could not load lorebooks/gorepochka.json: use valid entries with only key, comment (title, max 40 characters), content and constant; max 64 entries / 12000 content characters / 64 keywords per entry.',
    );
  }
}
export function primaryLorebook(): Record<string, LoreEntry> {
  return structuredClone(cached ?? loadPrimaryLorebook());
}
