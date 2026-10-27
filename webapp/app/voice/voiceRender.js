import { voiceDescriptor, voiceTime, drawWaveform, fetchAudioBlob, claimAudio, releaseAudio } from './voice.js';
import { persist } from '../chat/chatState.js';

export function makeVoiceBox(value) {
  const descriptor = voiceDescriptor(value);
  const box = document.createElement('div');
  box.className = 'bubble-voice';
  box.voiceDescriptor = descriptor;
  const row = document.createElement('div');
  row.className = 'voice-playback-row';
  const button = document.createElement('button');
  button.className = 'icon-btn voice-play';
  button.type = 'button';
  button.textContent = '▶';
  button.setAttribute('aria-label', 'Воспроизвести голосовое сообщение');
  button.disabled = !descriptor.id && !value.blob;
  const waveform = document.createElement('div');
  waveform.className = 'voice-waveform';
  waveform.setAttribute('aria-hidden', 'true');
  drawWaveform(waveform, descriptor.waveform);
  const duration = document.createElement('span');
  duration.className = 'voice-time';
  duration.textContent = voiceTime(descriptor.duration);
  row.appendChild(button);
  row.appendChild(waveform);
  row.appendChild(duration);
  box.appendChild(row);
  const player = document.createElement('audio');
  player.preload = 'none';
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '100';
  seek.value = '0';
  seek.step = '0.1';
  seek.className = 'voice-seek';
  seek.setAttribute('aria-label', 'Позиция воспроизведения голосового сообщения');
  seek.disabled = true;
  box.appendChild(seek);
  const status = document.createElement('div');
  status.className = 'voice-status';
  status.setAttribute('role', 'status');
  status.textContent =
    descriptor.delivery === 'sent'
      ? 'Голосовое · доступно временно'
      : descriptor.delivery === 'pending'
        ? 'Отправка прервана · запишите заново'
        : 'Не отправлено · запишите заново';
  box.appendChild(status);
  box.appendChild(player);
  const controller = new AbortController();
  let objectUrl = value.blob ? URL.createObjectURL(value.blob) : '';
  if (objectUrl) {
    player.src = objectUrl;
    seek.disabled = false;
  }
  button.onclick = async () => {
    if (!player.paused) {
      player.pause();
      return;
    }
    button.disabled = true;
    try {
      if (!objectUrl) {
        const blob = await fetchAudioBlob(descriptor.id, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        player.src = objectUrl;
      }
      claimAudio(player);
      await player.play();
      seek.disabled = false;
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message || 'Не удалось воспроизвести запись.';
    } finally {
      if (!controller.signal.aborted) button.disabled = false;
    }
  };
  player.onplay = () => {
    button.textContent = 'Ⅱ';
    button.setAttribute('aria-label', 'Приостановить голосовое сообщение');
  };
  player.onpause = player.onended = () => {
    button.textContent = '▶';
    button.setAttribute('aria-label', 'Воспроизвести голосовое сообщение');
  };
  player.ontimeupdate = () => {
    const total = Number.isFinite(player.duration) ? player.duration : descriptor.duration;
    seek.value = String(total > 0 ? (player.currentTime / total) * 100 : 0);
    duration.textContent = `${voiceTime(player.currentTime)} / ${voiceTime(total)}`;
  };
  player.onerror = () => {
    status.textContent = 'Не удалось воспроизвести запись в этом клиенте.';
  };
  seek.oninput = () => {
    const total = Number.isFinite(player.duration) ? player.duration : descriptor.duration;
    if (total > 0) player.currentTime = (Number(seek.value) / 100) * total;
  };
  box.disposeVoice = () => {
    controller.abort();
    player.pause?.();
    releaseAudio(player);
    player.removeAttribute('src');
    player.load?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    button.onclick = null;
    seek.oninput = null;
    player.onplay = player.onpause = player.onended = player.ontimeupdate = player.onerror = null;
    box.querySelectorAll('.voice-retry').forEach((retry) => {
      retry.onclick = null;
    });
  };
  return box;
}

export function updateVoiceMessage(wrap, audio, text, { retry, progress, delivery } = {}) {
  let box = wrap.querySelector('.bubble-voice');
  if (audio) {
    const replacement = makeVoiceBox({ ...audio, delivery: delivery || box?.voiceDescriptor.delivery || 'pending' });
    if (box) {
      box.disposeVoice();
      wrap.querySelector('.bubble').insertBefore(replacement, box);
      box.remove();
    }
    box = replacement;
  }
  if (!box) return;
  if (delivery) box.voiceDescriptor.delivery = delivery;
  box.querySelector('.voice-status').textContent = text;
  box.querySelectorAll('.voice-retry').forEach((button) => {
    button.onclick = null;
    button.remove();
  });
  box.querySelectorAll('progress').forEach((bar) => bar.remove());
  if (typeof progress === 'number') {
    const bar = document.createElement('progress');
    bar.max = 100;
    bar.value = progress;
    bar.className = 'voice-progress';
    box.appendChild(bar);
  }
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-action voice-retry';
    button.textContent = 'Повторить';
    button.onclick = retry;
    box.appendChild(button);
  }
  persist();
}
