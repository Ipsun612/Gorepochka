import { api, apiHeaders } from '../core/api.js';

export function voiceTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function voiceDescriptor(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: typeof value.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.id) ? value.id : '',
    duration: Number.isFinite(value.duration) && value.duration > 0 ? Math.min(value.duration, 86400) : 0,
    size: Number.isFinite(value.size) && value.size > 0 ? value.size : 0,
    waveform: Array.isArray(value.waveform)
      ? value.waveform
          .slice(0, 48)
          .map((peak) => (Number.isFinite(peak) ? Math.max(0, Math.min(100, Math.round(peak))) : 0))
      : [],
    delivery: ['pending', 'sent', 'failed', 'cancelled'].includes(value.delivery) ? value.delivery : 'sent',
  };
}

export function drawWaveform(element, peaks = []) {
  element.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const bar = document.createElement('span');
    const peak = peaks[Math.floor((i * peaks.length) / 40)] || 0;
    bar.style.setProperty('--peak', String(Math.max(8, peak)));
    element.appendChild(bar);
  }
}

export function uploadAudio(blob, chatId, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/audio?chatId=${encodeURIComponent(chatId)}`);
    xhr.timeout = 60000;
    for (const [key, value] of Object.entries(apiHeaders(false))) xhr.setRequestHeader(key, value);
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) =>
      onProgress(event.lengthComputable ? Math.round((event.loaded * 100) / event.total) : null);
    xhr.onload = () => {
      finish();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (error) {
        /* clean fallback below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data.audio);
      else
        reject(
          new Error(
            data?.error ||
              (xhr.status === 401
                ? 'Откройте мини-приложение заново из Telegram.'
                : `Не удалось загрузить запись (${xhr.status}).`),
          ),
        );
    };
    xhr.onerror = () => {
      finish();
      reject(new Error('Нет соединения. Запись сохранена для повторной отправки.'));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error('Время загрузки истекло. Попробуйте ещё раз.'));
    };
    xhr.onabort = () => {
      finish();
      reject(new Error('Отправка отменена.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      finish();
      reject(new Error('Отправка отменена.'));
      return;
    }
    const extension = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `voice.${extension}`);
    xhr.send(form);
  });
}

export async function waitForAudio(id, signal) {
  for (;;) {
    const { audio } = await api(`/api/audio/${encodeURIComponent(id)}`, null, { signal });
    if (audio.state === 'ready') return audio;
    if (audio.state === 'failed') throw new Error(audio.error || 'Не удалось обработать запись.');
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Error('Отправка отменена.'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 750);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener('abort', abort);
        abort();
      }
    });
  }
}

export async function fetchAudioBlob(id, signal) {
  const response = await fetch(`/api/audio/${encodeURIComponent(id)}/media`, {
    headers: apiHeaders(false),
    signal,
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Откройте мини-приложение заново из Telegram.'
        : 'Запись недоступна или срок хранения истёк.',
    );
  return response.blob();
}

let playing = null;
export function claimAudio(player) {
  if (playing && playing !== player) playing.pause();
  playing = player;
}
export function stopVoicePlayback() {
  playing?.pause();
  playing = null;
}

export function releaseAudio(player) {
  if (playing === player) playing = null;
}
