/* Real FFmpeg conversions + authenticated upload/job/media integration.
   Provider calls go to a local stub; no real keys, Telegram, or paid requests. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { File } from 'node:buffer';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miniapp-video-smoke-'));
let calls = 0;
let captured;
let providerMode = 'ok';
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    calls++;
    captured = JSON.parse(body);
    if (providerMode === 'hold') return; // released by client cancellation
    if (providerMode === 'fail') {
      res.writeHead(500).end('{}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: 'Video understood<Разделить сообщение>Audio preserved <Поставить реакцию: 😮>' } },
        ],
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'x'.repeat(40),
  OPENROUTER_API_KEY: 'y'.repeat(40),
  OPENROUTER_BASE_URL: `http://127.0.0.1:${stub.address().port}/api/v1`,
  OPENROUTER_MODEL: 'test/video',
  ANON_MODE: 'on',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
  RATE_LIMIT_MAX_REQUESTS: '500',
  MAX_VIDEO_BYTES: '262144',
  VIDEO_MAX_DURATION_SECONDS: '2',
  VIDEO_MAX_OUTPUT_BYTES: '1048576',
  VIDEO_MAX_CONCURRENT: '2',
  VIDEO_MAX_STORED: '20',
  VIDEO_PROCESS_TIMEOUT_MS: '15000',
  VIDEO_ANALYSIS_TIMEOUT_MS: '10000',
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
});
require('../dist/services/botProfile.js').getBotProfile = async () => ({ name: 'Video test bot' });
const { createServer } = require('../dist/server/server.js');
const { shutdownVideos, getVideo, checkVideoTools } = require('../dist/services/videos.js');
const { getHistory } = require('../dist/services/session.js');
const server = createServer().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const owner = 'video-owner-123';
const headers = (client = owner) => ({ 'X-Miniapp-Client-Id': client });
async function request(route, options = {}) {
  const res = await fetch(base + route, { ...options, headers: { ...headers(), ...options.headers } });
  return { status: res.status, body: await res.json() };
}
const post = (body) =>
  request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function upload(buffer, name = 'movie.bin', type = 'application/octet-stream', kind = 'attachment', slot = 1) {
  const form = new FormData();
  form.append('video', new File([buffer], name, { type }));
  return request(`/api/videos?chatId=${slot}&kind=${kind}`, { method: 'POST', body: form });
}
async function until(route, key, states = ['ready', 'failed']) {
  for (let n = 0; n < 200; n++) {
    const response = await request(route);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const value = key ? response.body[key] : response.body;
    if (states.includes(value.state)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out polling ${route}`);
}
function fixture(name, codecArgs, duration = '0.6', audio = true, pattern = 'testsrc=size=96x64:rate=12') {
  const file = path.join(directory, name);
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      pattern,
      ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100'] : []),
      '-t',
      duration,
      ...codecArgs,
      '-threads',
      '1',
      file,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return fs.readFile(file);
}

try {
  await checkVideoTools();
  const profile = await request('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ biography: 'VIDEO_PROFILE_FACT', birthday: { day: 5, month: 6, year: 1994 }, revision: 0 }),
  });
  assert.equal(profile.status, 200);
  assert.equal(
    (
      await request('/api/lorebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { key: [], content: 'VIDEO_LORE_ALWAYS', constant: true },
            { key: ['sound'], content: 'VIDEO_LORE_TRIGGER', constant: false },
          ],
          revision: 0,
        }),
      })
    ).status,
    200,
  );
  const meta = await request('/api/meta');
  assert.equal(meta.body.maxVideoBytes, 262144);
  assert.equal(meta.body.maxVideoNoteDurationSeconds, 2, 'notes honor a lower global video cap');
  assert.match((await fetch(base)).headers.get('permissions-policy'), /camera=\(self\)/);
  assert.equal((await request('/api/videos?chatId=1&kind=bad', { method: 'POST' })).status, 400);
  const forbidden = await fetch(base + '/api/videos?chatId=1', {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': 'forged' },
    body: 'not parsed',
  });
  assert.equal(forbidden.status, 401, 'auth happens before multipart parsing');

  const formats = [
    ['mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], true],
    ['mov', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], true],
    ['webm', ['-c:v', 'libvpx-vp9', '-c:a', 'libopus'], true],
    ['mkv', ['-c:v', 'mpeg4', '-c:a', 'aac'], true],
    ['avi', ['-c:v', 'mpeg4'], false],
    ['wmv', ['-c:v', 'wmv2'], false],
    ['ts', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], true],
  ];
  let ready;
  let original;
  for (const [ext, args, audio] of formats) {
    const source = await fixture(`sample.${ext}`, args, '0.6', audio);
    original ??= source;
    // Wrong/missing extensions and MIME must never prevent server decoding.
    const response = await upload(source, ext === 'mp4' ? 'unknown.bin' : `clip.${ext}`);
    assert.equal(response.status, 202, JSON.stringify(response.body));
    const video = await until(`/api/videos/${response.body.video.id}`, 'video');
    assert.equal(video.state, 'ready', `${ext}: ${JSON.stringify(video)}`);
    assert.equal(video.hasAudio, audio, ext);
    assert.match(video.poster, /^data:image\/jpeg;base64,/);
    ready ??= video;
    const media = await fetch(base + `/api/videos/${video.id}/media`, { headers: headers() });
    assert.equal(media.status, 200);
    assert.match(media.headers.get('cache-control'), /no-store/);
    const convertedPath = path.join(directory, `converted-${ext}.mp4`);
    await fs.writeFile(convertedPath, Buffer.from(await media.arrayBuffer()));
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', convertedPath], {
      encoding: 'utf8',
    });
    assert.equal(probe.status, 0, probe.stderr);
    const streams = JSON.parse(probe.stdout).streams;
    assert.equal(streams.find((stream) => stream.codec_type === 'video').codec_name, 'h264');
    if (audio) assert.equal(streams.find((stream) => stream.codec_type === 'audio').codec_name, 'aac');
  }

  // Actual browser-style WebM: live muxing omits duration metadata.
  const live = await fixture('live.webm', ['-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-live', '1']);
  const livePath = path.join(directory, 'live.webm');
  const liveProbe = spawnSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', livePath], { encoding: 'utf8' });
  assert.equal(JSON.parse(liveProbe.stdout).format.duration, undefined);
  const liveUpload = await upload(live, 'recording.webm', 'video/webm', 'video-note', 2);
  const note = await until(`/api/videos/${liveUpload.body.video.id}`, 'video');
  assert.equal(note.state, 'ready', JSON.stringify(note));
  assert.equal(note.kind, 'video-note');
  assert.equal(note.hasAudio, true);
  const noteMedia = await fetch(base + `/api/videos/${note.id}/media`, { headers: headers() });
  const squarePath = path.join(directory, 'square-note.mp4');
  await fs.writeFile(squarePath, Buffer.from(await noteMedia.arrayBuffer()));
  const squareProbe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', squarePath], {
    encoding: 'utf8',
  });
  const squareVideo = JSON.parse(squareProbe.stdout).streams.find((stream) => stream.codec_type === 'video');
  assert.equal(squareVideo.width, squareVideo.height);
  assert.equal(squareVideo.width, 480);
  assert.equal((await request(`/api/videos/${note.id}`, { headers: headers('other-owner-123') })).status, 404);
  const noteJob = await post({ chatId: 2, videoId: note.id, requestId: 'circular-note-123', message: '' });
  assert.equal((await until(`/api/chat-jobs/${noteJob.body.jobId}`, null, ['complete', 'failed'])).state, 'complete');
  assert.ok(captured.messages.at(-1).content.some((part) => part.type === 'video_url'));
  assert.match(captured.messages.at(-1).content.find((part) => part.type === 'text').text, /respond naturally/);
  assert.ok(
    !JSON.stringify(captured).includes('input_audio'),
    'video is natively understood, not separately transcribed',
  );
  assert.ok(JSON.stringify(captured).includes('VIDEO_LORE_ALWAYS'), 'circular notes share the lorebook');
  assert.ok(
    captured.messages
      .at(-1)
      .content.find((part) => part.type === 'text')
      .text.includes('VIDEO_LORE_ALWAYS'),
    'note lore is attached to the current video turn',
  );
  assert.ok(!JSON.stringify(captured).includes('VIDEO_LORE_TRIGGER'), 'no invented video transcript');
  const liveTooLong = await upload(
    await fixture('live-long.webm', ['-c:v', 'libvpx-vp9', '-live', '1'], '3', false),
    'live.webm',
    'video/webm',
    'video-note',
  );
  const liveRejected = await until(`/api/videos/${liveTooLong.body.video.id}`, 'video');
  assert.equal(liveRejected.state, 'failed');
  assert.match(liveRejected.error, /too long/);

  const crossOwner = await request(`/api/videos/${ready.id}`, { headers: headers('other-owner-123') });
  assert.equal(crossOwner.status, 404);
  const crossMedia = await fetch(base + `/api/videos/${ready.id}/media`, { headers: headers('other-owner-123') });
  assert.equal(crossMedia.status, 404);
  assert.equal((await post({ chatId: 2, videoId: ready.id, requestId: 'wrong-slot-123' })).status, 400);

  const body = { chatId: 1, videoId: ready.id, requestId: 'first-video-123', message: '' };
  const { defaultTraits, characterInstructions } = require('../dist/services/character/definition.js');
  const videoTraits = { ...defaultTraits(), humor: 0, curiosity: 0 };
  assert.equal(
    (
      await request('/api/character-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits: videoTraits, revision: 0 }),
      })
    ).status,
    200,
  );
  const accepted = await post(body);
  assert.equal(accepted.status, 202);
  const result = await until(`/api/chat-jobs/${accepted.body.jobId}`, null, ['complete', 'failed']);
  assert.equal(result.state, 'complete', JSON.stringify(result));
  assert.equal(result.result.hasVideo, true);
  assert.equal(result.result.messages.length, 2);
  assert.equal(result.result.userReaction, '😮');
  assert.ok(!result.result.reply.includes('<'));
  const part = captured.messages.at(-1).content.find((part) => part.type === 'video_url');
  assert.match(part.video_url.url, /^data:video\/mp4;base64,/);
  assert.ok(!JSON.stringify(captured).includes('video_ref'), 'private references never reach provider');
  const videoProfile = captured.messages.find(
    (message) => typeof message.content === 'string' && message.content.startsWith('Текущий профиль собеседника'),
  );
  assert.match(videoProfile.content, /VIDEO_PROFILE_FACT/);
  assert.ok(!videoProfile.content.includes('1994'), 'video profile context also excludes birthday');
  assert.ok(captured.messages[0].content.includes(characterInstructions(videoTraits)));
  assert.ok(JSON.stringify(captured).includes('VIDEO_LORE_ALWAYS'));
  assert.ok(
    captured.messages
      .at(-1)
      .content.find((part) => part.type === 'text')
      .text.includes('VIDEO_LORE_ALWAYS'),
    'video lore is attached to the current turn',
  );
  assert.ok(!captured.messages[0].content.includes('VIDEO_LORE_ALWAYS'));
  const count = calls;
  const repeated = await post(body);
  assert.equal(repeated.body.jobId, accepted.body.jobId);
  assert.equal(calls, count, 'same requestId never duplicates a paid call');
  const history = getHistory('anon:video-owner-123#c1');
  assert.equal(history.length, 2);
  assert.ok(JSON.stringify(history).includes('video_ref'));
  assert.ok(!JSON.stringify(history).includes('base64'), 'history never stores full videos');
  assert.ok(!JSON.stringify(history).includes('VIDEO_LORE_ALWAYS'));

  const followup = await post({ chatId: 1, message: 'What was the sound?', requestId: 'follow-up-123' });
  assert.equal(followup.status, 202);
  assert.equal((await until(`/api/chat-jobs/${followup.body.jobId}`, null, ['complete', 'failed'])).state, 'complete');
  assert.ok(
    captured.messages.some(
      (message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'video_url'),
    ),
  );
  assert.ok(
    captured.messages.some(
      (message) => typeof message.content === 'string' && message.content.includes('VIDEO_PROFILE_FACT'),
    ),
  );
  assert.ok(
    captured.messages[0].content.includes(characterInstructions(videoTraits)),
    'video follow-up keeps current personality',
  );
  assert.ok(JSON.stringify(captured).includes('VIDEO_LORE_TRIGGER'), 'video follow-up uses typed keyword matching');
  assert.ok(
    captured.messages.at(-1).content.includes('VIDEO_LORE_TRIGGER'),
    'follow-up question and lore share one turn',
  );

  providerMode = 'fail';
  const historyCount = getHistory('anon:video-owner-123#c1').length;
  const failed = await post({ ...body, requestId: 'failed-video-123' });
  assert.equal((await until(`/api/chat-jobs/${failed.body.jobId}`, null, ['complete', 'failed'])).state, 'failed');
  assert.equal(getHistory('anon:video-owner-123#c1').length, historyCount, 'failed request commits neither turn');

  providerMode = 'hold';
  const held = await post({ ...body, requestId: 'cancel-video-123' });
  const locked = await post({ chatId: 1, message: 'duplicate', requestId: 'locked-video-123' });
  assert.equal(locked.status, 409);
  assert.equal((await request(`/api/chat-jobs/${held.body.jobId}`, { method: 'DELETE' })).body.state, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(getHistory('anon:video-owner-123#c1').length, historyCount);
  providerMode = 'ok';

  const invalid = await upload(Buffer.from('not a video'), 'fake.mp4', 'video/mp4');
  assert.equal((await until(`/api/videos/${invalid.body.video.id}`, 'video')).state, 'failed');
  assert.equal((await upload(Buffer.alloc(300000))).status, 413);
  const long = await upload(await fixture('long.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], '3', false));
  const rejected = await until(`/api/videos/${long.body.video.id}`, 'video');
  assert.equal(rejected.state, 'failed');
  assert.match(rejected.error, /too long/);

  // Manifest files cannot read local paths or URLs through FFmpeg.
  const manifest = await upload(Buffer.from('ffconcat version 1.0\nfile http://127.0.0.1:1/private\n'), 'list.concat');
  assert.equal((await until(`/api/videos/${manifest.body.video.id}`, 'video')).state, 'failed');

  // The one-minute note cap is independent of ordinary video attachment limits.
  const { config } = require('../dist/config/config.js');
  config.VIDEO_MAX_DURATION_SECONDS = 120;
  assert.equal((await request('/api/meta')).body.maxVideoNoteDurationSeconds, 60);
  const minute = await fixture(
    'minute.mp4',
    ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
    '61',
    false,
    'color=c=blue:size=96x64:rate=12',
  );
  const overNote = await upload(minute, 'note.mp4', 'video/mp4', 'video-note');
  const noteRejected = await until(`/api/videos/${overNote.body.video.id}`, 'video');
  assert.equal(noteRejected.state, 'failed');
  assert.match(noteRejected.error, /max 60 seconds/);
  const regularMinute = await upload(minute, 'attachment.mp4', 'video/mp4');
  assert.equal((await until(`/api/videos/${regularMinute.body.video.id}`, 'video')).state, 'ready');
  const remove = await request('/api/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: 1 }),
  });
  assert.equal(remove.status, 200);
  assert.equal((await request(`/api/videos/${ready.id}`)).status, 404);
  assert.equal(getVideo(ready.id, 'anon:video-owner-123'), undefined);
  assert.equal(getHistory('anon:video-owner-123#c1').length, 0);
  console.log(
    'SMOKE OK — 7 containers, durationless WebM, square video notes, separate 60s cap, native video/audio understanding, private playback, idempotency, history, cancellation and validation.',
  );
} finally {
  await shutdownVideos();
  server.closeAllConnections();
  stub.closeAllConnections();
  await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => stub.close(resolve))]);
  await fs.rm(directory, { recursive: true, force: true });
}
