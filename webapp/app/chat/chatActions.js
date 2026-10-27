/* Backward-compatible chat entry: re-exports the focused chat modules.
   New code should import from ./chatAttachments.js, ./chatTabs.js,
   ./chatModals.js or ./chatSend.js directly. */
export * from './chatAttachments.js';
export * from './chatTabs.js';
export * from './chatModals.js';
export * from './chatSend.js';
