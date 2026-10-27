/* Native video uploads: raw File -> multipart; only the server decodes media.
   Browser preview support is optional and never gates uploads. */
import { api, apiHeaders } from '../core/api.js';
import { formatBytes } from '../media/image.js';

export function isVideoFile(file) {
  return Boolean(
    file &&
    (/^video\//i.test(file.type || '') ||
      /\.(mp4|m4v|mov|mkv|webm|avi|wmv|asf|flv|f4v|mpeg|mpg|mpe|m2v|mts|m2ts|3gp|3g2|ogv|vob|rm|rmvb|divx|dv|hevc|h264|h265)$/i.test(
        file.name || '',
      )),
  );
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function videoDetails(video) {
  return [formatBytes(video.size), durationLabel(video.duration)].filter(Boolean).join(' · ');
}

export function makeRequestId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function uploadVideo(file, chatId, signal, onProgress, kind = 'attachment') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `/api/videos?chatId=${encodeURIComponent(chatId)}${kind === 'video-note' ? '&kind=video-note' : ''}`,
    );
    xhr.timeout = 180000;
    for (const [key, value] of Object.entries(apiHeaders(false))) xhr.setRequestHeader(key, value);
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? Math.round((event.loaded * 100) / event.total) : null);
    };
    xhr.onload = () => {
      finish();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) resolve(data.video);
      else reject(new Error((data && data.error) || `Не удалось загрузить видео (${xhr.status}).`));
    };
    xhr.onerror = () => {
      finish();
      reject(new Error('Ошибка сети при загрузке. Попробуйте ещё раз.'));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error('Время загрузки истекло. Попробуйте ещё раз.'));
    };
    xhr.onabort = () => {
      finish();
      reject(new Error('Загрузка видео отменена.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish();
      reject(new Error('Video upload cancelled.'));
      return;
    }
    const form = new FormData();
    form.append('video', file, file.name || 'video');
    xhr.send(form);
  });
}

function wait(signal, ms = 1000) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Video operation cancelled.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

export async function waitForVideo(id, signal) {
  for (;;) {
    if (signal.aborted) throw new Error('Video operation cancelled.');
    const { video } = await api(`/api/videos/${encodeURIComponent(id)}`, null, { signal });
    if (video.state === 'ready') return video;
    if (video.state === 'failed') throw new Error(video.error || 'Не удалось подготовить видео.');
    await wait(signal);
  }
}

export async function waitForReply(data, signal, onJob) {
  if (!data.jobId) return data;
  onJob(data.jobId);
  for (;;) {
    if (signal.aborted) throw new Error('Обработка сообщения отменена.');
    if (data.state === 'complete') return data.result;
    if (data.state === 'failed' || data.state === 'cancelled')
      throw new Error(data.error || 'Обработка сообщения отменена.');
    await wait(signal);
    data = await api(`/api/chat-jobs/${encodeURIComponent(data.jobId)}`, null, { signal });
  }
}

// Playback is fetched with Telegram credentials, never public/token-bearing URLs.
export async function fetchVideoBlob(id, signal) {
  const response = await fetch(`/api/videos/${encodeURIComponent(id)}/media`, { headers: apiHeaders(false), signal });
  if (!response.ok) throw new Error('Видео недоступно или срок хранения истёк. Прикрепите его заново.');
  return response.blob();
}

export function videoDescriptor(value) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) ? value.id : '';
  const name = typeof value.name === 'string' ? value.name.slice(0, 120) : 'video';
  const poster =
    typeof value.poster === 'string' &&
    value.poster.length < 100000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.poster)
      ? value.poster
      : null;
  return {
    id,
    name,
    size: Number.isFinite(value.size) ? value.size : 0,
    duration: Number.isFinite(value.duration) ? value.duration : 0,
    poster,
    ...(value.kind === 'video-note'
      ? {
          kind: 'video-note',
          delivery: ['pending', 'sent', 'failed', 'cancelled'].includes(value.delivery) ? value.delivery : 'sent',
        }
      : {}),
  };
}
