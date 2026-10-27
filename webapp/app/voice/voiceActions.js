/* Backward-compatible voice entry: re-exports the focused voice modules.
   New code should import from ./voiceComposer.js, ./voiceNavigation.js
   or ./voiceSetup.js directly. */
export { discardVoice, startVoice, finishRecording, updateMode } from './voiceComposer.js';
export { guardVoiceNavigation, closeConfirmation } from './voiceNavigation.js';
export { sendVoice } from './voiceSend.js';
export { initializeVoice } from './voiceSetup.js';
