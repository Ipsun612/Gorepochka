/* Capture only: no UI, uploads, Telegram credentials or speech recognition. */
export function recordingSupported() {
  return Boolean(
    globalThis.isSecureContext && globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder,
  );
}

export class VoiceRecorder {
  constructor({ maxBytes, maxSeconds, onUpdate = () => {}, onFinished = () => {}, onError = () => {} }) {
    Object.assign(this, { maxBytes, maxSeconds, onUpdate, onFinished, onError });
    this.phase = 'idle';
    this.elapsed = 0;
    this.chunks = [];
    this.peaks = [];
    this.bytes = 0;
    this.generation = 0;
  }

  duration() {
    return (this.elapsed + (this.phase === 'recording' ? performance.now() - this.startedAt : 0)) / 1000;
  }

  async start() {
    const generation = ++this.generation;
    this.phase = 'requesting';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // Analyser is optional. Recording remains usable if Web Audio is unavailable.
      try {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (Context) {
          this.context = new Context();
          this.analyser = this.context.createAnalyser();
          this.analyser.fftSize = 256;
          this.context.createMediaStreamSource(stream).connect(this.analyser);
          this.samples = new Uint8Array(this.analyser.fftSize);
          void this.context.resume().catch(() => {});
        }
      } catch (error) {
        /* A truthful flat waveform is preferable to fake levels. */
      }
      this.begin(stream, ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (generation !== this.generation) return;
      this.dispose();
      const messages = {
        NotAllowedError: 'Разрешите доступ к микрофону в настройках Telegram или браузера и попробуйте снова.',
        NotFoundError: 'Микрофон не найден. Подключите его и попробуйте снова.',
        NotReadableError: 'Микрофон занят другим приложением. Освободите его и попробуйте снова.',
        SecurityError: 'Этот клиент не разрешает запись. Откройте мини-приложение в обновлённом Telegram.',
      };
      this.onError(new Error(messages[error.name] || 'Не удалось включить микрофон. Попробуйте обновить Telegram.'));
    }
  }

  begin(stream, types, options = {}) {
    this.stream = stream;
    const mime = types.find((type) => MediaRecorder.isTypeSupported?.(type));
    this.recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 64000,
      ...options,
    });
    this.recorder.ondataavailable = ({ data }) => {
      if (!data?.size) return;
      this.bytes += data.size;
      this.chunks.push(data);
      if (this.bytes >= this.maxBytes && ['recording', 'paused'].includes(this.phase)) this.finish('limit');
    };
    this.recorder.onstop = () => this.complete();
    this.recorder.onerror = () => {
      if (this.phase === 'finishing') return;
      if (this.chunks.length) this.finish('interrupted');
      else {
        this.dispose();
        this.onError(new Error('Не удалось сохранить запись. Попробуйте ещё раз.'));
      }
    };
    stream.getTracks().forEach((track) => {
      track.onended = track.onmute = () => this.finish('interrupted');
    });
    this.startedAt = performance.now();
    this.recorder.start(250);
    this.phase = 'recording';
    this.timer = setInterval(() => this.tick(), 100);
    this.tick();
  }

  tick() {
    if (this.phase !== 'recording') return;
    let peak = 0;
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.samples);
      for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
    }
    this.peaks.push(Math.round(peak * 100));
    // Waveform memory is bounded even for large configured durations.
    if (this.peaks.length > 600) this.peaks = this.peaks.filter((_, index) => index % 2 === 0);
    this.onUpdate({ phase: this.phase, duration: this.duration(), peaks: this.peaks.slice(-48) });
    if (this.duration() >= this.maxSeconds) this.finish('limit');
  }

  togglePause() {
    if (!this.recorder) return;
    if (this.phase === 'recording') {
      if (typeof this.recorder.pause !== 'function' || typeof this.recorder.resume !== 'function') {
        this.finish('preview');
        return;
      }
      this.elapsed += performance.now() - this.startedAt;
      this.recorder.pause();
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      this.recorder.resume();
      this.startedAt = performance.now();
      this.phase = 'recording';
    } else return;
    this.onUpdate({ phase: this.phase, duration: this.duration(), peaks: this.peaks.slice(-48) });
  }

  finish(reason = 'preview') {
    if (!['recording', 'paused'].includes(this.phase)) return;
    this.finalDuration = this.duration();
    this.reason = reason;
    this.phase = 'finishing';
    clearInterval(this.timer);
    this.onUpdate({ phase: this.phase, duration: this.finalDuration, peaks: this.peaks.slice(-48) });
    try {
      this.recorder.stop();
    } catch (error) {
      this.complete();
    }
    this.releaseMicrophone();
  }

  complete() {
    if (this.phase !== 'finishing' && this.phase !== 'recording' && this.phase !== 'paused') return;
    const duration = this.finalDuration ?? this.duration();
    const reason = this.reason || 'interrupted';
    const blob = new Blob(this.chunks, {
      type: this.recorder.mimeType || this.chunks[0]?.type || 'application/octet-stream',
    });
    const peaks = this.peaks.slice();
    this.phase = 'finished';
    clearInterval(this.timer);
    this.releaseMicrophone();
    this.chunks = [];
    if (!blob.size || duration < 0.3) this.onError(new Error('Запись слишком короткая. Запишите хотя бы секунду.'));
    else if (blob.size > this.maxBytes)
      this.onError(new Error('Запись превышает лимит размера. Запишите сообщение покороче.'));
    else this.onFinished({ blob, duration, waveform: peaks.slice(-48), reason });
  }

  releaseMicrophone() {
    this.stream?.getTracks().forEach((track) => {
      track.onended = track.onmute = null;
      track.stop();
    });
    this.stream = null;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
    this.analyser = null;
  }

  dispose() {
    this.generation++;
    this.phase = 'disposed';
    clearInterval(this.timer);
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') {
        try {
          this.recorder.stop();
        } catch (error) {
          /* already ended */
        }
      }
    }
    this.releaseMicrophone();
    this.chunks = [];
  }
}
