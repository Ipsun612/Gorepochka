/* Settings API: signed identity, real SQLite, isolation, conflicts and restart. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const tempRoot = path.join(os.tmpdir(), 'opencode');
await fs.mkdir(tempRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(tempRoot, 'settings-smoke-'));
const filename = path.join(directory, 'profiles.sqlite');
const token = 'settings-test-token-'.repeat(3);
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: token,
  OPENROUTER_API_KEY: 'test-key-'.repeat(8),
  PROFILE_DB_PATH: filename,
  MEDIA_DIR: path.join(directory, 'media'),
  ANON_MODE: 'off',
  WEBAPP_URL: '',
  ALLOWED_USER_IDS: '',
});
const Database = require('better-sqlite3');
const legacy = new Database(filename);
legacy.exec(`CREATE TABLE user_profiles (user_id TEXT PRIMARY KEY, biography TEXT NOT NULL, birthday TEXT,
  revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO user_profiles VALUES ('101', 'existing profile', NULL, 1, 'old', 'old');`);
legacy.close();
const { createServer } = require('../dist/server/server.js');
const { profileStore, closeProfileStore } = require('../dist/services/profile/store.js');
const { config } = require('../dist/config/config.js');
const server = createServer().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
function signed(id) {
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
async function request(id, body, headers = {}) {
  const response = await fetch(`${base}/api/settings`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(id ? { 'X-Telegram-Init-Data': signed(id) } : {}), 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

try {
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(null, null, { 'X-Telegram-Init-Data': 'forged' })).status, 401);
  config.ALLOWED_USER_IDS = [202];
  assert.equal((await request(101)).status, 403);
  config.ALLOWED_USER_IDS = [];
  const first = await request(101);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  assert.deepEqual(first.data.settings, { theme: 'light', revision: 0, updatedAt: null });
  assert.equal(profileStore().read(101).biography, 'existing profile', 'migration must preserve existing profiles');
  for (const invalid of [
    { theme: 'blue', revision: 0 },
    { theme: 'dark', revision: -1 },
    { theme: 'dark', revision: 0, userId: 202 },
    { theme: 'dark' },
  ])
    assert.equal((await request(101, invalid)).status, 400);
  const saved = await request(101, { theme: 'dark', revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.theme, 'dark');
  assert.equal(saved.data.settings.revision, 1);
  assert.equal((await request(202)).data.settings.theme, 'light', 'another user stays isolated');
  const conflict = await request(101, { theme: 'light', revision: 0 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'SETTINGS_CONFLICT');
  closeProfileStore();
  assert.equal((await request(101)).data.settings.theme, 'dark', 'saved theme survives reopening SQLite');
  const concurrent = await Promise.all([
    request(101, { theme: 'light', revision: 1 }),
    request(101, { theme: 'dark', revision: 1 }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
  config.ANON_MODE = 'on';
  const client = { 'X-Miniapp-Client-Id': 'web-test-12345678' };
  assert.equal((await request(null, null, client)).data.settings.theme, 'light');
  assert.equal((await request(null, { theme: 'dark', revision: 0 }, client)).status, 200);
  assert.equal((await request(null, null, client)).data.settings.theme, 'dark');
  assert.equal((await request(null, null, { 'X-Miniapp-Client-Id': 'web-other-123456' })).data.settings.theme, 'light');
  assert.equal(profileStore().readSettings(101).revision, 2);
  console.log('settings API smoke OK');
} finally {
  await new Promise((resolve) => server.close(resolve));
  closeProfileStore();
  await fs.rm(directory, { recursive: true, force: true });
}
