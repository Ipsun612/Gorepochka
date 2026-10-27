/* Chat tabs meta: signed identity, real SQLite, conflicts, restart, isolation. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const tempRoot = path.join(os.tmpdir(), 'opencode');
await fs.mkdir(tempRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(tempRoot, 'chats-smoke-'));
const token = 'chats-test-token-'.repeat(3);
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: token,
  OPENROUTER_API_KEY: 'test-key-'.repeat(8),
  PROFILE_DB_PATH: path.join(directory, 'profiles.sqlite'),
  MEDIA_DIR: path.join(directory, 'media'),
  ANON_MODE: 'off',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
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
async function request(id, method, body) {
  const response = await fetch(`${base}/api/chats`, {
    method,
    headers: { 'X-Telegram-Init-Data': signed(id), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
}

try {
  const unauth = await fetch(`${base}/api/chats`);
  assert.equal(unauth.status, 401);
  config.ALLOWED_USER_IDS = [202];
  assert.equal((await request(101, 'GET')).status, 403);
  config.ALLOWED_USER_IDS = [];

  const first = await request(101, 'GET');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  assert.deepEqual(first.data.chats.tabs, [{ slot: 1, name: 'Диалог 1' }]);
  assert.equal(first.data.chats.activeSlot, 1);
  assert.equal(first.data.chats.revision, 0);

  for (const invalid of [
    { tabs: [], activeSlot: 1, revision: 0 },
    { tabs: [{ slot: 9, name: 'x' }], activeSlot: 9, revision: 0 },
    { tabs: [{ slot: 1, name: '' }], activeSlot: 1, revision: 0 },
    { tabs: [{ slot: 1, name: 'a' }], activeSlot: 2, revision: 0 },
    {
      tabs: [
        { slot: 1, name: 'a' },
        { slot: 1, name: 'b' },
      ],
      activeSlot: 1,
      revision: 0,
    },
  ])
    assert.equal((await request(101, 'PUT', invalid)).status, 400);

  const saved = await request(101, 'PUT', {
    tabs: [
      { slot: 1, name: 'Работа' },
      { slot: 2, name: 'Личное' },
    ],
    activeSlot: 2,
    revision: 0,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.chats.revision, 1);
  assert.equal(saved.data.chats.activeSlot, 2);
  assert.equal((await request(202, 'GET')).data.chats.tabs.length, 1);

  assert.equal(
    (
      await request(101, 'PUT', {
        tabs: [{ slot: 1, name: 'stale' }],
        activeSlot: 1,
        revision: 0,
      })
    ).status,
    409,
  );

  closeProfileStore();
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const {ProfileStore}=require('./dist/services/profile/store.js'); const {readChatMetaRow}=require('./dist/services/chatMeta/store.js'); const s=new ProfileStore(process.env.PROFILE_DB_PATH); console.log(JSON.stringify(readChatMetaRow(s.getDb(),101))); s.close();`,
    ],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()).activeSlot, 2);

  const concurrent = await Promise.all([
    request(101, 'PUT', { tabs: [{ slot: 1, name: 'a' }], activeSlot: 1, revision: 1 }),
    request(101, 'PUT', { tabs: [{ slot: 1, name: 'b' }], activeSlot: 1, revision: 1 }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);

  config.ANON_MODE = 'on';
  const client = { 'X-Miniapp-Client-Id': 'web-chats-12345678' };
  const anonGet = await fetch(`${base}/api/chats`, { headers: client }).then(async (r) => ({
    status: r.status,
    data: await r.json().catch(() => null),
  }));
  assert.equal(anonGet.data.chats.tabs.length, 1);
  console.log('chat tabs smoke OK — cross-device names/active, conflicts, restart, isolation');
} finally {
  await new Promise((resolve) => server.close(resolve));
  closeProfileStore();
  await fs.rm(directory, { recursive: true, force: true });
}
