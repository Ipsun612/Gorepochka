/* Durable chat history: signed identity, real SQLite, restart persistence, isolation. */
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
const directory = await fs.mkdtemp(path.join(tempRoot, 'history-smoke-'));
const token = 'history-test-token-'.repeat(3);
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    void body;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'Привет<Разделить сообщение>Как дела' } }] }));
  });
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: token,
  OPENROUTER_API_KEY: 'test-key-'.repeat(8),
  OPENROUTER_MODEL: 'test/history',
  OPENROUTER_BASE_URL: `http://127.0.0.1:${provider.address().port}/api/v1`,
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
  MAX_HISTORY_MESSAGES: '35',
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
async function request(route, { id = 101, auth = true, method, body } = {}) {
  const response = await fetch(base + route, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      ...(auth ? { 'X-Telegram-Init-Data': signed(id) } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
}

try {
  assert.equal(config.MAX_HISTORY_MESSAGES, 35, 'history depth raised to 35 pairs');
  assert.equal((await request('/api/chat/history?chatId=1', { auth: false })).status, 401);
  assert.equal((await request('/api/chat/history?chatId=99')).status, 400);
  config.ALLOWED_USER_IDS = [202];
  assert.equal((await request('/api/chat/history?chatId=1')).status, 403);
  config.ALLOWED_USER_IDS = [];

  const empty = await request('/api/chat/history?chatId=1');
  assert.equal(empty.status, 200);
  assert.match(empty.headers.get('cache-control'), /no-store/);
  assert.deepEqual(empty.data.messages, []);

  const sent = await request('/api/chat', { body: { chatId: 1, message: 'Привет' } });
  assert.equal(sent.status, 200);
  assert.ok(typeof sent.data.userMessageId === 'string');
  assert.ok(typeof sent.data.assistantMessageId === 'string');

  const history = await request('/api/chat/history?chatId=1');
  assert.equal(history.status, 200);
  assert.equal(history.data.chatId, 1);
  assert.equal(history.data.messages.length, 2);
  assert.equal(history.data.messages[0].role, 'user');
  assert.equal(history.data.messages[0].text, 'Привет');
  assert.ok(history.data.messages[0].id);
  assert.ok(history.data.messages[0].createdAt);
  assert.equal(history.data.messages[1].role, 'bot');
  assert.ok(!JSON.stringify(history.data).includes('data:image'), 'no base64 bytes in history API');

  assert.equal((await request('/api/chat/history?chatId=1', { id: 202 })).data.messages.length, 0);

  closeProfileStore();
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const {ProfileStore}=require('./dist/services/profile/store.js'); const {listHistoryRows}=require('./dist/services/history/store.js'); const s=new ProfileStore(process.env.PROFILE_DB_PATH); const rows=listHistoryRows(s.getDb(),101,1,70); console.log(JSON.stringify(rows.length)); s.close();`,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()), 2, 'history survives in SQLite across processes');

  const cleared = await request('/api/new', { body: { chatId: 1 } });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await request('/api/chat/history?chatId=1')).data.messages, []);

  config.ANON_MODE = 'on';
  const anonHeaders = { 'X-Miniapp-Client-Id': 'web-history-12345678' };
  const anonChat = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { ...anonHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: 1, message: 'anon hi', clientId: 'web-history-12345678' }),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  assert.equal(anonChat.status, 200);
  const anonHistory = await fetch(`${base}/api/chat/history?chatId=1`, { headers: anonHeaders }).then(async (r) => ({
    status: r.status,
    data: await r.json().catch(() => null),
  }));
  assert.equal(anonHistory.data.messages.length, 2);
  console.log('history API smoke OK — durable SQLite history, 35-pair cap, isolation, restart, anon memory');
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
