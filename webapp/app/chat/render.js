/* Backward-compatible render entry: re-exports the focused render modules.
   New code should import from ./renderMessages.js, ./renderRestore.js
   or ./botProfile.js directly. */
export * from './renderMessages.js';
export * from './renderRestore.js';
export * from './botProfile.js';
