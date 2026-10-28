/* End-to-end smoke-test for files and tagged replies through the real HTTP server.
   Starts a stub OpenRouter + the compiled Express app (anon dev mode), posts a
   text file to /api/chat, and verifies the file content reaches the model
   prompt while non-text attachments are rejected. Also checks hidden tags,
   split timing, clean assistant history and independent slots. No external keys/services.
   Run: npm run build && node scripts/smoke-server-file.mjs */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- 1. Stub OpenRouter (captures the last request body) --------------------
let captured = null;
let providerReply = 'stub reply';
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/api/v1/chat/completions') {
      try {
        captured = JSON.parse(body);
      } catch {
        captured = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: providerReply } }] }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

// --- 2. Deterministic env, then load the compiled server --------------------
process.env.TELEGRAM_BOT_TOKEN = 'x'.repeat(40);
process.env.OPENROUTER_API_KEY = 'y'.repeat(40);
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${stubPort}/api/v1`;
process.env.OPENROUTER_MODEL = 'test/model';
process.env.ANON_MODE = 'on';
process.env.WEBAPP_URL = '';
process.env.MAX_FILE_BYTES = '65536';
process.env.FILE_MAX_CHARS = '5000';
process.env.RATE_LIMIT_MAX_REQUESTS = '50';
process.env.ALLOWED_USER_IDS = '';
process.env.AI_TYPING_CHARS_PER_SECOND = '20';
process.env.AI_TYPING_MIN_DELAY_MS = '800';
process.env.AI_TYPING_MAX_DELAY_MS = '8000';

const require = createRequire(import.meta.url);
const { createServer, miniAppChatKey } = require(path.join(here, '..', 'dist', 'server', 'server.js'));
const { getHistory } = require(path.join(here, '..', 'dist', 'services', 'session.js'));

const app = createServer();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const post = async (pathname, body) => {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Miniapp-Client-Id': clientId },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const fileDataUrl = (text) => `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
const clientId = 'web-abc123def456ghi789jkl012';

try {
  // A. Captionless text file is accepted and injected into the model prompt.
  const ok = await post('/api/chat', {
    chatId: 1,
    message: '',
    fileName: 'Unit.cs',
    file: fileDataUrl('class Unit {}'),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.reply, 'stub reply');
  assert.deepEqual(ok.json.messages, [{ text: 'stub reply', delayMs: 0 }]);
  assert.equal(ok.json.hasFile, true);
  assert.equal(ok.json.hasImage, false);

  const lastHuman = () => (captured?.messages ?? []).filter((m) => m.role === 'user').pop();

  const human = lastHuman();
  assert.ok(human, 'a user message reached the provider');
  const text = typeof human.content === 'string' ? human.content : JSON.stringify(human.content);
  assert.match(text, /\[Attached file: Unit\.cs\]/);
  assert.match(text, /class Unit \{\}/);

  // B. A message + a file are both present.
  const ok2 = await post('/api/chat', {
    chatId: 1,
    message: 'review this',
    fileName: 'notes.md',
    file: fileDataUrl('# Title'),
  });
  assert.equal(ok2.status, 200, JSON.stringify(ok2.json));
  const human2 = lastHuman();
  assert.match(human2.content, /review this/);
  assert.match(human2.content, /# Title/);

  // C. An image data URL sent as a "file" is rejected (not text).
  const bad = await post('/api/chat', {
    chatId: 1,
    fileName: 'x.png',
    file: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /text files/i);

  // D. Raw tags never reach the API or assistant history; delays depend on NEXT part.
  const split = '<Разделить сообщение>';
  const nextText = 'я'.repeat(40);
  providerReply = `${split} привет <Неизвестный тег> ${split} ${split} ${nextText} ${split} пока <Поставить реакцию: [❤️]> ${split}`;
  const tagged = await post('/api/chat', { chatId: 1, message: 'ответь по частям' });
  assert.equal(tagged.status, 200, JSON.stringify(tagged.json));
  assert.deepEqual(tagged.json.messages, [
    { text: 'привет', delayMs: 0 },
    { text: nextText, delayMs: 2000 },
    { text: 'пока', delayMs: 800 },
  ]);
  assert.equal(tagged.json.reply, `привет\n\n${nextText}\n\nпока`);
  assert.equal(tagged.json.userReaction, '❤️');
  assert.ok(!JSON.stringify(tagged.json).includes('<'));

  providerReply = 'продолжение';
  const followup = await post('/api/chat', { chatId: 1, message: 'продолжи' });
  assert.equal(followup.status, 200);
  const previousAssistant = captured.messages.filter((m) => m.role === 'assistant').pop();
  assert.equal(previousAssistant.content, tagged.json.reply, 'all parts kept as one clean assistant turn');
  assert.ok(captured.messages.filter((m) => m.role === 'assistant').every((m) => !m.content.includes('<')));
  assert.ok(
    !JSON.stringify(captured.messages.filter((m) => m.role === 'assistant')).includes('❤️'),
    'reaction metadata is not model history',
  );

  // E. Other slots are independent; tags in USER input are never interpreted/hidden.
  const userWithTag = `покажи ${split} <Поставить реакцию: 🔥> как текст`;
  const other = await post('/api/chat', { chatId: 2, message: userWithTag });
  assert.equal(other.status, 200);
  assert.equal(captured.messages.filter((m) => m.role === 'assistant').length, 0);
  assert.equal(lastHuman().content, userWithTag);
  assert.equal(other.json.userReaction, null, 'user-authored commands cannot add reactions');

  // F. A tag-only answer produces a safe error, not an empty chat bubble/history turn.
  const assistantHistory = () =>
    getHistory(miniAppChatKey(`anon:${clientId}`, 2)).filter((m) => m.role === 'assistant');
  const assistantCount = assistantHistory().length;
  providerReply = `${split}<Неизвестный тег><>`;
  const empty = await post('/api/chat', { chatId: 2, message: 'ещё' });
  assert.equal(empty.status, 502);
  assert.match(empty.json.error, /empty response/i);
  assert.ok(!JSON.stringify(empty.json).includes('<'));
  assert.equal(assistantHistory().length, assistantCount, 'no empty assistant turn is stored');

  console.log('SMOKE OK — /api/chat files, tag-free replies/history, split timing + slot isolation.');
} finally {
  await new Promise((r) => server.close(r));
  await new Promise((r) => stub.close(r));
}
