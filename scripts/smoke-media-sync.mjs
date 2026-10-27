/* Cross-device media sync: images + text files inline, video/audio durable. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const tempRoot = path.join(os.tmpdir(), 'opencode');
await fs.mkdir(tempRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(tempRoot, 'media-sync-smoke-'));
const token = 'media-sync-test-token-'.repeat(3);
const provider = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Понял' } }] }));
  });
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: token,
  OPENROUTER_API_KEY: 'test-key-'.repeat(8),
  OPENROUTER_MODEL: 'test/media-sync',
  OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.address().port}/api/v1`,
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
  MAX_HISTORY_MESSAGES: '35',
  ANON_MODE: 'off',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
  RATE_LIMIT_MAX_REQUESTS: '1000',
});
const sharp = require('sharp');
const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aabbcc' } })
  .jpeg()
  .toBuffer();
const { createServer } = require('../dist/server/server.js');
const { closeProfileStore } = require('../dist/services/profile/store.js');
const server = createServer().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
function signed(id = 101) {
  const data = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Test' }),
  });
  const text = [...data.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  data.set('hash', crypto.createHmac('sha256', secret).update(text).digest('hex'));
  return data.toString();
}
async function request(route, { id = 101, body, method } = {}) {
  const response = await fetch(base + route, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'X-Telegram-Init-Data': signed(id), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

try {
  // Image turn: JPEG dataURL must come back inline for device B.
  const imageDataUrl = `data:image/png;base64,${jpeg.toString('base64')}`;
  const imgSent = await request('/api/chat', { body: { chatId: 1, message: 'Смотри', image: imageDataUrl } });
  assert.equal(imgSent.status, 200);
  const imgHistory = await request('/api/chat/history?chatId=1&limit=50');
  assert.equal(imgHistory.status, 200);
  const imgTurn = imgHistory.data.messages.find((m) => m.role === 'user' && m.image);
  assert.ok(imgTurn, 'image turn returns inline JPEG for cross-device display');
  assert.match(imgTurn.image, /^data:image\/jpeg;base64,/);
  assert.equal(imgTurn.file, null);
  assert.equal(imgTurn.text, 'Смотри');

  // Captionless image: empty text but image present.
  const capless = await request('/api/chat', { body: { chatId: 2, image: imageDataUrl } });
  assert.equal(capless.status, 200);
  const caplessHistory = await request('/api/chat/history?chatId=2&limit=50');
  const caplessTurn = caplessHistory.data.messages.find((m) => m.role === 'user' && m.image);
  assert.ok(caplessTurn);
  assert.equal(caplessTurn.text, '');

  // Text-file turn: descriptor + message split for device B.
  const fileText = 'hello from a synced file\nsecond line';
  const fileDataUrl = `data:text/plain;base64,${Buffer.from(fileText).toString('base64')}`;
  const fileSent = await request('/api/chat', {
    body: { chatId: 3, message: 'Прочти', file: fileDataUrl, fileName: 'notes.md' },
  });
  assert.equal(fileSent.status, 200);
  const fileHistory = await request('/api/chat/history?chatId=3&limit=50');
  const fileTurn = fileHistory.data.messages.find((m) => m.role === 'user' && m.file);
  assert.ok(fileTurn, 'file descriptor synced');
  assert.equal(fileTurn.file.name, 'notes.md');
  assert.ok(fileTurn.file.snippet.includes('hello from a synced file'));
  assert.equal(fileTurn.text, 'Прочти');

  // Verified video: upload → commit → history descriptor + private playback (device B).
  const ffmpeg = require('ffmpeg-static');
  const { spawnSync: spawnFfmpeg } = require('node:child_process');
  const clipPath = path.join(directory, 'clip.mp4');
  {
    const result = spawnFfmpeg(
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
        'testsrc=size=96x64:rate=12',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-t',
        '0.6',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-threads',
        '1',
        clipPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  const clipBytes = await fs.readFile(clipPath);
  const form = new FormData();
  form.append('video', new File([clipBytes], 'clip.mp4', { type: 'video/mp4' }));
  const uploaded = await fetch(`${base}/api/videos?chatId=4`, {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': signed(101) },
    body: form,
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  assert.equal(uploaded.status, 202);
  const videoId = uploaded.data.video.id;
  async function untilVideo(id) {
    for (let n = 0; n < 200; n++) {
      const s = await request(`/api/videos/${id}`);
      assert.equal(s.status, 200);
      if (s.data.video.state === 'ready') return s.data.video;
      assert.notEqual(s.data.video.state, 'failed', JSON.stringify(s.data.video));
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('video never ready');
  }
  const ready = await untilVideo(videoId);
  assert.ok(ready.poster);
  const chatRes = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': signed(101), 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: 4, videoId, requestId: 'media-sync-video-123', message: 'Смотри' }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  assert.equal(chatRes.status, 202);
  async function untilJob(id) {
    for (let n = 0; n < 200; n++) {
      const j = await request(`/api/chat-jobs/${id}`);
      if (j.data.state === 'complete' || j.data.state === 'failed') return j.data;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('job never finished');
  }
  const job = await untilJob(chatRes.data.jobId);
  assert.equal(job.state, 'complete');
  const vidHistory = await request('/api/chat/history?chatId=4&limit=50');
  const vidTurn = vidHistory.data.messages.find((m) => m.role === 'user' && m.video);
  assert.ok(vidTurn, 'video descriptor synced for device B');
  assert.equal(vidTurn.video.id, videoId);
  assert.ok(vidTurn.video.poster);
  const mediaRes = await fetch(`${base}/api/videos/${videoId}/media`, {
    headers: { 'X-Telegram-Init-Data': signed(101) },
  });
  assert.equal(mediaRes.status, 200);
  assert.match(mediaRes.headers.get('content-type') || '', /video\/mp4/);
  const durablePath = path.join(directory, 'media', '101', '4', videoId, 'video.mp4');
  assert.ok((await fs.stat(durablePath)).size > 0, 'durable video file persisted');

  // Isolation: another user sees nothing.
  assert.deepEqual((await request('/api/chat/history?chatId=1&limit=50', { id: 202 })).data.messages, []);

  // Restart: rows survive in a fresh process.
  closeProfileStore();
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const {ProfileStore}=require('./dist/services/profile/store.js'); const {listHistoryRows}=require('./dist/services/history/store.js'); const s=new ProfileStore(process.env.PROFILE_DB_PATH); const rows=listHistoryRows(s.getDb(),101,1,70); const hasImage=rows.some(r=>JSON.stringify(r.content).includes('image_url')); console.log(JSON.stringify({count:rows.length,hasImage})); s.close();`,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { count: 2, hasImage: true });

  // Durable video/audio store: save fake rows + files, read back, prune, clear.
  const dbChild = spawnSync(
    process.execPath,
    [
      '-e',
      `
const {ProfileStore}=require('./dist/services/profile/store.js');
const {saveMediaRow,getMediaRow,pruneOrphanMedia,clearMediaSlot,mediaFilePath}=require('./dist/services/media/store.js');
const fs=require('node:fs'); const path=require('node:path');
const s=new ProfileStore(process.env.PROFILE_DB_PATH);
const db=s.getDb();
saveMediaRow(db,{id:'vid-1',userId:101,slot:1,kind:'video',name:'clip.mp4',size:100,bytes:50,duration:5,hasAudio:true,waveform:[],poster:null});
const p=mediaFilePath(101,1,'vid-1','video.mp4'); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,Buffer.from('fake-video'));
const found=getMediaRow(db,101,'vid-1'); if(!found||found.name!=='clip.mp4') throw new Error('durable read failed');
// Orphan (no history ref to vid-1 in slot 1? slot 1 history has no video_ref) -> pruned.
pruneOrphanMedia(db,101,1);
if(getMediaRow(db,101,'vid-1')) throw new Error('orphan not pruned');
saveMediaRow(db,{id:'aud-1',userId:101,slot:4,kind:'audio',name:'Голосовое сообщение',size:10,bytes:5,duration:2,hasAudio:true,waveform:[1,2],poster:null});
clearMediaSlot(db,101,4);
if(getMediaRow(db,101,'aud-1')) throw new Error('clear slot failed');
console.log('MEDIA_STORE_OK');
s.close();
      `,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  );
  assert.equal(dbChild.status, 0, dbChild.stderr + dbChild.stdout);
  assert.match(dbChild.stdout, /MEDIA_STORE_OK/);

  console.log('media sync smoke OK — images/files inline cross-device, video/audio durable store + prune');
} finally {
  provider.closeAllConnections();
  server.closeAllConnections();
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => provider.close(resolve)),
  ]);
  closeProfileStore();
  await fs.rm(directory, { recursive: true, force: true });
}
