/* Shared mutable session for the voice/video-note composer.
   The recorder, draft and confirmation state are touched by the lifecycle,
   navigation-guard, sending and setup modules. */

import { state } from '../core/state.js';

export const voiceSession = {
  recorder: null,
  draft: null,
  previewUrl: '',
  navigation: null,
  confirmFocus: null,
  gesture: null,
};

export const voiceEl = (id) => document.getElementById(id);

export const isVideoMode = () => state.recordingMode === 'video-note';

export const previewPlayer = () => voiceEl(isVideoMode() ? 'videoNoteDraft' : 'voicePreview');
