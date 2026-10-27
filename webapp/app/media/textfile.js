/* Text-file attachment helpers for the Mini App.
   Reads any user-picked file that contains text (.txt, .md, .json, .cs, .js,
   config/log files, …) and builds a `data:text/plain;base64,…` URL for upload
   plus a short local preview. The server is the authority: it re-checks the
   size, rejects binary content and caps the characters sent to the AI. */

// Extension allowlist — broad (docs, data, config + common code). The server
// sniffs the real bytes, so a miss here only affects the friendly client check.
const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'rst',
  'adoc',
  'org',
  'json',
  'jsonl',
  'ndjson',
  'geojson',
  'log',
  'csv',
  'tsv',
  'xml',
  'xsd',
  'xsl',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'properties',
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'pyw',
  'rb',
  'php',
  'java',
  'kt',
  'kts',
  'groovy',
  'scala',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'cs',
  'fs',
  'go',
  'rs',
  'swift',
  'dart',
  'lua',
  'pl',
  'pm',
  'r',
  'sh',
  'bash',
  'zsh',
  'fish',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'sql',
  'graphql',
  'gql',
  'proto',
  'tex',
  'diff',
  'patch',
  'gradle',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'lock',
]);

// MIME types we treat as text even when the extension is unknown.
const TEXT_MIME_RE = /^text\//i;
const TEXT_APP_MIME_RE =
  /^application\/(json|ld\+json|x-ndjson|ndjson|xml|xhtml\+xml|javascript|ecmascript|x-httpd-php|x-sh|x-python|x-ruby|x-perl|x-yaml|yaml|toml|sql|csv|graphql|x-tex)$/i;

/** Lowercase extension without the leading dot ('' when there is none). */
export function fileExtension(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  if (dot === -1 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isTextFile(file) {
  if (!file) return false;
  if (file.type && (TEXT_MIME_RE.test(file.type) || TEXT_APP_MIME_RE.test(file.type))) return true;
  return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

const PREVIEW_MAX_CHARS = 240;

/** Base64-encode a byte array without blowing the call stack on big files. */
function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function readArrayBuffer(file) {
  if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Decode the picked file locally into `{ dataUrl, text }`. */
export async function readTextFile(file) {
  const buffer = await readArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  const dataUrl = `data:text/plain;base64,${bytesToBase64(bytes)}`;
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (e) {
    text = '';
  }
  return { dataUrl, text };
}

/** Short, single-line preview shown in the composer and chat bubble. */
export function fileSnippet(text) {
  const flat = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.slice(0, PREVIEW_MAX_CHARS);
}
