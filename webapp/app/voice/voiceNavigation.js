/* Voice navigation guard: an open discard confirmation owns navigation
   until the user keeps editing or confirms the discard. */

import { state } from '../core/state.js';
import { voiceSession, voiceEl } from './voiceSession.js';
import { finishRecording, discardVoice } from './voiceComposer.js';

/** Return false while an accessible discard confirmation owns navigation. */
export function guardVoiceNavigation(action) {
  if (!state.voiceActive) return true;
  if (state.voicePhase === 'requesting') {
    // Cancel pending getUserMedia too; a late stream is immediately stopped.
    discardVoice();
    return true;
  }
  if (voiceSession.navigation) return false;
  finishRecording('preview');
  voiceSession.navigation = action;
  voiceSession.confirmFocus = document.activeElement;
  voiceEl('voiceDiscard').classList.remove('hidden');
  voiceEl('chatScreen').inert = true;
  voiceEl('voiceKeep').focus();
  return false;
}

export function closeConfirmation(discard) {
  const action = voiceSession.navigation;
  voiceSession.navigation = null;
  voiceEl('voiceDiscard').classList.add('hidden');
  voiceEl('chatScreen').inert = false;
  if (discard) {
    discardVoice();
    action?.();
  } else if (voiceSession.confirmFocus && voiceSession.confirmFocus.isConnected !== false)
    voiceSession.confirmFocus.focus();
}
