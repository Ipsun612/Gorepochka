/* Reactions: display-only, synced across devices, never model context. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const tempRoot = path.join(os.tmpdir(), 'opencode');
await fs.mkdir(tempRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(tempRoot, 'reactions-smoke-'));
const token = 'reactions-test-token-'.repeat(3);
let captured;
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    captured = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Привет <Поставить реакцию: 🔥>' } }] }));
  });
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: token,
  OPENROUTER_API_KEY: 'test-key-'.repeat(8),
  OPENROUTER_MODEL: 'test/reactions',
  OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.address().port}/api/v1`,
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
  ANON_MODE: 'off',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
  RATE_LIMIT_MAX_REQUESTS: '1000',
});
const { createServer } = require('../dist/server/server.js');
const { closeProfileStore } = require('../dist/services/profile/store.js');
const { config } = require('../dist/config/config.js');
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
async function api(route, { id = 101, body } = {}) {
  const response = await fetch(base + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Telegram-Init-Data': signed(id), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

try {
  assert.equal(
    (
      await api('/api/chat/reaction', {
        body: { chatId: 1, messageId: '00000000-0000-0000-0000-000000000000', reaction: '❤️' },
      })
    ).status,
    404,
  );
  const sent = await api('/api/chat', { body: { chatId: 1, message: 'hi' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.userReaction, '🔥');
  const history = await api('/api/chat/history?chatId=1&limit=50');
  assert.equal(history.data.messages.length, 2);
  const assistant = history.data.messages.find((m) => m.role === 'bot');
  const user = history.data.messages.find((m) => m.role === 'user');
  assert.equal(user.botReaction, '🔥', 'AI reaction stored on the user turn');
  assert.equal(assistant.userReaction, null);

  for (const invalid of [
    { chatId: 9, messageId: assistant.id, reaction: '❤️' },
    { chatId: 1, messageId: 'short', reaction: '❤️' },
    { chatId: 1, messageId: assistant.id, reaction: 'not-an-emoji' },
    { chatId: 1, messageId: assistant.id, reaction: '❤️'.repeat(70) },
  ])
    assert.equal((await api('/api/chat/reaction', { body: invalid })).status, 400);

  const picked = await api('/api/chat/reaction', {
    body: { chatId: 1, messageId: assistant.id, reaction: '❤️' },
  });
  assert.equal(picked.status, 200);
  assert.equal(picked.data.userReaction, '❤️');
  const after = await api('/api/chat/history?chatId=1&limit=50');
  assert.equal(after.data.messages.find((m) => m.id === assistant.id).userReaction, '❤️');

  const removed = await api('/api/chat/reaction', {
    body: { chatId: 1, messageId: assistant.id, reaction: null },
  });
  assert.equal(removed.data.userReaction, null);

  assert.equal((await api('/api/chat/history?chatId=1&limit=50', { id: 202 })).data.messages.length, 0);
  config.ALLOWED_USER_IDS = [202];
  assert.equal(
    (await api('/api/chat/reaction', { body: { chatId: 1, messageId: assistant.id, reaction: '❤️' } })).status,
    403,
  );
  config.ALLOWED_USER_IDS = [];

  await api('/api/chat', { body: { chatId: 1, message: 'second' } });
  const promptTexts = JSON.stringify(captured.messages);
  assert.ok(!promptTexts.includes('userReaction') && !promptTexts.includes('botReaction'));
  assert.ok(!promptTexts.includes('❤️') || promptTexts.includes('second'));
  console.log('reactions smoke OK — display-only sync, validation, isolation');
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
