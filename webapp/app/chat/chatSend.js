/* Sending messages: text with staged attachments, video upload flow,
   retryable delivery and history clearing. */

import { state } from '../core/state.js';
import { inputEl, toast, setBusy, setStatus, setActivity, cancelSendBtn, scrollLatest } from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { api, chatPayload } from '../core/api.js';
import { removeSlot, persist, isLiveSlot } from './chatState.js';
import { addMsg, updateVideoMessage } from './renderMessages.js';
import { clearChatDom } from './renderRestore.js';
import { clearAttachments } from './chatAttachments.js';
import { renderTabs, hideChatMenu, management } from './chatTabs.js';
import { deliverAssistantReply } from '../core/assistantReply.js';
import { makeRequestId, uploadVideo, waitForVideo, waitForReply } from '../video/video.js';
import { guardVoiceNavigation } from '../voice/voiceNavigation.js';
import { closeReactionPicker, setMessageReaction } from '../reactions/reactions.js';

export function sendMessage(preset) {
  if (state.voiceActive) return;
  const text = (typeof preset === 'string' ? preset : inputEl.value || '').trim();
  const image = state.pendingImage;
  const file = state.pendingFile;
  const video = state.pendingVideo;
  if (
    (!text && !image && !file && !video) ||
    state.sending ||
    state.managing ||
    state.profileOpen ||
    !isLiveSlot(state.activeId)
  )
    return;
  if (video && video.duration > state.maxVideoDurationSeconds) {
    toast(`Видео слишком длинное (до ${state.maxVideoDurationSeconds} с).`);
    return;
  }
  state.sending = true;
  closeReactionPicker();
  setBusy(true);
  renderTabs();
  hideChatMenu();
  const userMessage = addMsg(
    'user',
    text,
    image ? image.thumb : null,
    Boolean(image),
    file ? { name: file.name, size: file.size, snippet: file.snippet } : null,
    video ? { name: video.name, size: video.size } : null,
  );
  inputEl.value = '';
  autoGrow();
  clearAttachments();
  haptic('light');
  const chatId = state.activeId;
  let readyVideo = null;
  let uploadId = null;
  let requestId = makeRequestId();
  let jobId = null;
  const run = async () => {
    const controller = new AbortController();
    state.sending = true;
    setBusy(true);
    renderTabs();
    cancelSendBtn.classList.toggle('hidden', !video);
    let cancelled = false;
    cancelSendBtn.onclick = () => {
      cancelled = true;
      controller.abort();
      if (jobId) void api(`/api/chat-jobs/${jobId}`, null, { method: 'DELETE' }).catch(() => {});
      else void api(`/api/chat-jobs/request/${requestId}`, null, { method: 'DELETE' }).catch(() => {});
      if (uploadId && !readyVideo) void api(`/api/videos/${uploadId}`, null, { method: 'DELETE' }).catch(() => {});
    };
    try {
      if (video && !readyVideo) {
        setActivity('Загрузка видео…');
        updateVideoMessage(userMessage, null, 'Загрузка…', null, 0);
        const uploaded = await uploadVideo(video.file, chatId, controller.signal, (percent) => {
          updateVideoMessage(userMessage, null, percent === null ? 'Загрузка…' : `Загрузка ${percent}%`, null, percent);
        });
        uploadId = uploaded.id;
        setActivity('Подготовка видео…');
        updateVideoMessage(userMessage, null, 'Подготовка видео…');
        readyVideo = await waitForVideo(uploadId, controller.signal);
        setActivity('Анализ видео и звука…');
        updateVideoMessage(userMessage, readyVideo, 'Анализ видео и звука…');
      }
      const payload = { ...chatPayload(chatId), message: text, requestId };
      if (image) payload.image = image.dataUrl;
      if (file) {
        payload.file = file.dataUrl;
        payload.fileName = file.name;
      }
      if (readyVideo) payload.videoId = readyVideo.id;
      let data;
      if (jobId) {
        data = await api(`/api/chat-jobs/${jobId}`, null, { signal: controller.signal });
        if (data.state === 'failed' || data.state === 'cancelled') {
          jobId = null;
          requestId = makeRequestId();
          payload.requestId = requestId;
          data = await api('/api/chat', payload, { signal: controller.signal });
        }
      } else data = await api('/api/chat', payload, { signal: controller.signal, timeoutMs: 120000 });
      if (data.jobId) cancelSendBtn.classList.remove('hidden');
      data = await waitForReply(data, controller.signal, (id) => {
        jobId = id;
      });
      cancelSendBtn.classList.add('hidden'); // generation has finished; delivery is not cancellable
      setActivity('Горепочка печатает…');
      const botWraps = [];
      await deliverAssistantReply(data, (reply) => {
        const wrap = addMsg('bot', reply);
        if (wrap && data.assistantMessageId) wrap.setAttribute('data-message-id', data.assistantMessageId);
        botWraps.push(wrap);
        haptic('success');
      });
      if (data.userMessageId && userMessage) userMessage.setAttribute('data-message-id', data.userMessageId);
      if (data.userReaction) {
        setMessageReaction(userMessage, data.userReaction);
        persist();
      } else persist();
      if (data.model) state.model = data.model;
      setStatus('online', 'на связи');
      if (video)
        updateVideoMessage(
          userMessage,
          null,
          readyVideo.hasAudio ? 'Отправлено · видео со звуком' : 'Отправлено · видео без звуковой дорожки',
        );
    } catch (err) {
      if (cancelled && !jobId) requestId = makeRequestId();
      if (uploadId && !readyVideo) {
        void api(`/api/videos/${uploadId}`, null, { method: 'DELETE' }).catch(() => {});
        uploadId = null;
      }
      if (readyVideo && /expired|not ready|unavailable/i.test(err.message || '')) {
        readyVideo = null;
        uploadId = null;
        jobId = null;
        requestId = makeRequestId();
      }
      if (video || jobId) {
        if (video)
          updateVideoMessage(
            userMessage,
            null,
            cancelled ? 'Отменено · можно повторить отправку' : `Ошибка: ${err.message || 'Попробуйте ещё раз.'}`,
            () => {
              if (state.sending || state.activeId !== chatId) return;
              updateVideoMessage(userMessage, null, 'Повторная отправка…');
              void run();
            },
          );
        else addMsg('bot', `Не удалось отправить: ${err.message || 'Ошибка обработки сообщения.'}`);
      } else addMsg('bot', `Не удалось отправить: ${err.message || 'Попробуйте ещё раз.'}`);
      setStatus('offline', cancelled ? 'отправка отменена' : 'ошибка отправки');
      toast(cancelled ? 'Отправка отменена' : err.message || 'Не удалось отправить сообщение');
      haptic('error');
    } finally {
      state.sending = false;
      setBusy(false);
      renderTabs();
      cancelSendBtn.classList.add('hidden');
      cancelSendBtn.onclick = null;
      // Do not reopen the mobile keyboard or steal focus while someone reads older replies.
    }
  };
  void run();
}

export async function newChat() {
  if (
    !guardVoiceNavigation(() => {
      void newChat();
    })
  )
    return false;
  if (state.sending || state.managing || !isLiveSlot(state.activeId)) return false;
  management(true);
  try {
    await api('/api/new', chatPayload(state.activeId));
    clearAttachments();
    removeSlot(state.activeId);
    clearChatDom();
    renderTabs(); // custom names are kept — the user may have personalized this chat
    scrollLatest();
    toast('История очищена');
    haptic('success');
    return true;
  } catch (err) {
    toast(err.message || 'Не удалось очистить историю');
    return false;
  } finally {
    management(false);
  }
}

export function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
}
