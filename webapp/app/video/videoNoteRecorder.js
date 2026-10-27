import { VoiceRecorder, recordingSupported } from '../voice/voiceRecorder.js';
import { mobileCameraPlatform } from '../core/recordingPlatform.js';

export function videoNoteSupported() {
  return recordingSupported() && Boolean(globalThis.MediaStream && document.createElement('canvas').captureStream);
}

/* A stable square canvas track lets us change cameras without replacing recorder tracks. */
export class VideoNoteRecorder extends VoiceRecorder {
  constructor(options) {
    super(options);
    this.preview = options.preview;
    this.onCamera = options.onCamera || (() => {});
    this.onNotice = options.onNotice || (() => {});
    this.facing = 'user';
  }

  async start() {
    const generation = ++this.generation;
    this.phase = 'requesting';
    let source;
    try {
      source = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(mobileCameraPlatform() ? { facingMode: 'user' } : {}),
          width: { ideal: 640 },
          height: { ideal: 640 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (generation !== this.generation) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      this.source = source;
      this.cameraTrack = source.getVideoTracks()[0];
      if (!this.cameraTrack || !source.getAudioTracks().length) throw new Error('missing tracks');
      this.facing = this.cameraTrack.getSettings?.().facingMode === 'environment' ? 'environment' : 'user';
      this.cameraTrack.onended = this.cameraTrack.onmute = () => this.finish('interrupted');
      this.camera = document.createElement('video');
      this.camera.muted = true;
      this.camera.playsInline = true;
      this.camera.srcObject = source;
      await this.camera.play();
      if (generation !== this.generation) return;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = 480;
      this.context2d = this.canvas.getContext('2d', { alpha: false });
      if (!this.context2d) throw new Error('canvas unavailable');
      this.draw();
      this.canvasStream = this.canvas.captureStream(24);
      this.drawTimer = setInterval(() => this.draw(), 1000 / 24);
      const stream = new MediaStream([...this.canvasStream.getVideoTracks(), ...source.getAudioTracks()]);
      this.preview.srcObject = stream;
      this.preview.muted = true;
      void this.preview.play().catch(() => {});
      this.begin(stream, ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'], {
        videoBitsPerSecond: 900000,
      });
      this.preview.classList.toggle('is-selfie', this.facing === 'user');
      const devices = await navigator.mediaDevices.enumerateDevices?.().catch(() => []);
      if (generation !== this.generation || this.phase !== 'recording') return;
      this.canFlip = mobileCameraPlatform() && devices?.filter((device) => device.kind === 'videoinput').length > 1;
      this.onCamera(Boolean(this.canFlip), false);
    } catch (error) {
      source?.getTracks().forEach((track) => track.stop());
      if (generation !== this.generation) return;
      this.dispose();
      const messages = {
        NotAllowedError: 'Разрешите доступ к камере и микрофону в настройках Telegram или браузера.',
        NotFoundError: 'Камера или микрофон не найдены. Проверьте подключение устройства.',
        NotReadableError: 'Камера или микрофон заняты другим приложением.',
      };
      this.onError(
        new Error(messages[error.name] || 'Не удалось включить видеозапись. Попробуйте обновить Telegram или браузер.'),
      );
    }
  }

  draw() {
    const video = this.camera;
    if (!video?.videoWidth || !video.videoHeight || !this.context2d) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    this.context2d.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      480,
      480,
    );
  }

  async flip() {
    if (!mobileCameraPlatform() || !this.canFlip || this.switching || this.phase !== 'recording') return;
    this.switching = true;
    this.onCamera(true, true);
    const generation = this.generation;
    const previous = this.facing;
    const next = previous === 'user' ? 'environment' : 'user';
    const acquire = async (facing) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: facing }, width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      if (generation !== this.generation || this.phase !== 'recording') {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.cameraTrack = stream.getVideoTracks()[0];
      this.cameraTrack.onended = this.cameraTrack.onmute = () => this.finish('interrupted');
      this.camera.srcObject = stream;
      await this.camera.play();
      if (generation !== this.generation || this.phase !== 'recording') return false;
      this.facing = facing;
      this.preview.classList.toggle('is-selfie', facing === 'user');
      return true;
    };
    // Phones often cannot open both cameras at once. Keep the canvas + microphone alive.
    this.cameraTrack.onended = this.cameraTrack.onmute = null;
    this.cameraTrack.stop();
    try {
      await acquire(next);
    } catch (error) {
      if (generation !== this.generation || this.phase !== 'recording') return;
      this.cameraTrack?.stop();
      try {
        if (await acquire(previous))
          this.onNotice('Не удалось переключить камеру. Запись продолжается с прежней камерой.');
      } catch (restoreError) {
        this.finish('interrupted');
      }
    } finally {
      this.switching = false;
      if (generation === this.generation && this.phase === 'recording') this.onCamera(true, false);
    }
  }

  releaseMicrophone() {
    clearInterval(this.drawTimer);
    if (this.cameraTrack) {
      this.cameraTrack.onended = this.cameraTrack.onmute = null;
      this.cameraTrack.stop();
    }
    this.source?.getTracks().forEach((track) => {
      track.onended = track.onmute = null;
      track.stop();
    });
    this.canvasStream?.getTracks().forEach((track) => {
      track.onended = track.onmute = null;
      track.stop();
    });
    this.camera?.pause();
    if (this.camera) this.camera.srcObject = null;
    if (this.preview) {
      this.preview.pause();
      this.preview.srcObject = null;
    }
    this.context2d = null;
    this.onCamera(false, false);
    super.releaseMicrophone();
  }
}
