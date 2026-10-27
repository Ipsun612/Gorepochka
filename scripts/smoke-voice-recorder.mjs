import assert from 'node:assert/strict';
import { VoiceRecorder, recordingSupported } from '../webapp/app/voice/voiceRecorder.js';

let now = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.isSecureContext = true;
const tracks = [];
function stream() {
  const track = {
    enabled: true,
    stopped: false,
    onended: null,
    stop() {
      this.stopped = true;
    },
  };
  tracks.push(track);
  return { getTracks: () => [track], getAudioTracks: () => [track] };
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => stream() } },
});
class Recorder {
  static isTypeSupported(type) {
    return type === 'audio/mp4';
  }
  constructor(source, options) {
    this.source = source;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['recorded-audio'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}
globalThis.MediaRecorder = Recorder;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const completed = [];
const errors = [];
const make = (extra = {}) =>
  new VoiceRecorder({
    maxBytes: 1000,
    maxSeconds: 10,
    onFinished: (value) => completed.push(value),
    onError: (error) => errors.push(error),
    ...extra,
  });

assert.equal(recordingSupported(), true);
globalThis.isSecureContext = false;
assert.equal(recordingSupported(), false);
globalThis.isSecureContext = true;
const first = make();
await first.start();
assert.equal(first.phase, 'recording');
assert.equal(first.recorder.mimeType, 'audio/mp4', 'choose supported container rather than hard-code WebM');
now = 1000;
first.togglePause();
assert.equal(first.phase, 'paused');
assert.equal(tracks.at(-1).enabled, false, 'pause disables capture as well as the recorder');
now = 6000;
assert.equal(first.duration(), 1, 'pauses do not increase recording time');
first.togglePause();
assert.equal(tracks.at(-1).enabled, true);
now = 7000;
first.finish();
await flush();
assert.equal(completed.length, 1);
assert.equal(completed[0].duration, 2);
assert.equal(completed[0].blob.type, 'audio/mp4');
assert.equal(tracks.at(-1).stopped, true, 'preview releases microphone');
first.dispose();
assert.equal(first.chunks.length, 0);

// Cancel a pending permission request. Its eventual stream must never record.
let permission;
navigator.mediaDevices.getUserMedia = () =>
  new Promise((resolve) => {
    permission = resolve;
  });
const pending = make();
const starting = pending.start();
pending.dispose();
permission(stream());
await starting;
assert.equal(tracks.at(-1).stopped, true);
assert.equal(pending.recorder, undefined);
navigator.mediaDevices.getUserMedia = async () => stream();

const bounded = make({ maxSeconds: 1 });
await bounded.start();
now += 1100;
bounded.tick();
await flush();
assert.equal(completed.at(-1).reason, 'limit');
assert.equal(tracks.at(-1).stopped, true);
bounded.dispose();
const interrupted = make();
await interrupted.start();
now += 1000;
tracks.at(-1).onended();
await flush();
assert.equal(completed.at(-1).reason, 'interrupted');
assert.equal(tracks.at(-1).stopped, true);
interrupted.dispose();

const tooShort = make();
await tooShort.start();
tooShort.finish();
await flush();
assert.match(errors.at(-1).message, /короткая/);
tooShort.dispose();
const tooLarge = make({ maxBytes: 2 });
await tooLarge.start();
now += 1000;
tooLarge.finish();
await flush();
assert.match(errors.at(-1).message, /размера/);
tooLarge.dispose();
const before = completed.length;
const discarded = make();
await discarded.start();
now += 1000;
discarded.dispose();
await flush();
assert.equal(completed.length, before, 'discarded callbacks never resurrect a draft');
assert.equal(tracks.at(-1).stopped, true);

navigator.mediaDevices.getUserMedia = async () => {
  throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
};
const denied = make();
await denied.start();
assert.match(errors.at(-1).message, /Разрешите/);
denied.dispose();
assert.ok(
  tracks.every((track) => track.stopped),
  'no test leaves a live microphone track',
);
console.log(
  'SMOKE OK — recorder permission races, runtime formats, pause timing, capture suppression, preview, limits, interruption and cleanup.',
);
