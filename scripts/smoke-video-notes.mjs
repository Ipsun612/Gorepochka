/* Synthetic capture only: no camera, microphone, Telegram credentials or paid requests. */
import assert from 'node:assert/strict';
import { bindTapControl } from '../webapp/app/core/recordingGesture.js';

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const events = [];
const control = bindTapControl({ disabled: false, addEventListener() {} }, {});
control.cancel();
const tapButton = {
  disabled: false,
  handlers: {},
  addEventListener(name, fn) {
    (this.handlers[name] ??= []).push(fn);
  },
};
bindTapControl(tapButton, { delay: 10, onSingle: () => events.push('single'), onDouble: () => events.push('double') });
const click = () => tapButton.handlers.click.forEach((fn) => fn({ preventDefault() {} }));
click();
await wait(30);
assert.deepEqual(events.splice(0), ['single']);
click();
await wait(5);
click();
await wait(30);
assert.deepEqual(events.splice(0), ['double'], 'two quick taps switch mode without starting a recording');
click();
await wait(30);
click();
await wait(30);
assert.deepEqual(events.splice(0), ['single', 'single'], 'slow taps are two separate recordings');

globalThis.window = globalThis;
globalThis.isSecureContext = true;
let now = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
const tracks = [];
function track(kind) {
  const value = {
    kind,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  tracks.push(value);
  return value;
}
class Stream {
  constructor(values) {
    this.tracks = values;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((item) => item.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((item) => item.kind === 'video');
  }
}
globalThis.MediaStream = Stream;
const requests = [];
const source = (audio = true) => new Stream([track('video'), ...(audio ? [track('audio')] : [])]);
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla Android',
    mediaDevices: {
      getUserMedia: async (options) => {
        requests.push(options);
        return source(options.audio !== false);
      },
      enumerateDevices: async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }],
    },
  },
});
function element() {
  const classes = new Set();
  return {
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    play: async () => {},
    pause() {},
    classList: {
      add: (name) => classes.add(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    },
  };
}
globalThis.document = {
  createElement: (tag) =>
    tag === 'canvas'
      ? {
          getContext: () => ({
            drawImage(...args) {
              assert.equal(args.length, 9);
            },
          }),
          captureStream: () => new Stream([track('video')]),
        }
      : element(),
};
let recorderStarts = 0;
class Recorder {
  static isTypeSupported(type) {
    return type === 'video/mp4';
  }
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
  }
  start() {
    recorderStarts++;
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['video-with-audio'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}
globalThis.MediaRecorder = Recorder;
const { mobileCameraPlatform } = await import('../webapp/app/core/recordingPlatform.js');
const { VideoNoteRecorder, videoNoteSupported } = await import('../webapp/app/video/videoNoteRecorder.js');
assert.equal(videoNoteSupported(), true);
assert.equal(mobileCameraPlatform('tdesktop', { userAgent: 'Android' }), false);
assert.equal(mobileCameraPlatform('web', { userAgent: 'Windows', maxTouchPoints: 10 }), false);
assert.equal(mobileCameraPlatform('web', { userAgent: 'Macintosh', maxTouchPoints: 5 }), true);
assert.equal(mobileCameraPlatform('ios'), true);
const finished = [];
const errors = [];
const cameraStates = [];
const instances = [];
const make = (extra = {}) => {
  const value = new VideoNoteRecorder({
    preview: element(),
    maxSeconds: 60,
    maxBytes: 10000,
    onFinished: (recording) => finished.push(recording),
    onError: (error) => errors.push(error),
    onCamera: (...state) => cameraStates.push(state),
    ...extra,
  });
  instances.push(value);
  return value;
};
try {
  const first = make();
  await first.start();
  assert.equal(first.phase, 'recording');
  assert.equal(first.recorder.mimeType, 'video/mp4');
  assert.deepEqual(cameraStates.at(-1), [true, false]);
  const stableOutput = first.stream;
  const microphone = first.source.getAudioTracks()[0];
  const front = first.cameraTrack;
  await first.flip();
  assert.equal(first.facing, 'environment');
  assert.equal(front.stopped, true);
  assert.equal(first.stream, stableOutput, 'camera switching never replaces the recording stream');
  assert.equal(microphone.stopped, false);
  assert.equal(recorderStarts, 1);
  assert.equal(requests.at(-1).audio, false, 'camera switches must not open another microphone');
  now = 1200;
  first.finish('send');
  await wait();
  assert.equal(finished.at(-1).reason, 'send');
  assert.equal(finished.at(-1).duration, 1.2);
  assert.equal(microphone.stopped, true);
  assert.equal(first.cameraTrack.stopped, true);
  first.dispose();

  navigator.userAgent = 'Windows';
  const desktop = make();
  await desktop.start();
  assert.deepEqual(cameraStates.at(-1), [false, false]);
  assert.equal(requests.at(-1).video.facingMode, undefined, 'desktop uses the default webcam');
  const beforeFlip = requests.length;
  desktop.canFlip = true;
  await desktop.flip();
  assert.equal(requests.length, beforeFlip, 'desktop flip is blocked by capture code as well as UI');
  desktop.dispose();
  navigator.userAgent = 'Android';

  const getMedia = navigator.mediaDevices.getUserMedia;
  let permission;
  navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      permission = resolve;
    });
  const pending = make();
  const starting = pending.start();
  pending.dispose();
  const late = source();
  permission(late);
  await starting;
  assert.ok(late.getTracks().every((item) => item.stopped));
  assert.equal(pending.recorder, undefined, 'released permission requests must not begin recording');
  navigator.mediaDevices.getUserMedia = getMedia;

  const switching = make();
  await switching.start();
  navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      permission = resolve;
    });
  const flipping = switching.flip();
  now += 1000;
  switching.finish('interrupted');
  const lateCamera = source(false);
  permission(lateCamera);
  await flipping;
  await wait();
  assert.ok(lateCamera.getTracks().every((item) => item.stopped));
  assert.equal(finished.at(-1).reason, 'interrupted');
  switching.dispose();
  navigator.mediaDevices.getUserMedia = getMedia;

  const notices = [];
  const rollback = make({ onNotice: (message) => notices.push(message) });
  await rollback.start();
  let failures = 0;
  navigator.mediaDevices.getUserMedia = async (options) => {
    if (!failures++) throw new Error('rear camera busy');
    return getMedia(options);
  };
  await rollback.flip();
  assert.equal(rollback.phase, 'recording');
  assert.equal(rollback.facing, 'user');
  assert.equal(notices.length, 1);
  rollback.dispose();
  navigator.mediaDevices.getUserMedia = getMedia;

  const bounded = make({ maxSeconds: 1 });
  await bounded.start();
  now += 1100;
  bounded.tick();
  await wait();
  assert.equal(finished.at(-1).reason, 'limit');
  bounded.dispose();
  const muted = make();
  await muted.start();
  now += 1000;
  muted.source.getAudioTracks()[0].onmute();
  await wait();
  assert.equal(finished.at(-1).reason, 'interrupted');
  muted.dispose();
  const cameraLost = make();
  await cameraLost.start();
  now += 1000;
  cameraLost.cameraTrack.onended();
  await wait();
  assert.equal(finished.at(-1).reason, 'interrupted');
  cameraLost.dispose();
  const tiny = make({ maxBytes: 1 });
  await tiny.start();
  now += 1000;
  tiny.finish();
  await wait();
  assert.match(errors.at(-1).message, /размера/);
  tiny.dispose();
  navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error(), { name: 'NotAllowedError' });
  };
  const denied = make();
  await denied.start();
  assert.match(errors.at(-1).message, /Разрешите/);
} finally {
  instances.forEach((instance) => instance.dispose());
}
assert.ok(
  tracks.every((item) => item.stopped),
  'all camera, microphone and canvas tracks are released',
);
console.log(
  'SMOKE OK — single/double tap, camera switching/rollback, desktop exclusion, late permissions, limits and cleanup.',
);
