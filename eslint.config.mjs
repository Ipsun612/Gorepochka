// ESLint flat config: TypeScript (src) + plain JS (webapp, scripts).
//
// Intentional relaxations (the codebase normalizes untrusted input by design):
// - `no-control-regex` is off: sanitizers in services/textfiles.ts,
//   utils/security.ts, profile/* and lorebook/* deliberately match control
//   characters to reject binary payloads.
// - `no-useless-assignment` is off: `let x = empty; try { x = ... } catch
//   { x = empty; }` initializers are the defensive norm before fallible reads.
// - `preserve-caused-error` / `preserve-caught-error` are off: network/provider
//   errors are deliberately remapped to fixed user-safe strings (rule renamed
//   across ESLint majors; both names are silenced).
// - `no-empty` allows empty `catch` blocks: `catch (e) { /* reason */ }`
//   is the codebase convention for best-effort fallbacks.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly',
  navigator: 'readonly', location: 'readonly', history: 'readonly',
  fetch: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly',
  FileReader: 'readonly', FormData: 'readonly', AbortController: 'readonly',
  AbortSignal: 'readonly', ResizeObserver: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', queueMicrotask: 'readonly',
  structuredClone: 'readonly', crypto: 'readonly', performance: 'readonly',
  console: 'readonly', createImageBitmap: 'readonly', Image: 'readonly',
  btoa: 'readonly', atob: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
  XMLHttpRequest: 'readonly', MediaRecorder: 'readonly', MediaStream: 'readonly',
};

const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', setImmediate: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', fetch: 'readonly', Response: 'readonly',
  Request: 'readonly', Headers: 'readonly', FormData: 'readonly', Blob: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', structuredClone: 'readonly',
  queueMicrotask: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  performance: 'readonly', crypto: 'readonly', File: 'readonly',
  __dirname: 'readonly', __filename: 'readonly',
};

// Smoke scripts stub browser APIs (document/navigator/MediaRecorder/...) via
// globalThis, so they need both environments.
const scriptGlobals = {
  ...nodeGlobals,
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  localStorage: 'readonly', location: 'readonly', history: 'readonly',
  MediaStream: 'readonly', MediaRecorder: 'readonly',
};

const unused = ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }];

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unused,
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      'preserve-caused-error': 'off',
      'preserve-caught-error': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['webapp/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals },
    rules: {
      'no-unused-vars': unused,
      '@typescript-eslint/no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      'preserve-caused-error': 'off',
      'preserve-caught-error': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: scriptGlobals },
    rules: {
      'no-unused-vars': unused,
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Emoji/flag ranges are the domain of the reaction validators.
    files: ['src/services/tags/reaction.ts', 'webapp/app/core/reactionValue.js'],
    rules: { 'no-misleading-character-class': 'off' },
  },
);
