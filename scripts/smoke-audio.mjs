/* Real recording-container conversion + native audio/chat lifecycle. No paid calls. */
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
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miniapp-audio-smoke-'));
let calls = 0;
let captured;
let mode = 'ok';
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    calls++;
    captured = JSON.parse(body);
    if (mode === 'hold') return;
    if (mode === 'fail') {
      res.writeHead(500).end('{}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: 'Слышу тебя<Разделить сообщение>Отвечаю на голосовое <Поставить реакцию: ❤️>' } },
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
  OPENROUTER_MODEL: 'test/native-audio',
  ANON_MODE: 'on',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
  RATE_LIMIT_MAX_REQUESTS: '1000',
  MAX_AUDIO_BYTES: '131072',
  AUDIO_MAX_DURATION_SECONDS: '2',
  AUDIO_MAX_OUTPUT_BYTES: '32768',
  AUDIO_CONTEXT_MAX_BYTES: '32768',
  AUDIO_MAX_CONCURRENT: '2',
  AUDIO_MAX_STORED: '50',
  AUDIO_PROCESS_TIMEOUT_MS: '15000',
  AUDIO_ANALYSIS_TIMEOUT_MS: '10000',
});
require('../dist/services/botProfile.js').getBotProfile = async () => ({ name: 'Audio test' });
const { createServer } = require('../dist/server/server.js');
const { getAudio, shutdownAudio, resolveAudioMessages } = require('../dist/services/audio.js');
const { shutdownVideos } = require('../dist/services/videos.js');
const { getHistory, clearHistory } = require('../dist/services/session.js');
const { closeProfileStore } = require('../dist/services/profile/store.js');
const { defaultTraits, characterInstructions } = require('../dist/services/character/definition.js');
const server = createServer().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const client = 'audio-owner-123';
const headers = { 'X-Miniapp-Client-Id': client };
async function request(route, options = {}) {
  const response = await fetch(base + route, { ...options, headers: { ...headers, ...options.headers } });
  return { status: response.status, body: await response.json() };
}
const post = (body) =>
  request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function upload(bytes, name = 'recording.bin', extra = false) {
  const form = new FormData();
  form.append('audio', new File([bytes], name, { type: 'application/octet-stream' }));
  if (extra) form.append('audio', new File([bytes], name));
  return request('/api/audio?chatId=1', { method: 'POST', body: form });
}
async function until(route, key, states = ['ready', 'failed']) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const { status, body } = await request(route);
    assert.equal(status, 200, JSON.stringify(body));
    const value = key ? body[key] : body;
    if (states.includes(value.state)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Polling timed out: ${route}`);
}
function fixture(extension, codec, duration = '0.7', live = false) {
  const target = live ? 'pipe:1' : path.join(directory, `sample-${duration}.${extension}`);
  const converted = spawnSync(
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
      'sine=frequency=440:sample_rate=24000',
      '-t',
      duration,
      '-c:a',
      codec,
      ...(live ? ['-f', 'webm'] : []),
      target,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  assert.equal(converted.status, 0, converted.stderr.toString());
  return live ? converted.stdout : fs.readFile(target);
}

try {
  const policy = await fetch(base + '/');
  assert.match(policy.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.match(policy.headers.get('permissions-policy'), /camera=\(self\)/);
  const unauthorized = await fetch(base + '/api/audio?chatId=1', {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': 'forged' },
    body: 'bad multipart',
  });
  assert.equal(unauthorized.status, 401, 'authenticate before parsing bytes');
  assert.equal((await request('/api/meta')).body.maxAudioDurationSeconds, 2);
  const profile = await request('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ biography: 'AUDIO_PROFILE_CONTEXT', birthday: null, revision: 0 }),
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  const audioTraits = { ...defaultTraits(), humor: 0, energy: 0 };
  assert.equal(
    (
      await request('/api/character-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits: audioTraits, revision: 0 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request('/api/lorebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { key: [], content: 'AUDIO_LORE_ALWAYS', constant: true },
            { key: ['Повтори'], content: 'AUDIO_LORE_TRIGGER', constant: false },
          ],
          revision: 0,
        }),
      })
    ).status,
    200,
  );
  let ready;
  let source;
  for (const [extension, codec, live] of [
    ['webm', 'libopus', true],
    ['m4a', 'aac', false],
    ['ogg', 'libopus', false],
    ['wav', 'pcm_s16le', false],
  ]) {
    const bytes = await fixture(extension, codec, '0.7', live);
    source ??= bytes;
    const accepted = await upload(bytes);
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    const audio = await until(`/api/audio/${accepted.body.audio.id}`, 'audio');
    assert.equal(audio.state, 'ready', `${extension}: ${JSON.stringify(audio)}`);
    assert.equal(audio.waveform.length, 48);
    assert.ok(audio.waveform.some((peak) => peak > 0));
    assert.ok(audio.duration > 0.6 && audio.duration < 1);
    const media = await fetch(base + `/api/audio/${audio.id}/media`, { headers });
    assert.equal(media.status, 200);
    assert.match(media.headers.get('cache-control'), /no-store/);
    assert.match(media.headers.get('content-type'), /audio\/mpeg/);
    const normalized = path.join(directory, `normalized-${extension}.mp3`);
    await fs.writeFile(normalized, Buffer.from(await media.arrayBuffer()));
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', normalized]);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, 'mp3');
    assert.equal(stream.channels, 1);
    ready ??= audio;
  }
  const privateRead = await request(`/api/audio/${ready.id}`, {
    headers: { 'X-Miniapp-Client-Id': 'other-owner-123' },
  });
  assert.equal(privateRead.status, 404);
  assert.equal(
    (
      await fetch(base + `/api/audio/${ready.id}/media`, {
        headers: { 'X-Miniapp-Client-Id': 'other-owner-123' },
      })
    ).status,
    404,
  );
  assert.equal((await post({ chatId: 2, audioId: ready.id, requestId: 'wrong-chat-123' })).status, 400);
  assert.equal((await post({ chatId: 1, audioId: ready.id })).status, 400);
  assert.equal(
    (await post({ chatId: 1, audioId: ready.id, image: 'bad', requestId: 'mixed-attachments-123' })).status,
    400,
  );
  const body = { chatId: 1, audioId: ready.id, requestId: 'first-audio-123', message: '' };
  const accepted = await post(body);
  assert.equal(accepted.status, 202);
  const completed = await until(`/api/chat-jobs/${accepted.body.jobId}`, null, ['complete', 'failed']);
  assert.equal(completed.state, 'complete', JSON.stringify(completed));
  assert.equal(completed.result.hasAudio, true);
  assert.equal(completed.result.messages.length, 2);
  assert.equal(completed.result.userReaction, '❤️');
  assert.ok(!completed.result.reply.includes('<'));
  assert.equal(captured.model, 'test/native-audio', 'never change configured model');
  const part = captured.messages.at(-1).content.find((entry) => entry.type === 'input_audio');
  assert.equal(part.input_audio.format, 'mp3');
  assert.ok(Buffer.from(part.input_audio.data, 'base64').length > 0);
  assert.ok(!JSON.stringify(captured).includes('audio_ref'), 'internal references never reach provider');
  assert.ok(JSON.stringify(captured).includes('AUDIO_PROFILE_CONTEXT'));
  assert.ok(captured.messages[0].content.includes(characterInstructions(audioTraits)));
  assert.ok(JSON.stringify(captured).includes('AUDIO_LORE_ALWAYS'));
  assert.ok(
    captured.messages
      .at(-1)
      .content.find((entry) => entry.type === 'text')
      .text.includes('AUDIO_LORE_ALWAYS'),
    'voice lore is attached to the current native-audio turn',
  );
  assert.ok(!captured.messages[0].content.includes('AUDIO_LORE_ALWAYS'));
  assert.ok(!JSON.stringify(captured).includes('AUDIO_LORE_TRIGGER'), 'no invented transcript for captionless audio');
  const count = calls;
  assert.equal((await post(body)).body.jobId, accepted.body.jobId);
  assert.equal(calls, count, 'retrying request ID does not pay twice');
  assert.equal((await request(`/api/chat-jobs/request/${body.requestId}`)).body.state, 'complete');
  const history = getHistory(`anon:${client}#c1`);
  assert.equal(history.length, 2);
  assert.ok(JSON.stringify(history).includes('audio_ref'));
  assert.ok(!JSON.stringify(history).includes('base64'));
  assert.ok(!JSON.stringify(history).includes('AUDIO_LORE_ALWAYS'));
  assert.equal((await request(`/api/audio/${ready.id}`, { method: 'DELETE' })).status, 409);
  const range = await fetch(base + `/api/audio/${ready.id}/media`, { headers: { ...headers, Range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  const followup = await post({ chatId: 1, message: 'Повтори, что я сказал', requestId: 'follow-up-audio-123' });
  assert.equal((await until(`/api/chat-jobs/${followup.body.jobId}`, null, ['complete', 'failed'])).state, 'complete');
  assert.ok(
    captured.messages.some(
      (entry) => Array.isArray(entry.content) && entry.content.some((value) => value.type === 'input_audio'),
    ),
  );
  assert.ok(
    captured.messages[0].content.includes(characterInstructions(audioTraits)),
    'voice follow-up uses the same personality path',
  );
  assert.ok(JSON.stringify(captured).includes('AUDIO_LORE_TRIGGER'), 'typed follow-up activates keyword lore');
  assert.ok(
    captured.messages.at(-1).content.includes('AUDIO_LORE_TRIGGER'),
    'typed follow-up retains lore in the actual current turn',
  );
  mode = 'fail';
  const before = history.length;
  const failed = await post({ ...body, requestId: 'failed-audio-123' });
  assert.equal((await until(`/api/chat-jobs/${failed.body.jobId}`, null, ['failed'])).state, 'failed');
  assert.equal(getHistory(`anon:${client}#c1`).length, before);
  mode = 'hold';
  const held = await post({ ...body, requestId: 'cancel-audio-123' });
  await request('/api/chat-jobs/request/cancel-audio-123', { method: 'DELETE' });
  assert.equal((await request(`/api/chat-jobs/${held.body.jobId}`)).body.state, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(getHistory(`anon:${client}#c1`).length, before);
  mode = 'ok';
  const retry = await post({ ...body, requestId: 'retry-audio-123' });
  assert.equal((await until(`/api/chat-jobs/${retry.body.jobId}`, null, ['complete', 'failed'])).state, 'complete');
  const bad = await upload(Buffer.from('not audio'));
  assert.equal((await until(`/api/audio/${bad.body.audio.id}`, 'audio')).state, 'failed');
  assert.equal((await upload(Buffer.alloc(150000))).status, 413);
  assert.equal((await upload(source, 'voice.webm', true)).status, 400);
  const long = await upload(await fixture('webm', 'libopus', '3', true));
  assert.equal(
    (await until(`/api/audio/${long.body.audio.id}`, 'audio')).state,
    'failed',
    'durationless WebM cannot bypass duration cap',
  );
  const { config } = require('../dist/config/config.js');
  const outputCap = config.AUDIO_MAX_OUTPUT_BYTES;
  config.AUDIO_MAX_OUTPUT_BYTES = 1024;
  const tooMuchOutput = await upload(source);
  assert.equal(
    (await until(`/api/audio/${tooMuchOutput.body.audio.id}`, 'audio')).state,
    'failed',
    'durationless input must not silently truncate to the output-byte cap',
  );
  config.AUDIO_MAX_OUTPUT_BYTES = outputCap;
  const missing = await resolveAudioMessages(
    [{ role: 'user', content: [{ type: 'audio_ref', audioId: 'missing' }] }],
    `anon:${client}`,
  );
  assert.match(missing[0].content[0].text, /unavailable/);
  const contextCap = config.AUDIO_CONTEXT_MAX_BYTES;
  config.AUDIO_CONTEXT_MAX_BYTES = 1;
  const omitted = await resolveAudioMessages(
    [{ role: 'user', content: [{ type: 'audio_ref', audioId: ready.id }] }],
    `anon:${client}`,
  );
  assert.match(omitted[0].content[0].text, /budget/);
  config.AUDIO_CONTEXT_MAX_BYTES = contextCap;
  const record = getAudio(ready.id, `anon:${client}`);
  record.expiresAt = 0;
  assert.equal((await request(`/api/audio/${ready.id}`)).status, 404);
  clearHistory(`anon:${client}#c1`);
  assert.equal(getAudio(ready.id, `anon:${client}`), undefined);
  console.log(
    'SMOKE OK — native audio, durationless WebM/MP4/Ogg/WAV conversion, waveform, auth, private/range playback, history, retry, cancel and limits.',
  );
} finally {
  clearHistory(`anon:${client}#c1`);
  await shutdownAudio();
  await shutdownVideos();
  closeProfileStore();
  server.closeAllConnections();
  stub.closeAllConnections();
  await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => stub.close(resolve))]);
  await fs.rm(directory, { recursive: true, force: true });
}
