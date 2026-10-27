import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';
import { log } from '../utils/logger.js';

/**
 * File-based system prompts.
 *
 * Convention: any text file inside PROMPTS_DIR whose name starts with a
 * numeric prefix + underscore is treated as a system prompt chunk:
 *   01_base.txt, 02_style.txt, 03_domain.md, ...
 * ("0X_" in the spec = this numeric-prefix convention.)
 *
 * Files are sorted by numeric prefix ascending, then by name, and
 * concatenated with a blank line between chunks.
 */

const ORDERED_FILE = /^(\d+)_.*\.(txt|md)$/i;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 32 * 1024;

let cached: string | null = null;

function resolveDir(): string {
  // Relative paths resolve from project root (process.cwd()),
  // so this works for both `tsx src/index.ts` and `node dist/index.js`.
  return path.isAbsolute(config.PROMPTS_DIR) ? config.PROMPTS_DIR : path.resolve(process.cwd(), config.PROMPTS_DIR);
}

function orderedPromptFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.warn({ dir }, 'Prompts directory not found, using fallback prompt');
    return [];
  }

  const matched = entries
    .filter((e) => e.isFile() && ORDERED_FILE.test(e.name))
    .map((e) => {
      const m = e.name.match(ORDERED_FILE);
      return { name: e.name, order: Number(m?.[1] ?? 0) };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((f) => f.name)
    .slice(0, MAX_FILES);

  const ignored = entries.filter((e) => e.isFile() && !ORDERED_FILE.test(e.name));
  for (const f of ignored) {
    log.warn({ file: f.name }, 'Ignoring file in prompts dir (must match NN_name.txt, e.g. 01_base.txt)');
  }

  return matched;
}

function readChunk(dir: string, file: string): string | null {
  const full = path.join(dir, path.basename(file)); // no traversal: basename only
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    log.warn({ file }, 'Skipping unreadable prompt file');
    return null;
  }
  if (stat.size > MAX_FILE_BYTES) {
    log.warn({ file, bytes: stat.size }, 'Skipping oversized prompt file');
    return null;
  }
  try {
    const raw = fs
      .readFileSync(full, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .trim();
    return raw || null;
  } catch {
    log.warn({ file }, 'Skipping prompt file (read/decode error)');
    return null;
  }
}

/** Load + concatenate all prompt chunks. Falls back to built-in default if empty. */
export function loadSystemPrompt(): string {
  const dir = resolveDir();
  const files = orderedPromptFiles(dir);
  const chunks: string[] = [];
  const loadedFiles: string[] = [];

  for (const file of files) {
    const text = readChunk(dir, file);
    if (!text) continue;
    const used = chunks.join('\n\n').length;
    if (used + (chunks.length ? 2 : 0) + text.length > config.PROMPT_MAX_TOTAL_CHARS) {
      // Never cut off the first/core prompt halfway through its safety rules.
      if (!chunks.length)
        throw new Error(
          'The core system prompt exceeds PROMPT_MAX_TOTAL_CHARS. Increase the limit or shorten the core prompt.',
        );
      log.warn(
        { file, chars: text.length, max: config.PROMPT_MAX_TOTAL_CHARS },
        'Skipping supplementary prompt: complete chunk does not fit prompt budget',
      );
      continue;
    }
    chunks.push(text);
    loadedFiles.push(file);
  }

  let combined = chunks.join('\n\n').trim();

  if (!combined) {
    log.warn({ dir }, 'No prompt files loaded, using built-in fallback');
    combined = FALLBACK_PROMPT;
  }

  cached = combined;
  log.info(
    { dir, files: loadedFiles, chars: combined.length },
    `System prompt loaded from ${loadedFiles.length} file(s)`,
  );
  return combined;
}

/** Cached prompt (loads once on first use). */
export function getSystemPrompt(): string {
  if (cached === null) return loadSystemPrompt();
  return cached;
}

export function listPromptFiles(): string[] {
  return orderedPromptFiles(resolveDir());
}

const FALLBACK_PROMPT = 'You are a helpful AI assistant inside Telegram. Keep answers concise unless asked otherwise.';
