/* Voice/video-note capture lifecycle: mode UI, recorder handling and phases.
   `updateMode` is also reused by the setup bindings for the tap-to-switch UI. */

import { state } from '../core/state.js';
import { inputEl, toast } from '../core/dom.js';
import { tg, initData, haptic } from '../core/telegram.js';
import { isLiveSlot } from '../chat/chatState.js';
import { clearAttachments } from '../chat/chatAttachments.js';
import { hideChatMenu } from '../chat/chatTabs.js';
import { voiceTime, drawWaveform, stopVoicePlayback, releaseAudio } from './voice.js';
import { VoiceRecorder, recordingSupported } from './voiceRecorder.js';
import { VideoNoteRecorder, videoNoteSupported } from '../video/videoNoteRecorder.js';
import { voiceSession, voiceEl, isVideoMode, previewPlayer } from './voiceSession.js';
import { closeConfirmation } from './voiceNavigation.js';
import { sendVoice } from './voiceSend.js';

export function updateMode() {
  voiceEl('voiceBtn').classList.toggle('is-video-mode', isVideoMode());
  voiceEl('voiceBtn').setAttribute(
    'aria-label',
    isVideoMode() ? 'Видео: нажмите для записи, дважды — голосовое' : 'Голосовое: нажмите для записи, дважды — видео',
  );
  voiceEl('voiceBtn').title = 'Нажмите для записи · дважды для смены режима';
}

function closingGuard(enabled) {
  try {
    if (tg && initData && tg.isVersionAtLeast?.('6.2')) {
      if (enabled) tg.enableClosingConfirmation();
      else tg.disableClosingConfirmation();
    }
  } catch (error) {
    /* Old Telegram clients. */
  }
}

function phase(value, duration = 0, peaks = []) {
  state.voicePhase = value;
  voiceEl('voiceTime').textContent = voiceTime(duration);
  voiceEl('voiceComposer').classList.toggle('is-recording', value === 'recording');
  voiceEl('voiceComposer').classList.toggle('is-preview', value === 'preview');
  const labels = {
    requesting: isVideoMode() ? 'Разрешите камеру и микрофон…' : 'Разрешите доступ к микрофону…',
    recording: 'Нажмите ещё раз — готово',
    finishing: 'Подготовка записи…',
    preview: 'Проверьте или отправьте запись',
  };
  if (voiceEl('voiceStatus').textContent !== labels[value]) voiceEl('voiceStatus').textContent = labels[value] || '';
  voiceEl('voicePause').textContent = '▶';
  voiceEl('voicePause').setAttribute('aria-label', 'Воспроизвести запись');
  voiceEl('voicePause').classList.toggle('hidden', value !== 'preview');
  voiceEl('voiceSend').classList.toggle('hidden', value !== 'preview');
  voiceEl('voiceBtn').classList.toggle('hidden', value === 'preview');
  voiceEl('voiceBtn').classList.toggle('is-holding', ['requesting', 'recording'].includes(value));
  voiceEl('voiceCancelHint').classList.toggle('hidden', value === 'preview');
  voiceEl('voicePreviewSeek').classList.toggle('hidden', value !== 'preview');
  voiceEl('voiceSend').disabled = value !== 'preview';
  voiceEl('voiceDelete').disabled = value === 'finishing';
  voiceEl('videoNoteLive').classList.toggle('hidden', value === 'preview');
  voiceEl('videoNoteDraft').classList.toggle('hidden', value !== 'preview');
  voiceEl('videoNoteCircle').style.setProperty(
    '--progress',
    String(Math.min(100, (duration / state.maxVideoNoteDurationSeconds) * 100)),
  );
  if (value === 'finishing' || value === 'preview') voiceSession.gesture?.reset();
  drawWaveform(voiceEl('voiceWaveform'), peaks);
}

export function discardVoice() {
  if (voiceSession.navigation) closeConfirmation(false);
  voiceSession.gesture?.reset();
  voiceSession.recorder?.dispose();
  voiceSession.recorder = null;
  voiceSession.draft = null;
  for (const preview of [voiceEl('voicePreview'), voiceEl('videoNoteDraft')]) {
    preview.pause?.();
    preview.removeAttribute('src');
    preview.load?.();
    releaseAudio(preview);
  }
  voiceEl('voicePreviewSeek').value = '0';
  if (voiceSession.previewUrl) URL.revokeObjectURL(voiceSession.previewUrl);
  voiceSession.previewUrl = '';
  state.voiceActive = false;
  state.voicePhase = 'text';
  voiceEl('voiceComposer').classList.add('hidden');
  voiceEl('textComposer').classList.remove('hidden');
  voiceEl('voiceBtn').classList.remove('hidden', 'is-holding');
  voiceEl('videoNoteStage').classList.add('hidden');
  voiceEl('recordingShade').classList.add('hidden');
  voiceEl('appRoot').classList.remove('is-capturing');
  voiceEl('cameraFlip').classList.add('hidden');
  closingGuard(false);
}

export async function startVoice() {
  if (state.voiceActive || state.sending || state.managing || state.profileOpen || !isLiveSlot(state.activeId)) return;
  if (!voiceEl('modal').classList.contains('hidden')) return;
  if (state.pendingImage || state.pendingFile || state.pendingVideo) {
    toast('Уберите прикреплённый файл перед записью сообщения.');
    return;
  }
  if (!recordingSupported()) {
    toast('Запись недоступна в этом клиенте. Откройте мини-приложение по HTTPS в обновлённом Telegram.');
    return;
  }
  if (isVideoMode() && !videoNoteSupported()) {
    toast('Видеозапись недоступна в этом клиенте. Попробуйте обновлённый Telegram или браузер.');
    return;
  }
  stopVoicePlayback();
  clearAttachments(); // Invalidate file reads that started before voice mode.
  hideChatMenu();
  inputEl.blur();
  try {
    if (tg?.isVersionAtLeast?.('9.1')) tg.hideKeyboard();
  } catch (error) {
    /* optional */
  }
  state.voiceActive = true;
  voiceEl('textComposer').classList.add('hidden');
  voiceEl('voiceComposer').classList.remove('hidden');
  voiceEl('videoNoteStage').classList.toggle('hidden', !isVideoMode());
  voiceEl('recordingShade').classList.toggle('hidden', !isVideoMode());
  voiceEl('appRoot').classList.toggle('is-capturing', isVideoMode());
  closingGuard(true);
  phase('requesting');
  const Recorder = isVideoMode() ? VideoNoteRecorder : VoiceRecorder;
  const current = new Recorder({
    maxBytes: isVideoMode() ? state.maxVideoBytes : state.maxAudioBytes,
    maxSeconds: isVideoMode() ? Math.min(60, state.maxVideoNoteDurationSeconds) : state.maxAudioDurationSeconds,
    preview: voiceEl('videoNoteLive'),
    onNotice: toast,
    onCamera: (available, switching) => {
      if (voiceSession.recorder !== current) return;
      voiceEl('cameraFlip').classList.toggle('hidden', !available);
      voiceEl('cameraFlip').disabled = switching;
    },
    onUpdate: ({ phase: value, duration, peaks }) => {
      if (voiceSession.recorder === current) phase(value, duration, peaks);
    },
    onError: (error) => {
      if (voiceSession.recorder !== current) return;
      discardVoice();
      toast(error.message);
      haptic('error');
    },
    onFinished: (value) => {
      if (voiceSession.recorder !== current) return;
      voiceSession.draft = { ...value, ...(isVideoMode() ? { kind: 'video-note' } : {}) };
      voiceSession.previewUrl = URL.createObjectURL(value.blob);
      previewPlayer().src = voiceSession.previewUrl;
      phase('preview', value.duration, value.waveform);
      if (value.reason === 'limit') toast('Достигнут лимит записи. Проверьте и отправьте сообщение.');
      if (value.reason === 'interrupted') toast('Запись остановлена. Проверьте её перед отправкой.');
      if (value.reason === 'send') void sendVoice();
      else if (!voiceSession.navigation) voiceEl('voicePause').focus();
    },
  });
  voiceSession.recorder = current;
  await current.start();
}

export function finishRecording(reason = 'interrupted') {
  voiceSession.gesture?.reset();
  if (state.voicePhase === 'requesting') discardVoice();
  else voiceSession.recorder?.finish(reason);
}
