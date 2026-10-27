import { videoDescriptor, fetchVideoBlob } from './video.js';
import { voiceTime, claimAudio, releaseAudio } from '../voice/voice.js';
import { persist } from '../chat/chatState.js';

export function makeVideoNoteBox(value) {
  const descriptor = videoDescriptor(value);
  const box = document.createElement('div');
  box.className = 'bubble-video bubble-video-note';
  box.videoDescriptor = descriptor;
  const ring = document.createElement('div');
  ring.className = 'note-ring';
  const player = document.createElement('video');
  player.className = 'note-disc';
  player.playsInline = true;
  player.muted = true;
  player.preload = 'none';
  player.setAttribute('aria-label', 'Видеосообщение');
  if (descriptor.poster) player.poster = descriptor.poster;
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'note-play';
  play.textContent = '▶';
  play.setAttribute('aria-label', 'Воспроизвести видеосообщение');
  play.disabled = !descriptor.id && !value.blob;
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'note-mute';
  mute.textContent = 'Звук';
  mute.setAttribute('aria-label', 'Включить звук видеосообщения');
  mute.setAttribute('aria-pressed', 'false');
  const time = document.createElement('span');
  time.className = 'note-time';
  time.textContent = voiceTime(descriptor.duration);
  ring.appendChild(player);
  ring.appendChild(play);
  ring.appendChild(mute);
  ring.appendChild(time);
  box.appendChild(ring);
  const seek = document.createElement('input');
  seek.className = 'voice-seek note-seek';
  seek.type = 'range';
  seek.min = '0';
  seek.max = '100';
  seek.step = '0.1';
  seek.value = '0';
  seek.disabled = true;
  seek.setAttribute('aria-label', 'Позиция воспроизведения видеосообщения');
  box.appendChild(seek);
  const status = document.createElement('div');
  status.className = 'video-status';
  status.setAttribute('role', 'status');
  status.textContent =
    descriptor.delivery === 'pending'
      ? 'Отправка прервана · запишите заново'
      : ['failed', 'cancelled'].includes(descriptor.delivery)
        ? 'Не отправлено · запишите заново'
        : 'Видеосообщение · доступно временно';
  box.appendChild(status);
  const controller = new AbortController();
  let objectUrl = value.blob ? URL.createObjectURL(value.blob) : '';
  box.videoBlob = value.blob || null;
  box.videoObjectUrl = objectUrl;
  if (objectUrl) {
    player.src = objectUrl;
    seek.disabled = false;
  }
  play.onclick = async () => {
    if (!player.paused) {
      player.pause();
      return;
    }
    play.disabled = true;
    try {
      if (!objectUrl) {
        const blob = await fetchVideoBlob(descriptor.id, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        player.src = objectUrl;
        box.videoObjectUrl = objectUrl;
      }
      claimAudio(player);
      await player.play();
      if (!controller.signal.aborted) seek.disabled = false;
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message || 'Не удалось воспроизвести видеосообщение.';
    } finally {
      if (!controller.signal.aborted) play.disabled = false;
    }
  };
  mute.onclick = () => {
    player.muted = !player.muted;
    mute.textContent = player.muted ? 'Звук' : 'Без звука';
    mute.setAttribute('aria-label', player.muted ? 'Включить звук видеосообщения' : 'Выключить звук видеосообщения');
    mute.setAttribute('aria-pressed', String(!player.muted));
  };
  player.onplay = () => {
    ring.classList.add('is-playing');
    play.textContent = 'Ⅱ';
    play.setAttribute('aria-label', 'Приостановить видеосообщение');
  };
  player.onpause = player.onended = () => {
    ring.classList.remove('is-playing');
    play.textContent = '▶';
    play.setAttribute('aria-label', 'Воспроизвести видеосообщение');
  };
  const total = () => (Number.isFinite(player.duration) && player.duration > 0 ? player.duration : descriptor.duration);
  const update = () => {
    const progress = total() > 0 ? (player.currentTime / total()) * 100 : 0;
    seek.value = String(progress);
    ring.style.setProperty('--progress', String(progress));
    time.textContent = `${voiceTime(player.currentTime)} / ${voiceTime(total())}`;
  };
  player.ontimeupdate = player.onloadedmetadata = update;
  player.onerror = () => {
    status.textContent = 'Не удалось воспроизвести видео в этом клиенте.';
  };
  seek.oninput = () => {
    if (total() > 0) {
      player.currentTime = (Number(seek.value) / 100) * total();
      update();
    }
  };
  let scrubbing = null;
  const scrub = (event) => {
    const rect = ring.getBoundingClientRect();
    const angle = Math.atan2(event.clientX - rect.left - rect.width / 2, -(event.clientY - rect.top - rect.height / 2));
    if (total() > 0) {
      player.currentTime = (((angle + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * total();
      update();
    }
  };
  ring.addEventListener('pointerdown', (event) => {
    if (seek.disabled || scrubbing !== null || (event.button !== undefined && event.button !== 0)) return;
    const rect = ring.getBoundingClientRect();
    const radius = Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    if (radius < rect.width * 0.42) return;
    event.preventDefault();
    event.stopPropagation();
    scrubbing = event.pointerId;
    ring.setPointerCapture?.(scrubbing);
    scrub(event);
  });
  ring.addEventListener('pointermove', (event) => {
    if (event.pointerId === scrubbing) scrub(event);
  });
  ring.addEventListener('pointerup', (event) => {
    if (event.pointerId === scrubbing) {
      scrub(event);
      scrubbing = null;
    }
  });
  ring.addEventListener('pointercancel', () => {
    scrubbing = null;
  });
  box.disposeVideo = (keepUrl = false) => {
    controller.abort();
    player.pause();
    releaseAudio(player);
    player.removeAttribute('src');
    player.load();
    if (!keepUrl && objectUrl) URL.revokeObjectURL(objectUrl);
    if (keepUrl && box.videoObjectUrl === objectUrl) box.videoObjectUrl = '';
    play.onclick = mute.onclick = seek.oninput = null;
    player.onplay =
      player.onpause =
      player.onended =
      player.ontimeupdate =
      player.onloadedmetadata =
      player.onerror =
        null;
    box.querySelectorAll('.video-retry').forEach((button) => {
      button.onclick = null;
    });
  };
  return box;
}

export function updateVideoNoteMessage(wrap, video, text, { retry, progress, delivery } = {}) {
  let box = wrap.querySelector('.bubble-video-note');
  if (video) {
    // Server metadata carries no bytes and replaces the pending local-blob box.
    // The old player is disposed (its blob URL revoked), which previously reset
    // mute to true and lost position, so a circle tapped while sending played
    // back silently. Preserve the user's sound choice and position instead.
    const prevPlayer = box?.querySelector('video') || null;
    const prevMuted = prevPlayer?.muted;
    const prevTime = Number.isFinite(prevPlayer?.currentTime) ? prevPlayer.currentTime : 0;
    const merged = { ...video, kind: 'video-note', delivery: delivery || box?.videoDescriptor.delivery || 'pending' };
    delete merged.blob;
    const replacement = makeVideoNoteBox(merged);
    if (box) {
      const nextPlayer = replacement.querySelector('video');
      const nextMute = replacement.querySelector('.note-mute');
      if (nextPlayer && prevPlayer && typeof prevMuted === 'boolean') {
        nextPlayer.muted = prevMuted;
        if (nextMute) {
          nextMute.textContent = nextPlayer.muted ? 'Звук' : 'Без звука';
          nextMute.setAttribute(
            'aria-label',
            nextPlayer.muted ? 'Включить звук видеосообщения' : 'Выключить звук видеосообщения',
          );
          nextMute.setAttribute('aria-pressed', String(!nextPlayer.muted));
        }
      }
      // Position survives as a pending resume: the new player has no src yet
      // (authenticated fetch happens on next play), so apply after metadata.
      if (nextPlayer && prevTime > 0) {
        const restoreTime = () => {
          try {
            nextPlayer.currentTime = prevTime;
          } catch (e) {}
        };
        nextPlayer.addEventListener('loadedmetadata', restoreTime, { once: true });
      }
      box.disposeVideo(false);
      wrap.querySelector('.bubble').insertBefore(replacement, box);
      box.remove();
      box = replacement;
    } else {
      const bubble = wrap.querySelector('.bubble');
      if (bubble) bubble.appendChild(replacement);
      box = replacement;
    }
  }
  if (!box) return;
  if (delivery) box.videoDescriptor.delivery = delivery;
  box.querySelector('.video-status').textContent = text;
  box.querySelectorAll('.video-retry').forEach((button) => {
    button.onclick = null;
    button.remove();
  });
  box.querySelectorAll('progress').forEach((bar) => bar.remove());
  if (typeof progress === 'number') {
    const bar = document.createElement('progress');
    bar.max = 100;
    bar.value = progress;
    bar.className = 'video-progress';
    box.appendChild(bar);
  }
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-action video-retry';
    button.textContent = 'Повторить';
    button.onclick = retry;
    box.appendChild(button);
  }
  persist();
}
