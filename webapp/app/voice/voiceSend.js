/* Sending voice/video-note recordings: upload, server preparation,
   cancellable AI analysis and retryable delivery. */

import { state } from '../core/state.js';
import { toast, setBusy, setActivity, setStatus, cancelSendBtn } from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { api, chatPayload } from '../core/api.js';
import { renderTabs } from '../chat/chatTabs.js';
import { addMsg } from '../chat/renderMessages.js';
import { deliverAssistantReply } from '../core/assistantReply.js';
import { closeReactionPicker, setMessageReaction } from '../reactions/reactions.js';
import { makeRequestId, waitForReply, uploadVideo, waitForVideo } from '../video/video.js';
import { uploadAudio, waitForAudio } from './voice.js';
import { updateVoiceMessage } from './voiceRender.js';
import { updateVideoNoteMessage } from '../video/videoNoteRender.js';
import { discardVoice } from './voiceComposer.js';
import { voiceSession } from './voiceSession.js';

export async function sendVoice() {
  if (state.sending || !state.voiceActive) return;
  if (state.voicePhase !== 'preview') {
    voiceSession.recorder?.finish('send');
    return;
  }
  if (!voiceSession.draft) return;
  const recording = voiceSession.draft;
  const videoNote = recording.kind === 'video-note';
  const updateMessage = videoNote ? updateVideoNoteMessage : updateVoiceMessage;
  const mediaRoot = videoNote ? '/api/videos' : '/api/audio';
  const sentLabel = videoNote ? 'Отправлено · видеосообщение' : 'Отправлено · голосовое сообщение';
  const analysisLabel = videoNote ? 'Горепочка смотрит и слушает…' : 'Горепочка слушает…';
  const chatId = state.activeId;
  const media = { ...recording, delivery: 'pending', name: videoNote ? 'Видеосообщение' : 'Голосовое сообщение' };
  const wrap = addMsg('user', '', null, false, null, videoNote ? media : null, videoNote ? null : media);
  closeReactionPicker();
  discardVoice();
  let prepared = null;
  let uploadId = null;
  let requestId = makeRequestId();
  let jobId = null;
  let cancellationRequested = false;
  const run = async () => {
    if (state.sending || state.activeId !== chatId) return;
    state.sending = true;
    setBusy(true);
    renderTabs();
    const controller = new AbortController();
    let cancelled = false;
    cancelSendBtn.classList.remove('hidden');
    cancelSendBtn.onclick = () => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      // Wait for cancellation acknowledgement before allowing a new paid request.
      cancellationRequested = true;
      void api(`/api/chat-jobs/request/${requestId}`, null, { method: 'DELETE' }).catch(() => {});
    };
    updateMessage(wrap, null, 'Загрузка…', { delivery: 'pending' });
    try {
      if (cancellationRequested) {
        await api(`/api/chat-jobs/request/${requestId}`, null, { method: 'DELETE', signal: controller.signal });
        // Keep the old request ID until its terminal job state is known below.
        const old = await api(`/api/chat-jobs/request/${requestId}`, null, { signal: controller.signal }).catch(
          (error) => {
            if (error.code === 'JOB_UNAVAILABLE') return null;
            throw error;
          },
        );
        if (old?.state === 'complete') {
          cancellationRequested = false;
          cancelSendBtn.classList.add('hidden');
          setActivity('Горепочка печатает…');
          await deliverAssistantReply(old.result, (text) => {
            addMsg('bot', text);
            haptic('success');
          });
          if (old.result.userReaction) setMessageReaction(wrap, old.result.userReaction);
          updateMessage(wrap, null, sentLabel, { delivery: 'sent' });
          setStatus('online', 'на связи');
          return;
        }
        cancellationRequested = false;
        requestId = makeRequestId();
        jobId = null;
      }
      if (!prepared) {
        setActivity(videoNote ? 'Загрузка видеосообщения…' : 'Загрузка голосового сообщения…');
        const upload = videoNote
          ? (blob, slot, signal, progress) => uploadVideo(blob, slot, signal, progress, 'video-note')
          : uploadAudio;
        const uploaded = await upload(recording.blob, chatId, controller.signal, (progress) => {
          updateMessage(wrap, null, progress === null ? 'Загрузка…' : `Загрузка ${progress}%`, { progress });
        });
        uploadId = uploaded.id;
        const preparation = videoNote ? 'Подготовка видео…' : 'Подготовка аудио…';
        setActivity(preparation);
        updateMessage(wrap, prepared, preparation);
        prepared = await (videoNote ? waitForVideo : waitForAudio)(uploadId, controller.signal);
        updateMessage(wrap, prepared, analysisLabel);
      }
      setActivity(analysisLabel);
      const payload = {
        ...chatPayload(chatId),
        [videoNote ? 'videoId' : 'audioId']: prepared.id,
        requestId,
        message: '',
      };
      let data = jobId
        ? await api(`/api/chat-jobs/${jobId}`, null, { signal: controller.signal })
        : await api('/api/chat', payload, { signal: controller.signal });
      if (data.state === 'failed' || data.state === 'cancelled') {
        jobId = null;
        requestId = makeRequestId();
        data = await api('/api/chat', { ...payload, requestId }, { signal: controller.signal });
      }
      data = await waitForReply(data, controller.signal, (id) => {
        jobId = id;
      });
      cancelSendBtn.classList.add('hidden');
      setActivity('Горепочка печатает…');
      await deliverAssistantReply(data, (text) => {
        addMsg('bot', text);
        haptic('success');
      });
      if (data.userReaction) setMessageReaction(wrap, data.userReaction);
      updateMessage(wrap, null, sentLabel, { delivery: 'sent' });
      setStatus('online', 'на связи');
    } catch (error) {
      if (uploadId && !prepared) {
        void api(`${mediaRoot}/${uploadId}`, null, { method: 'DELETE' }).catch(() => {});
        uploadId = null;
      }
      if (['AUDIO_UNAVAILABLE', 'VIDEO_UNAVAILABLE'].includes(error.code) || (error.status === 404 && !jobId)) {
        prepared = null;
        uploadId = null;
        requestId = makeRequestId();
      }
      if (error.status === 404 && jobId) {
        jobId = null;
        prepared = null;
        uploadId = null;
        requestId = makeRequestId();
      }
      updateMessage(wrap, null, cancelled ? 'Отменено · запись сохранена для повтора' : error.message, {
        delivery: cancelled ? 'cancelled' : 'failed',
        retry: () => {
          void run();
        },
      });
      toast(cancelled ? 'Отправка отменена' : error.message);
      setStatus('offline', cancelled ? 'отправка отменена' : 'ошибка отправки');
      haptic('error');
    } finally {
      state.sending = false;
      setBusy(false);
      renderTabs();
      cancelSendBtn.classList.add('hidden');
      cancelSendBtn.onclick = null;
    }
  };
  await run();
}
