/* Message bubbles: video/image/file/voice/note rendering and delivery updates. */

import {
  chatEl,
  welcomeCard,
  renderText,
  timeLabel,
  nearBottom,
  scrollLatest,
  updateLatest,
  announcement,
} from '../core/dom.js';
import { BOT_NAME } from '../core/state.js';
import { persist } from './chatState.js';
import { hideAssistantTags } from '../core/assistantReply.js';
import { fetchVideoBlob, videoDescriptor, videoDetails } from '../video/video.js';
import { makeVoiceBox } from '../voice/voiceRender.js';
import { makeVideoNoteBox } from '../video/videoNoteRender.js';
import { prepareMessageReactions } from '../reactions/reactions.js';

function makeVideoBox(value) {
  if (value.kind === 'video-note') return makeVideoNoteBox(value);
  const descriptor = videoDescriptor(value);
  const box = document.createElement('div');
  box.className = 'bubble-video';
  box.videoDescriptor = descriptor;
  let poster = null;
  if (descriptor.poster) {
    poster = document.createElement('img');
    poster.className = 'video-poster';
    poster.src = descriptor.poster;
    poster.alt = 'Кадр прикреплённого видео';
    poster.loading = 'lazy';
    box.appendChild(poster);
  }
  const player = document.createElement('video');
  player.controls = true;
  player.playsInline = true;
  player.preload = 'none';
  player.classList.add('hidden');
  player.setAttribute('aria-label', 'Прикреплённое видео');
  if (descriptor.poster) player.poster = descriptor.poster;
  box.appendChild(player);
  const label = document.createElement('div');
  label.className = 'video-name';
  label.textContent = `${descriptor.name} · ${videoDetails(descriptor)}`;
  box.appendChild(label);
  const status = document.createElement('div');
  status.className = 'video-status';
  status.setAttribute('role', 'status');
  status.textContent = descriptor.id ? 'Видео доступно временно · приватный просмотр' : 'Ожидание загрузки…';
  box.appendChild(status);
  const play = document.createElement('button');
  play.className = 'video-action';
  play.textContent = 'Открыть видео';
  play.disabled = !descriptor.id;
  const controller = new AbortController();
  let objectUrl = '';
  play.onclick = async () => {
    play.disabled = true;
    status.textContent = 'Загрузка видео…';
    try {
      const blob = await fetchVideoBlob(descriptor.id, controller.signal);
      if (controller.signal.aborted) return;
      const follow = nearBottom();
      objectUrl = URL.createObjectURL(blob);
      player.src = objectUrl;
      player.classList.remove('hidden');
      if (poster) poster.classList.add('hidden');
      play.classList.add('hidden');
      status.textContent = 'Видео загружено';
      if (follow) scrollLatest();
      else updateLatest();
      try {
        await player.play();
      } catch (e) {
        /* webview may require another tap */
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        status.textContent = err.message;
        play.disabled = false;
      }
    }
  };
  box.appendChild(play);
  box.disposeVideo = () => {
    controller.abort();
    if (typeof player.pause === 'function') player.pause();
    player.removeAttribute('src');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    play.onclick = null;
    box.querySelectorAll('.video-retry').forEach((button) => {
      button.onclick = null;
    });
  };
  return box;
}

export function updateVideoMessage(wrap, video, statusText, retry, progress) {
  const follow = nearBottom();
  const bubble = wrap.querySelector('.bubble');
  let box = bubble.querySelector('.bubble-video');
  if (video) {
    const replacement = makeVideoBox(video);
    if (box) {
      box.disposeVideo();
      box.remove();
    }
    const text = bubble.querySelector('.bubble-text');
    const meta = bubble.querySelector('.meta');
    // Keep attachments before their captions and the timestamp, including after upload.
    bubble.insertBefore(replacement, text || meta || null);
    box = replacement;
  }
  if (!box) return;
  box.querySelector('.video-status').textContent = statusText;
  box.querySelectorAll('.video-retry').forEach((button) => {
    button.onclick = null;
    button.remove();
  });
  let bar = box.querySelector('progress');
  if (typeof progress === 'number') {
    if (!bar) {
      bar = document.createElement('progress');
      bar.className = 'video-progress';
      bar.max = 100;
      box.appendChild(bar);
    }
    bar.value = progress;
  } else if (bar) bar.remove();
  if (retry) {
    const button = document.createElement('button');
    button.className = 'video-action video-retry';
    button.textContent = 'Повторить';
    button.onclick = retry;
    box.appendChild(button);
  }
  if (follow) scrollLatest();
  else updateLatest();
  persist();
}

// Build the inside of a bubble: optional image thumbnail, optional file
// attachment block, then optional text. Used by both live messages (addMsg)
// and restored history (renderRestore) so they look identical. `attached` is
// true when the user sent an image but the browser could not decode it
// locally (e.g. HEIC in Chrome) — show an honest note, not a fake. `file` is
// a small descriptor ({ name, size, snippet }) for an attached text file.
export function fillBubble(bubble, text, image, attached, file, video, voice) {
  if (voice) bubble.appendChild(makeVoiceBox(voice));
  if (video) bubble.appendChild(makeVideoBox(video));
  if (video?.kind === 'video-note') bubble.classList.add('has-video-note');
  if (typeof image === 'string' && image) {
    const img = document.createElement('img');
    img.className = 'bubble-image';
    img.src = image;
    img.alt = 'Прикреплённое изображение';
    img.loading = 'lazy';
    img.decoding = 'async';
    bubble.appendChild(img);
    bubble.classList.add('has-image');
  } else if (attached) {
    const note = document.createElement('div');
    note.className = 'bubble-attach-note';
    note.textContent = 'Изображение прикреплено';
    bubble.appendChild(note);
  }
  if (file && (file.name || file.snippet)) {
    const box = document.createElement('div');
    box.className = 'bubble-file';
    const nameEl = document.createElement('div');
    nameEl.className = 'bubble-file-name';
    nameEl.textContent = file.name || 'Файл';
    box.appendChild(nameEl);
    if (file.snippet) {
      const snipEl = document.createElement('div');
      snipEl.className = 'bubble-file-snippet';
      snipEl.textContent = file.snippet;
      box.appendChild(snipEl);
    }
    bubble.appendChild(box);
  }
  if (text) {
    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.innerHTML = renderText(text);
    bubble.appendChild(textEl);
  }
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function appendDate(timestamp) {
  if (!timestamp) return;
  const messages = chatEl.querySelectorAll('.msg');
  const previous = messages.length ? messages[messages.length - 1].getAttribute('data-created-at') : null;
  if (previous && dayKey(previous) === dayKey(timestamp)) return;
  const separator = document.createElement('div');
  separator.className = 'date-separator';
  const today = dayKey(new Date().toISOString());
  separator.textContent =
    dayKey(timestamp) === today
      ? 'Сегодня'
      : new Date(timestamp).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          ...(new Date(timestamp).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
        });
  chatEl.appendChild(separator);
}

export function appendTimestamp(wrap, bubble, timestamp) {
  if (!timestamp) return;
  wrap.setAttribute('data-created-at', timestamp);
  const meta = document.createElement('time');
  meta.className = 'meta';
  meta.setAttribute('datetime', timestamp);
  meta.textContent = timeLabel(timestamp);
  bubble.appendChild(meta);
}

export function addMsg(role, text, image, attached, file, video, voice) {
  if (role !== 'user') {
    text = hideAssistantTags(text).trim();
    if (!text && !image && !attached && !file && !video && !voice) return;
  }
  const follow = role === 'user' || nearBottom();
  welcomeCard.style.display = 'none';
  const timestamp = new Date().toISOString();
  appendDate(timestamp);
  const wrap = document.createElement('div');
  wrap.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  fillBubble(bubble, text, image, attached, file, video, voice);
  appendTimestamp(wrap, bubble, timestamp);
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  prepareMessageReactions(wrap, null);
  if (follow) scrollLatest();
  else updateLatest();
  if (role !== 'user') announcement.textContent = `${BOT_NAME}: ${text}`;
  persist();
  return wrap;
}
