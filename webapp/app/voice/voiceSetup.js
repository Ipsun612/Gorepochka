/* Voice composer wiring: tap gestures, preview controls, discard
   confirmation and interruption handling. */

import { state } from '../core/state.js';
import { toast } from '../core/dom.js';
import { tg, haptic } from '../core/telegram.js';
import { voiceSession, voiceEl, isVideoMode } from './voiceSession.js';
import { updateMode, startVoice, finishRecording, discardVoice } from './voiceComposer.js';
import { closeConfirmation } from './voiceNavigation.js';
import { sendVoice } from './voiceSend.js';
import { claimAudio, stopVoicePlayback } from './voice.js';
import { voiceTime } from './voice.js';
import { bindTapControl } from '../core/recordingGesture.js';

export function initializeVoice() {
  updateMode();
  voiceSession.gesture = bindTapControl(voiceEl('voiceBtn'), {
    onSingle: () => {
      if (state.sending || state.managing || state.profileOpen) return;
      if (!state.voiceActive) {
        void startVoice();
        return;
      }
      if (voiceSession.navigation) return;
      if (state.voicePhase === 'requesting') {
        discardVoice();
        return;
      }
      finishRecording('preview');
    },
    onDouble: () => {
      if (state.voiceActive || state.sending || state.managing || state.profileOpen) return;
      state.recordingMode = isVideoMode() ? 'voice' : 'video-note';
      updateMode();
      haptic('light');
      toast(isVideoMode() ? 'Видео: нажмите для записи' : 'Голосовое: нажмите для записи');
    },
  });
  voiceEl('voiceDelete').addEventListener('click', discardVoice);
  voiceEl('cameraFlip').addEventListener('click', () => {
    void voiceSession.recorder?.flip?.();
  });
  voiceEl('voicePause').addEventListener('click', () => {
    if (state.voicePhase !== 'preview') return;
    const preview = voiceEl(isVideoMode() ? 'videoNoteDraft' : 'voicePreview');
    if (!preview.paused) preview.pause();
    else {
      claimAudio(preview);
      void preview
        .play()
        .catch(() => toast('Предпросмотр недоступен в этом клиенте. Можно отправить запись для обработки сервером.'));
    }
  });
  for (const preview of [voiceEl('voicePreview'), voiceEl('videoNoteDraft')]) {
    preview.onplay = () => {
      voiceEl('voicePause').textContent = 'Ⅱ';
      voiceEl('voicePause').setAttribute('aria-label', 'Приостановить воспроизведение');
    };
    preview.onpause = preview.onended = () => {
      voiceEl('voicePause').textContent = '▶';
      voiceEl('voicePause').setAttribute('aria-label', 'Воспроизвести запись');
    };
    preview.ontimeupdate = () => {
      const total = Number.isFinite(preview.duration) ? preview.duration : voiceSession.draft?.duration;
      voiceEl('voicePreviewSeek').value = String(total > 0 ? (preview.currentTime / total) * 100 : 0);
      voiceEl('voiceTime').textContent = `${voiceTime(preview.currentTime)} / ${voiceTime(total)}`;
    };
  }
  voiceEl('voicePreviewSeek').addEventListener('input', () => {
    const player = voiceEl(isVideoMode() ? 'videoNoteDraft' : 'voicePreview');
    const total = Number.isFinite(player.duration) ? player.duration : voiceSession.draft?.duration;
    if (total > 0) player.currentTime = (Number(voiceEl('voicePreviewSeek').value) / 100) * total;
  });
  voiceEl('voiceSend').addEventListener('click', () => {
    void sendVoice();
  });
  voiceEl('voiceKeep').addEventListener('click', () => closeConfirmation(false));
  voiceEl('voiceDiscardConfirm').addEventListener('click', () => closeConfirmation(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.voiceActive && !voiceSession.navigation) {
      event.preventDefault();
      discardVoice();
      return;
    }
    if (voiceEl('voiceDiscard').classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirmation(false);
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === voiceEl('voiceKeep') ? voiceEl('voiceDiscardConfirm') : voiceEl('voiceKeep')).focus();
    }
  });
  const interrupt = () => {
    stopVoicePlayback();
    finishRecording('interrupted');
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interrupt();
  });
  try {
    tg?.onEvent?.('deactivated', interrupt);
  } catch (error) {
    /* optional SDK event */
  }
  window.addEventListener('blur', () => {
    if (state.voiceActive) interrupt();
  });
  window.addEventListener('pagehide', () => {
    discardVoice();
    stopVoicePlayback();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!state.voiceActive) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
