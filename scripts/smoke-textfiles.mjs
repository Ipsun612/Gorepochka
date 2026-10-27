/* Smoke-test for the text-file attachment service (src/services/textfiles.ts).
   Sets a known, tiny config, loads the compiled service from dist/ and checks
   base64 parsing, size caps, binary rejection, truncation and filename safety.
   Run: npm run build && node scripts/smoke-textfiles.mjs */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const distFile = path.join(here, '..', 'dist', 'services', 'textfiles.js');

// Deterministic config: set BEFORE loading config (dotenv never overrides an
// already-set process.env value, so these win over any local .env).
process.env.TELEGRAM_BOT_TOKEN = 'x'.repeat(40);
process.env.OPENROUTER_API_KEY = 'y'.repeat(40);
process.env.MAX_FILE_BYTES = '1024';
process.env.FILE_MAX_CHARS = '50';

const require = createRequire(import.meta.url);
const textfiles = require(distFile);

const dataUrlOf = (text, mime = 'text/plain') => `data:${mime};base64,${Buffer.from(text, 'utf8').toString('base64')}`;

// 1. A plain text file round-trips.
{
  const buf = textfiles.decodeTextFileDataUrl(dataUrlOf('hello, world'));
  const decoded = textfiles.decodeTextFile(buf);
  assert.equal(decoded.text, 'hello, world');
  assert.equal(decoded.truncated, false);
  assert.equal(decoded.chars, 12);
}

// 2. JSON / markdown mimes are accepted; non-data / non-string input is rejected.
{
  assert.ok(textfiles.decodeTextFileDataUrl(dataUrlOf('{"a":1}', 'application/json')));
  assert.ok(textfiles.decodeTextFileDataUrl(dataUrlOf('# hi', 'text/markdown')));
  assert.throws(() => textfiles.decodeTextFileDataUrl('not a data url'), /text files/i);
  assert.throws(() => textfiles.decodeTextFileDataUrl(''), /valid text file/i);
  assert.throws(() => textfiles.decodeTextFileDataUrl(12345), /valid text file/i);
}

// 3. Oversized payloads are rejected on the base64 length, before decoding.
{
  const big = 'a'.repeat(4096); // well over MAX_FILE_BYTES = 1024
  assert.throws(() => textfiles.decodeTextFileDataUrl(dataUrlOf(big)), /too large/i);
}

// 4. Binary content (NUL bytes) is rejected by the sniff.
{
  const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x00]).toString('base64');
  assert.throws(() => textfiles.decodeTextFile(Buffer.from(binary, 'base64')), /looks binary/i);
}

// 5. Content is truncated to FILE_MAX_CHARS; CRLF normalized; stray control
//    chars stripped (a file full of control chars is rejected as binary above).
{
  const long = textfiles.decodeTextFile(Buffer.from('x'.repeat(80), 'utf8'));
  assert.equal(long.truncated, true);
  assert.equal(long.chars, 50);

  const messy = textfiles.decodeTextFile(Buffer.from('line1\r\nline2\u0007', 'utf8'));
  assert.equal(messy.truncated, false);
  assert.equal(messy.text, 'line1\nline2');
  assert.ok(!messy.text.includes('\r'), 'CRLF normalized to LF');
}

// 6. Filenames are reduced to a safe basename (no path, no control chars).
{
  assert.equal(textfiles.sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(textfiles.sanitizeFileName('C:\\Users\\me\\notes.md'), 'notes.md');
  assert.equal(textfiles.sanitizeFileName('evil\nname\u0000.txt'), 'evilname.txt');
  assert.equal(textfiles.sanitizeFileName(undefined), 'file');
}

// 7. The formatted block labels the file and marks truncation.
{
  const decoded = textfiles.decodeTextFile(Buffer.from('short', 'utf8'));
  const block = textfiles.formatFileBlock('a.md', decoded);
  assert.match(block, /^\[Attached file: a\.md\]/);
  assert.match(block, /short/);
  assert.match(block, /\[\/Attached file: a\.md\]$/);

  const big = textfiles.decodeTextFile(Buffer.from('x'.repeat(80), 'utf8'));
  assert.match(textfiles.formatFileBlock('big.txt', big), /truncated to 50 characters/);
}

console.log('SMOKE OK — text-file service rejects binary/oversized input and caps content.');
