import { config } from '../config/config.js';
import { log } from '../utils/logger.js';
import { UserFacingError } from './openrouter.js';

// ---------------------------------------------------------------------------
// Text-file attachments
//
// The Mini App lets the user attach any file that contains text (.txt, .md,
// .json, .cs, .js, .py, config/log files, …) and sends the raw bytes as a
// base64 data URL. The server is the single authority that turns it into a
// clean text block for the AI:
//   - the size is capped BEFORE decoding (a hostile client can never make us
//     allocate more than the configured limit),
//   - the bytes are decoded as UTF-8 and rejected when they look binary
//     (NUL bytes / too many replacement or control characters),
//   - control characters are stripped, CRLF is normalized and the injected
//     text is capped at FILE_MAX_CHARS so one huge file cannot blow the context.
// ---------------------------------------------------------------------------

/** Any `data:text/…;base64,…` or `data:application/…;base64,…` URL. The exact
 *  subtype is only a hint — the real payload is sniffed in decodeTextFile(). */
const TEXT_DATA_URL = /^data:(?:text\/[a-z0-9.+-]+|application\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

export interface DecodedTextFile {
  /** Cleaned (and possibly truncated) file text ready to embed in a message. */
  text: string;
  /** Size of the uploaded source in bytes. */
  sourceBytes: number;
  /** Length of `text` in characters. */
  chars: number;
  /** True when the source was longer than FILE_MAX_CHARS and got capped. */
  truncated: boolean;
}

function humanMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Upper bound on base64 length for MAX_FILE_BYTES of raw data (4/3 + padding). */
export function maxFileBase64Length(): number {
  return Math.ceil((config.MAX_FILE_BYTES * 4) / 3) + 8;
}

/**
 * Validate + decode a client-supplied text-file data URL.
 * Size is checked BEFORE decoding so a hostile client can never make us
 * allocate more than the configured limit.
 */
export function decodeTextFileDataUrl(raw: unknown): Buffer {
  if (typeof raw !== 'string' || raw === '') {
    throw new UserFacingError('Please attach a valid text file.');
  }
  const match = TEXT_DATA_URL.exec(raw);
  if (!match) {
    throw new UserFacingError('Only text files are supported (e.g. .txt, .md, .json, .cs).');
  }
  const base64 = match[1] ?? '';
  if (base64.length > maxFileBase64Length()) {
    throw new UserFacingError(`That file is too large (max ${humanMb(config.MAX_FILE_BYTES)}).`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new UserFacingError('Please attach a valid text file.');
  }
  if (buffer.length > config.MAX_FILE_BYTES) {
    throw new UserFacingError(`That file is too large (max ${humanMb(config.MAX_FILE_BYTES)}).`);
  }
  return buffer;
}

/** Heuristic binary sniff: NUL bytes, or too many control / replacement chars. */
function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const suspicious = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g);
  const count = suspicious ? suspicious.length : 0;
  // Allow a handful (stray BOM / replacement char) but reject mostly-binary files.
  return count > Math.max(8, Math.floor(text.length * 0.02));
}

/**
 * Decode a text-file buffer into cleaned, capped UTF-8 text.
 * Throws UserFacingError when the bytes look binary.
 */
export function decodeTextFile(input: Buffer): DecodedTextFile {
  const decoded = input.toString('utf8');
  if (looksBinary(decoded)) {
    log.warn({ bytes: input.length }, 'Rejected binary-looking file attachment');
    throw new UserFacingError('That file looks binary. Attach a text file (.txt, .md, .json, .cs …).');
  }
  const cleaned = decoded
    .replace(/^\uFEFF/, '') // drop a UTF-8 BOM
    .replace(/\r\n/g, '\n') // normalize line endings
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // strip control chars (keep \n \t)
    .trim();
  const truncated = cleaned.length > config.FILE_MAX_CHARS;
  const text = truncated ? cleaned.slice(0, config.FILE_MAX_CHARS) : cleaned;
  return { text, sourceBytes: input.length, chars: text.length, truncated };
}

/** Sanitize a client-supplied filename — display/labeling only, never a path. */
export function sanitizeFileName(raw: unknown): string {
  if (typeof raw !== 'string') return 'file';
  const base = raw.split(/[\\/]/).pop() ?? 'file';
  const clean = base.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return clean.slice(0, 120) || 'file';
}

/** Wrap decoded file text in clear delimiters so the model can tell it apart. */
export function formatFileBlock(name: string, file: DecodedTextFile): string {
  const header = file.truncated
    ? `[Attached file: ${name} — truncated to ${config.FILE_MAX_CHARS} characters]`
    : `[Attached file: ${name}]`;
  return `${header}\n${file.text}\n[/Attached file: ${name}]`;
}
