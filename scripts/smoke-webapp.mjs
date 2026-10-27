/* Smoke-test for the bundler-free webapp ES modules.
   Stubs browser globals (document/window/localStorage/fetch), imports the full
   module graph via main.js, boots the app, and exercises core actions.
   Run: node scripts/smoke-webapp.mjs */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'webapp', 'app');
const importApp = (file) => import(pathToFileURL(path.join(appDir, file)).href);
const { CHARACTER, TRAITS, TRAIT_GROUPS, defaultTraits } = await import(
  pathToFileURL(path.join(here, '..', 'dist', 'services', 'character', 'definition.js')).href
);

// --- browser stubs ---------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

function makeEl(tag) {
  let html = '';
  let text = '';
  const matches = (el, selector) =>
    selector.startsWith('.')
      ? el.className.split(/\s+/).includes(selector.slice(1))
      : el.tagName.toLowerCase() === selector.toLowerCase();
  const el = {
    events: new Map(),
    attrs: {},
    tagName: String(tag).toUpperCase(),
    style: {
      setProperty(key, value) {
        this[key] = value;
      },
    },
    children: [],
    parent: null,
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = value;
      text = '';
      el.children = [];
    },
    get textContent() {
      return (
        text +
        html
          .replace(/<br>/g, '\n')
          .replace(/<[^>]*>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&') +
        el.children.map((child) => child.textContent).join('')
      );
    },
    set textContent(value) {
      text = String(value);
      html = '';
      el.children = [];
    },
    get innerText() {
      return el.textContent;
    },
    value: '',
    paused: true,
    currentTime: 0,
    duration: NaN,
    pause() {
      this.paused = true;
      this.onpause?.();
    },
    async play() {
      this.paused = false;
      this.onplay?.();
    },
    load() {},
    className: '',
    title: '',
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 600,
    getBoundingClientRect() {
      return { left: 0, right: 600, top: 100, bottom: 700, width: 600, height: 56 };
    },
    classList: {
      add(...names) {
        for (const name of names) if (!this.contains(name)) el.className = `${el.className} ${name}`.trim();
      },
      remove(...names) {
        el.className = el.className
          .split(/\s+/)
          .filter((n) => !names.includes(n))
          .join(' ');
      },
      contains(name) {
        return el.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        const enabled = force === undefined ? !this.contains(name) : force;
        if (enabled) this.add(name);
        else this.remove(name);
      },
    },
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in el.attrs ? el.attrs[k] : null;
    },
    removeAttribute(k) {
      delete el.attrs[k];
    },
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    insertBefore(child, reference) {
      if (!reference) return el.appendChild(child);
      child.parent = el;
      el.children.splice(el.children.indexOf(reference), 0, child);
      return child;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return el.children.flatMap((child) => [
        ...(matches(child, selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    },
    addEventListener(type, handler) {
      if (!el.events.has(type)) el.events.set(type, []);
      el.events.get(type).push(handler);
    },
    dispatch(type, values = {}) {
      const event = { target: el, preventDefault() {}, stopPropagation() {}, ...values };
      for (const handler of el.events.get(type) || []) handler(event);
    },
    removeEventListener() {},
    focus() {
      globalThis.document.activeElement = el;
    },
    blur() {},
    select() {},
    contains(child) {
      return child === el || el.children.some((node) => node.contains(child));
    },
    closest(selector) {
      return matches(el, selector) ? el : el.parent?.closest(selector) || null;
    },
    remove() {
      if (el.parent) el.parent.children = el.parent.children.filter((child) => child !== el);
    },
  };
  return el;
}

const els = new Map();
const html = await readFile(path.join(appDir, '..', 'index.html'), 'utf8');
for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  assert.ok(!els.has(match[3]), `duplicate DOM id: ${match[3]}`);
  const el = makeEl(match[1]);
  el.className = match[2].match(/class="([^"]*)"/)?.[1] || '';
  els.set(match[3], el);
}
const documentEvents = new Map();
globalThis.document = {
  getElementById: (id) => els.get(id) || null,
  documentElement: makeEl('html'),
  activeElement: null,
  createElement: (tag) => makeEl(tag),
  addEventListener(type, handler) {
    if (!documentEvents.has(type)) documentEvents.set(type, []);
    documentEvents.get(type).push(handler);
  },
};
const keydown = (key, target, extra = {}) => {
  for (const handler of documentEvents.get('keydown') || []) handler({ key, target, preventDefault() {}, ...extra });
};

globalThis.window = globalThis; // window.Telegram stays undefined -> anon dev mode path
globalThis.addEventListener = () => {};
globalThis.innerHeight = 800;

const fetchLog = [];
let chatResponse = { ok: true, reply: 'Hello!', model: 'test-model' };
let clearFailure = false;
let savedProfile = {
  displayName: 'Тестовый пользователь',
  username: 'test_user',
  avatarUrl: null,
  avatarVersion: null,
  biography: '',
  birthday: null,
  revision: 0,
  updatedAt: null,
  verified: true,
  sync: { state: 'synced', syncedAt: null },
};
let profileFailure = false;
let profileConflict = false;
let savedCharacter = { traits: defaultTraits(), revision: 0, updatedAt: null, verified: true };
let characterFailure = false;
let characterConflict = false;
const primaryLorebook = JSON.parse(
  await readFile(path.join(here, '..', 'lorebooks', 'gorepochka.json'), 'utf8'),
).entries;
// Synthetic display title; never rewrite the developer's book.
Object.values(primaryLorebook)[0].comment = '<Название записи>';
let savedLorebook = { entries: [], revision: 0, updatedAt: null, verified: true };
let lorebookFailure = false;
let lorebookConflict = false;
globalThis.fetch = async (url, opts) => {
  const pathn = url.startsWith('http') ? new URL(url).pathname : url;
  fetchLog.push({ path: pathn, body: opts && opts.body ? JSON.parse(opts.body) : null });
  if (pathn === '/api/new' && clearFailure)
    return { ok: false, status: 503, json: async () => ({ error: 'Test server unavailable' }) };
  if (pathn === '/api/lorebook') {
    if (lorebookFailure) return { ok: false, status: 503, json: async () => ({ error: 'Лорбук недоступен' }) };
    const body = opts?.body ? JSON.parse(opts.body) : null;
    if (body) {
      if (lorebookConflict)
        return {
          ok: false,
          status: 409,
          json: async () => ({ code: 'LOREBOOK_CONFLICT', error: 'Изменён на другом устройстве' }),
        };
      savedLorebook = { ...savedLorebook, entries: body.entries, revision: savedLorebook.revision + 1 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        primary: primaryLorebook,
        profile: structuredClone(savedLorebook),
        limits: { entries: 3, commentChars: 40, contentChars: 300, keywords: 10, keywordChars: 60 },
      }),
    };
  }
  if (pathn === '/api/character-profile') {
    if (characterFailure) return { ok: false, status: 503, json: async () => ({ error: 'Характер недоступен' }) };
    const body = opts?.body ? JSON.parse(opts.body) : null;
    if (body) {
      if (characterConflict)
        return {
          ok: false,
          status: 409,
          json: async () => ({ code: 'CHARACTER_CONFLICT', error: 'Изменён на другом устройстве' }),
        };
      savedCharacter = { ...savedCharacter, traits: body.traits, revision: savedCharacter.revision + 1 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        character: CHARACTER,
        profile: structuredClone(savedCharacter),
        groups: TRAIT_GROUPS,
        traits: TRAITS.map(({ guidance, ...trait }) => trait),
        defaults: defaultTraits(),
      }),
    };
  }
  if (pathn === '/api/profile' || pathn === '/api/profile/sync') {
    if (profileFailure) return { ok: false, status: 503, json: async () => ({ error: 'Профиль недоступен' }) };
    const body = opts?.body ? JSON.parse(opts.body) : null;
    if (pathn === '/api/profile' && body) {
      if (profileConflict)
        return {
          ok: false,
          status: 409,
          json: async () => ({ code: 'PROFILE_CONFLICT', error: 'Изменён на другом устройстве' }),
        };
      savedProfile = {
        ...savedProfile,
        ...body,
        biography: body.biography.trim(),
        revision: savedProfile.revision + 1,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        profile: structuredClone(savedProfile),
        limits: { biographyMaxChars: 2000, birthdayMinYear: 1900, birthdayMaxYear: new Date().getUTCFullYear() },
      }),
    };
  }
  const bodies = {
    '/api/meta': { ok: true, model: 'test-model', bot: { name: 'TestBot' } },
    '/api/prompts': { ok: true, files: ['base.txt'] },
    '/api/chat': chatResponse,
    '/api/new': { ok: true },
  };
  if (pathn === '/api/videos/12345678-1234-1234-1234-123456789abc') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        video: {
          id: '12345678-1234-1234-1234-123456789abc',
          state: 'ready',
          name: 'holiday.mkv',
          size: 500,
          duration: 3,
          hasAudio: true,
          poster: 'data:image/jpeg;base64,YQ==',
        },
      }),
    };
  }
  const body = bodies[pathn];
  if (body) return { ok: true, status: 200, json: async () => body };
  return { ok: false, status: 404, json: async () => null };
};

// Preload a legacy (pre-multi-chat) flat history so boot's one-time migration
// can be observed moving it into slot #c1. Also there, sendMessage persists
// the per-slot display cache under the SAME slot key format.
store.set(
  'miniapp-ui-history-v1',
  JSON.stringify([
    { role: 'user', text: 'пользователь <Разделить сообщение>' },
    { role: 'bot', text: 'старый <Скрытый тег>ответ<Разделить сообщение> тут' },
    { role: 'bot', text: '<Скрытый тег>' },
  ]),
);

// --- import the whole module graph (main.js boots on import) ---------------
await importApp('main.js');
await new Promise((r) => setTimeout(r, 0));

const state = (await importApp('core/state.js')).state;
const chatActions = await importApp('chat/chatActions.js');

// --- assertions ------------------------------------------------------------
// 1. User profile loads independently of metadata; neither overrides the persona.
assert.deepEqual(
  fetchLog.map((c) => c.path),
  ['/api/meta', '/api/profile'],
);
assert.equal(els.get('botTitle').textContent, 'Горепочка');
assert.equal(els.get('botAvatar').textContent, 'Г');
assert.match(html, /<html lang="ru">/);
assert.match(html, /GorCOgramm — Горепочка/);
assert.ok(!html.includes('modelPill') && !html.includes('bg-blobs'));
assert.equal(document.documentElement.style['--app-height'], '800px');

// 2. Default chat created + metadata persisted with the SAME storage keys.
const meta = JSON.parse(store.get('miniapp-chats-v1'));
assert.equal(meta.chats.length, 1);
assert.equal(meta.chats[0].id, 1);
assert.equal(meta.chats[0].name, 'Диалог 1');
assert.equal(meta.activeId, 1);

// 2b. Re-reading persisted chat metadata must not throw. Regression guard for
// the second (and every later) Mini App open: loadChatMeta takes the
// `data.chats` branch and references MAX_CHATS, which must be imported in
// chatState.js — an empty-store boot never exercises that branch.
const chatState = await importApp('chat/chatState.js');
assert.doesNotThrow(() => chatState.loadChatMeta(), 'loadChatMeta must work with saved chats');

// 3. Old-history migration moved the legacy flat history into slot #c1.
assert.ok(store.has('miniapp-ui-history-v1#c1'), 'legacy history migrated to slot 1');
assert.ok(!store.has('miniapp-ui-history-v1'), 'legacy flat key removed');
const migrated = JSON.parse(store.get('miniapp-ui-history-v1#c1'));
assert.deepEqual(
  migrated,
  [
    { role: 'user', text: 'пользователь <Разделить сообщение>' },
    { role: 'bot', text: 'старый ответ тут' },
  ],
  'restored bot tags are hidden and cache cleaned; user text is untouched',
);

// 4. Sending a message: client id persisted (anon dev mode) + per-slot cache saved.
chatActions.sendMessage('Hi there');
for (let i = 0; i < 10 && state.sending; i++) await new Promise((r) => setTimeout(r, 20));
assert.equal(state.sending, false, 'sending flag must reset after the reply');
assert.ok(store.has('miniapp-ui-history-v1#c1'), 'per-slot history key saved');
assert.equal(els.get('input').value, '', 'input cleared after send');
assert.match(store.get('miniapp-client-v1'), /^web-[a-z0-9]{36}$/, 'client id key set on first chat request');
assert.equal(fetchLog.find((c) => c.path === '/api/chat').body.chatId, 1, 'chat request targets the active slot');
assert.equal(
  fetchLog.find((c) => c.path === '/api/chat').body.initData,
  undefined,
  'anonymous dev requests omit empty initData instead of being rejected as forged credentials',
);
chatActions.sendMessage('Hi there');
for (let i = 0; i < 10 && state.sending; i++) await new Promise((r) => setTimeout(r, 20));
assert.equal(state.sending, false, 'sending flag must reset after the reply');
assert.ok(store.has('miniapp-ui-history-v1#c1'), 'per-slot history key saved');
assert.equal(els.get('input').value, '', 'input cleared after send');

// 5. Rename via the shared modal.
chatActions.openRenameModal();
els.get('modalInput').value = 'Pink chat';
await chatActions.applyModal();
assert.equal(state.chats[0].name, 'Pink chat');

// 6. Create a second chat, switch to it, clear its history.
await chatActions.createChat();
assert.equal(state.chats.length, 2);
assert.equal(state.activeId, 2);
await chatActions.newChat();
assert.ok(!store.has('miniapp-ui-history-v1#c2'), 'cleared chat slot removed from cache');

// 7. Text-file attachment: type detection, staging and upload payload.
const textfile = await importApp('media/textfile.js');
assert.equal(textfile.isTextFile({ name: 'notes.md', type: '' }), true, 'md is a text file');
assert.equal(textfile.isTextFile({ name: 'data.json', type: 'application/json' }), true, 'json is a text file');
assert.equal(textfile.isTextFile({ name: 'Program.cs', type: '' }), true, 'cs is a text file');
assert.equal(textfile.isTextFile({ name: 'README', type: 'text/plain' }), true, 'text mime is a text file');
assert.equal(textfile.isTextFile({ name: 'photo.png', type: 'image/png' }), false, 'png is not a text file');
assert.equal(
  textfile.isTextFile({ name: 'app.bin', type: 'application/octet-stream' }),
  false,
  'binary is not a text file',
);

const fileBytes = new TextEncoder().encode('hello from a text file');
const fakeFile = {
  name: 'notes.md',
  type: 'text/markdown',
  size: fileBytes.length,
  arrayBuffer: async () => fileBytes.buffer,
};
await chatActions.attachTextFile(fakeFile);
assert.ok(state.pendingFile, 'text file staged');
assert.equal(state.pendingFile.name, 'notes.md');
assert.match(state.pendingFile.dataUrl, /^data:text\/plain;base64,/, 'file staged as a base64 text data URL');

chatActions.sendMessage('summarize this file');
for (let i = 0; i < 10 && state.sending; i++) await new Promise((r) => setTimeout(r, 20));
assert.equal(state.sending, false, 'sending flag resets after a file turn');
assert.equal(state.pendingFile, null, 'staged file cleared after send');
const fileReq = fetchLog.filter((c) => c.path === '/api/chat').pop();
assert.equal(fileReq.body.fileName, 'notes.md', 'file name sent with the chat request');
assert.match(fileReq.body.file, /^data:text\/plain;base64,/, 'file data URL sent with the chat request');

// 8. Real send flow: separate bubbles, sending lock + typing stay until the LAST part.
const originalSetTimeout = globalThis.setTimeout;
const waits = [];
let release;
globalThis.setTimeout = (callback, ms, ...args) => {
  if (ms === 1234 || ms === 2345) {
    waits.push(ms);
    release = callback;
    return null;
  }
  return originalSetTimeout(callback, ms, ...args);
};
try {
  chatResponse = {
    ok: true,
    model: 'test-model',
    reply: 'unused fallback',
    userReaction: '👏',
    messages: [
      { text: 'первое<Скрытый тег>', delayMs: 0 },
      { text: 'второе', delayMs: 1234 },
      { text: 'третье', delayMs: 2345 },
    ],
  };
  const botTexts = () =>
    els
      .get('chat')
      .querySelectorAll('.bot')
      .map((n) => n.querySelector('.bubble-text').innerText);
  const botCount = botTexts().length;
  chatActions.sendMessage('ответь по частям');
  for (let i = 0; i < 10 && waits.length === 0; i++) await Promise.resolve();
  assert.deepEqual(waits, [1234]);
  assert.deepEqual(botTexts().slice(botCount), ['первое']);
  assert.equal(state.sending, true);
  assert.equal(els.get('sendBtn').disabled, true);
  assert.equal(els.get('typing').classList.contains('hidden'), false);
  chatActions.switchChat(1);
  assert.equal(state.activeId, 2, 'cannot switch slots during delayed delivery');
  const requestsBefore = fetchLog.length;
  chatActions.sendMessage('duplicate');
  assert.equal(fetchLog.length, requestsBefore, 'cannot interleave another turn');
  release();
  for (let i = 0; i < 10 && waits.length === 1; i++) await Promise.resolve();
  assert.deepEqual(botTexts().slice(botCount), ['первое', 'второе']);
  assert.deepEqual(waits, [1234, 2345]);
  assert.equal(state.sending, true);
  release();
  for (let i = 0; i < 10 && state.sending; i++) await Promise.resolve();
  assert.deepEqual(botTexts().slice(botCount), ['первое', 'второе', 'третье']);
  assert.equal(state.sending, false);
  assert.equal(els.get('sendBtn').disabled, false);
  assert.equal(els.get('typing').classList.contains('hidden'), true);
  const saved = JSON.parse(store.get('miniapp-ui-history-v1#c2'));
  assert.deepEqual(
    saved
      .filter((m) => m.role === 'bot')
      .slice(-3)
      .map((m) => m.text),
    ['первое', 'второе', 'третье'],
  );
  assert.ok(saved.filter((m) => m.role === 'bot').every((m) => !m.text.includes('<')));
  assert.equal(saved.filter((m) => m.role === 'user').at(-1).botReaction, '👏');
  assert.ok(
    saved.filter((m) => m.role === 'bot').every((m) => !m.botReaction),
    'AI never reacts to her own bubbles',
  );

  const render = await importApp('chat/render.js');
  render.clearChatDom();
  render.restore(2);
  assert.deepEqual(botTexts().slice(-3), ['первое', 'второе', 'третье'], 'separate messages survive reload');
} finally {
  globalThis.setTimeout = originalSetTimeout;
}

// 8b. Reactions: bot-only picker, toggle/replace, keyboard, cache validation and isolation.
const reactions = await importApp('reactions/reactions.js');
const reactionPanel = els.get('reactionPicker');
const reactionButtons = reactionPanel.querySelectorAll('button');
assert.deepEqual(
  reactionButtons.map((button) => button.textContent),
  reactions.COMMON_REACTIONS,
);
assert.equal(reactionButtons.length, 10);
let reactUser = els.get('chat').querySelectorAll('.user').at(-1);
let reactBot = els.get('chat').querySelectorAll('.bot').at(-1);
assert.equal(reactUser.getAttribute('data-reaction'), '👏', 'AI reaction restored on the triggering user bubble');
reactions.openReactionPicker(reactUser);
assert.equal(reactionPanel.classList.contains('hidden'), true);
els.get('chat').dispatch('click', { target: reactBot.querySelector('.bubble-text') });
assert.equal(reactionPanel.classList.contains('hidden'), false);
assert.equal(document.activeElement, reactionButtons[0]);
reactionPanel.dispatch('keydown', { key: 'End' });
assert.equal(document.activeElement, reactionButtons[9]);
reactionButtons[0].dispatch('click');
assert.equal(reactBot.getAttribute('data-reaction'), '❤️');
assert.equal(reactionPanel.classList.contains('hidden'), true);
assert.equal(document.activeElement, reactBot.querySelector('.bubble'));
reactions.openReactionPicker(reactBot);
assert.equal(reactionButtons[0].getAttribute('aria-pressed'), 'true');
reactionButtons[0].dispatch('click');
assert.equal(reactBot.getAttribute('data-reaction'), null, 'same emoji toggles off');
reactions.openReactionPicker(reactBot);
reactionButtons[1].dispatch('click');
reactions.openReactionPicker(reactBot);
reactionButtons[3].dispatch('click');
assert.equal(reactBot.getAttribute('data-reaction'), '🔥', 'different emoji replaces the previous one');
assert.equal(reactBot.querySelectorAll('.reaction-pill').length, 1);
const reactionRenderer = await importApp('chat/render.js');
reactionRenderer.clearChatDom();
reactionRenderer.restore(2);
reactBot = els.get('chat').querySelectorAll('.bot').at(-1);
assert.equal(reactBot.getAttribute('data-reaction'), '🔥');
reactions.openReactionPicker(reactBot);
reactionPanel.dispatch('keydown', { key: 'Escape' });
assert.equal(reactionPanel.classList.contains('hidden'), true);
reactions.openReactionPicker(reactBot);
els.get('chat').dispatch('scroll');
assert.equal(reactionPanel.classList.contains('hidden'), true);
const link = makeEl('a');
reactBot.querySelector('.bubble').appendChild(link);
els.get('chat').dispatch('click', { target: link });
assert.equal(reactionPanel.classList.contains('hidden'), true, 'links keep their own gestures');
link.remove();
state.profileOpen = true;
reactions.openReactionPicker(reactBot);
assert.equal(reactionPanel.classList.contains('hidden'), true);
state.profileOpen = false;
const liveId = state.activeId;
state.activeId = 6;
reactions.openReactionPicker(reactBot);
assert.equal(reactionPanel.classList.contains('hidden'), true, 'archived messages are read-only');
state.activeId = liveId;
reactions.setMessageReaction(reactBot, '<img src=x>');
assert.equal(reactBot.getAttribute('data-reaction'), null, 'malicious API/cache reaction is rejected');
reactions.setMessageReaction(reactBot, '🔥');
(await importApp('chat/chatState.js')).persist();
chatActions.switchChat(1);
assert.ok(
  els
    .get('chat')
    .querySelectorAll('.msg')
    .every((wrap) => !wrap.getAttribute('data-reaction')),
  'slot reactions do not leak',
);
chatActions.switchChat(2);
assert.equal(els.get('chat').querySelectorAll('.bot').at(-1).getAttribute('data-reaction'), '🔥');

// 9. Binary video transport: original File, no base64 JSON, optional preview.
const videoHelpers = await importApp('video/video.js');
assert.equal(videoHelpers.isVideoFile({ name: 'clip.MKV', type: '' }), true);
assert.equal(videoHelpers.isVideoFile({ name: 'unknown', type: 'video/quicktime' }), true);
assert.equal(videoHelpers.isVideoFile({ name: 'program.ts', type: '' }), false);
assert.equal(videoHelpers.durationLabel(65), '1:05');
let uploadedForm;
globalThis.XMLHttpRequest = class {
  upload = {};
  headers = {};
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key, value) {
    this.headers[key] = value;
  }
  send(form) {
    uploadedForm = form;
    assert.equal(this.method, 'POST');
    assert.match(this.url, /^\/api\/videos\?chatId=2$/);
    assert.ok(this.headers['X-Miniapp-Client-Id']);
    assert.equal(this.headers['Content-Type'], undefined, 'browser supplies the multipart boundary');
    this.upload.onprogress({ lengthComputable: true, loaded: 250, total: 500 });
    this.status = 202;
    this.responseText = JSON.stringify({ ok: true, video: { id: '12345678-1234-1234-1234-123456789abc' } });
    this.onload();
  }
  abort() {
    this.onabort();
  }
};
const movie = new File([new Uint8Array(500)], 'holiday.mkv', { type: 'application/octet-stream' });
chatActions.attachVideoFile(movie);
assert.equal(state.pendingVideo.file, movie, 'raw File staged without base64 encoding');
els.get('videoPlayer').onerror();
assert.ok(state.pendingVideo, 'browser decode failure must not reject a video');
const progress = [];
await videoHelpers.uploadVideo(movie, 2, new AbortController().signal, (value) => progress.push(value));
assert.deepEqual(progress, [50]);
assert.equal(uploadedForm.get('video').name, 'holiday.mkv');

chatResponse = {
  ok: true,
  jobId: 'test-job',
  state: 'complete',
  result: {
    model: 'test-video-model',
    userReaction: '😮',
    messages: [{ text: 'A video with sound', delayMs: 0 }],
  },
};
chatActions.sendMessage('Describe this clip');
for (let i = 0; i < 50 && state.sending; i++) await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(state.sending, false);
assert.equal(state.pendingVideo, null);
const videoRequest = fetchLog.filter((request) => request.path === '/api/chat').at(-1);
assert.equal(videoRequest.body.videoId, '12345678-1234-1234-1234-123456789abc');
assert.ok(videoRequest.body.requestId);
assert.equal(videoRequest.body.video, undefined, 'raw video never enters JSON payload');
let cachedVideos = JSON.parse(store.get('miniapp-ui-history-v1#c2')).filter((message) => message.video);
assert.equal(cachedVideos.length, 1);
assert.equal(cachedVideos[0].video.name, 'holiday.mkv');
assert.equal(cachedVideos[0].botReaction, '😮', 'job result reaction attaches to the original video bubble');
assert.equal(cachedVideos[0].video.file, undefined);
assert.equal(cachedVideos[0].video.url, undefined, 'object URLs are never persisted');
const renderer = await importApp('chat/render.js');
renderer.clearChatDom();
renderer.restore(2);
assert.equal(els.get('chat').querySelectorAll('.bubble-video').length, 1, 'video descriptors survive reload');
assert.equal(
  els.get('chat').querySelectorAll('.video-poster').length,
  1,
  'prepared video thumbnails stay visible before private playback',
);
state.maxVideoBytes = 100;
const tooLarge = new File([new Uint8Array(101)], 'huge.mp4');
chatActions.attachVideoFile(tooLarge);
assert.equal(state.pendingVideo, null, 'oversized videos rejected before upload');
await chatActions.attachPickedFile(new File(['let x = 1;'], 'source.ts'));
assert.ok(state.pendingFile, 'TypeScript stays a text attachment');
chatActions.clearAttachments();

// 10. Real timestamps survive reload; legacy messages never receive invented dates.
const historyBefore = JSON.parse(store.get('miniapp-ui-history-v1#c2'));
assert.ok(historyBefore.every((message) => Number.isFinite(Date.parse(message.createdAt))));
const timestampsBefore = els
  .get('chat')
  .querySelectorAll('.meta')
  .map((node) => node.textContent);
renderer.clearChatDom();
renderer.restore(2);
assert.deepEqual(
  els
    .get('chat')
    .querySelectorAll('.meta')
    .map((node) => node.textContent),
  timestampsBefore,
);
store.set(
  'miniapp-ui-history-v1#c2',
  JSON.stringify([
    { role: 'user', text: 'без даты' },
    { role: 'bot', text: 'старая дата', createdAt: 'invalid' },
    { role: 'user', text: 'вчера', createdAt: '2025-02-16T12:00:00.000Z' },
    { role: 'bot', text: 'в тот же день', createdAt: '2025-02-16T12:01:00.000Z' },
    { role: 'user', text: 'ещё один день', createdAt: '2025-02-17T12:00:00.000Z' },
  ]),
);
renderer.clearChatDom();
renderer.restore(2);
assert.equal(els.get('chat').querySelectorAll('.meta').length, 3);
assert.equal(els.get('chat').querySelectorAll('.date-separator').length, 2);
assert.equal(JSON.parse(store.get('miniapp-ui-history-v1#c2'))[0].createdAt, undefined);
assert.equal(JSON.parse(store.get('miniapp-ui-history-v1#c2'))[1].createdAt, undefined);

// 11. A reader is not pulled away from older messages. Latest is a real action.
const chatEl = els.get('chat');
chatEl.scrollHeight = 2000;
chatEl.scrollTop = 100;
renderer.addMsg('bot', 'новое сообщение');
assert.equal(chatEl.scrollTop, 100);
assert.equal(els.get('latestBtn').classList.contains('hidden'), false);
els.get('latestBtn').dispatch('click');
assert.equal(chatEl.scrollTop, 2000);
assert.equal(els.get('latestBtn').classList.contains('hidden'), true);
chatEl.scrollHeight = 0;
chatEl.scrollTop = 0;

// 12. Keyboard menu navigation, modal focus trap, Escape and confirmations.
els.get('chatMenuBtn').dispatch('click');
assert.equal(els.get('chatMenuBtn').getAttribute('aria-expanded'), 'true');
assert.equal(document.activeElement, els.get('menuRenameBtn'));
keydown('ArrowDown', document.activeElement);
assert.equal(document.activeElement, els.get('newChatBtn'));
keydown('Escape', document.activeElement);
assert.equal(document.activeElement, els.get('chatMenuBtn'));
assert.equal(els.get('chatMenuBtn').getAttribute('aria-expanded'), 'false');
chatActions.openRenameModal();
assert.equal(document.activeElement, els.get('modalInput'));
keydown('Tab', document.activeElement, { shiftKey: true });
assert.equal(document.activeElement, els.get('modalOk'));
keydown('Escape', document.activeElement);
assert.equal(document.activeElement, els.get('chatMenuBtn'));
const beforeConfirm = fetchLog.length;
els.get('newChatBtn').dispatch('click');
assert.equal(state.modalMode, 'clear');
assert.equal(fetchLog.length, beforeConfirm, 'opening a confirmation must not clear anything');
els.get('modalCancel').dispatch('click');
assert.equal(fetchLog.length, beforeConfirm, 'cancelling a confirmation preserves history');
els.get('modelBtn').dispatch('click');
assert.equal(state.modalMode, 'info');
assert.match(els.get('modalDescription').textContent, /test-video-model/);
await chatActions.applyModal();
chatActions.openClearModal();
await chatActions.applyModal();
assert.equal(state.modalMode, null);
assert.equal(chatEl.querySelectorAll('.msg').length, 0);
assert.equal(chatEl.querySelectorAll('.date-separator').length, 0);

// 13. Never release a slot when server cleanup fails. Reuse is bounded to 1..5.
renderer.addMsg('user', 'сохранить при ошибке');
const protectedCache = store.get('miniapp-ui-history-v1#c2');
clearFailure = true;
chatActions.openDeleteModal();
await chatActions.applyModal();
assert.equal(state.activeId, 2);
assert.equal(state.chats.length, 2);
assert.equal(store.get('miniapp-ui-history-v1#c2'), protectedCache);
chatActions.closeModal();
await chatActions.createChat();
assert.equal(state.chats.length, 2, 'failed preparation cannot create a local-only chat');
clearFailure = false;
for (let i = 0; i < 8; i++) {
  chatActions.openDeleteModal();
  await chatActions.applyModal();
  assert.equal(state.activeId, 1);
  assert.equal(store.has('miniapp-ui-history-v1#c2'), false, 'deleted DOM cannot resurrect the released cache');
  await chatActions.createChat();
  assert.equal(state.activeId, 2, 'reuse a cleared free slot instead of incrementing beyond five');
}
await chatActions.createChat();
await chatActions.createChat();
await chatActions.createChat();
assert.equal(state.chats.length, 5);
const atLimit = fetchLog.length;
await chatActions.createChat();
assert.equal(fetchLog.length, atLimit);
assert.equal(els.get('addChatBtn').disabled, true);
assert.ok(fetchLog.filter((call) => call.body?.chatId).every((call) => call.body.chatId >= 1 && call.body.chatId <= 5));

// 14. Preserve legacy invalid IDs as explicit read-only archives, never remap/send them.
chatActions.openDeleteModal();
await chatActions.applyModal(); // free one list position
store.set('miniapp-ui-history-v1#c9', JSON.stringify([{ role: 'user', text: 'старый архив' }]));
state.chats.push({ id: 9, name: 'Старый диалог' });
chatState.saveChatMeta();
chatState.loadChatMeta();
assert.ok(
  state.chats.some((chat) => chat.id === 9),
  'legacy metadata is not silently dropped',
);
chatActions.switchChat(9);
assert.equal(els.get('archiveNotice').classList.contains('hidden'), false);
assert.equal(els.get('input').disabled, true);
assert.equal(els.get('sendBtn').disabled, true);
assert.match(chatEl.textContent, /старый архив/);
const beforeArchive = fetchLog.length;
chatActions.sendMessage('нельзя отправить');
await chatActions.newChat();
assert.equal(fetchLog.length, beforeArchive);
chatActions.openDeleteModal();
await chatActions.applyModal();
assert.equal(store.has('miniapp-ui-history-v1#c9'), false);
assert.equal(fetchLog.length, beforeArchive, 'deleting a non-server archive makes no invalid API request');
assert.equal(els.get('input').disabled, false);

// 15. In-flight file reads cannot reappear after removal or a chat switch.
let finishRead;
const delayedFile = {
  name: 'delayed.md',
  type: 'text/markdown',
  size: 4,
  arrayBuffer: () =>
    new Promise((resolve) => {
      finishRead = () => resolve(new TextEncoder().encode('text').buffer);
    }),
};
const reading = chatActions.attachTextFile(delayedFile);
chatActions.clearFileAttachment();
finishRead();
await reading;
assert.equal(state.pendingFile, null);
const readingAcrossSwitch = chatActions.attachTextFile(delayedFile);
chatActions.switchChat(state.chats.find((chat) => chat.id !== state.activeId).id);
finishRead();
await readingAcrossSwitch;
assert.equal(state.pendingFile, null);

// 16. Slot preparation locks all mutation paths until the cleanup response arrives.
const originalFetch = globalThis.fetch;
let finishCleanup;
globalThis.fetch = async (url, opts) => {
  if (url === '/api/new')
    await new Promise((resolve) => {
      finishCleanup = resolve;
    });
  return originalFetch(url, opts);
};
const activeBeforeCreate = state.activeId;
const preparing = chatActions.createChat();
assert.equal(state.managing, true);
const requestsWhilePreparing = fetchLog.length;
chatActions.sendMessage('дождаться очистки');
chatActions.switchChat(state.chats.find((chat) => chat.id !== activeBeforeCreate).id);
assert.equal(state.activeId, activeBeforeCreate);
assert.equal(fetchLog.length, requestsWhilePreparing);
assert.equal(els.get('sendBtn').disabled, true);
finishCleanup();
await preparing;
globalThis.fetch = originalFetch;
assert.equal(state.managing, false);
assert.equal(els.get('sendBtn').disabled, false);

// Captionless images without a local decoder still restore an honest attachment note.
renderer.addMsg('user', '', null, true);
renderer.clearChatDom();
renderer.restore(state.activeId);
assert.equal(chatEl.querySelectorAll('.bubble-attach-note').length, 1);

// 17. Dedicated profile screen: drafts, private fields, optional year, save/conflict/error.
const profileActions = await importApp('profile/profileActions.js');
const { profileState, profileValidation } = await importApp('profile/profileState.js');
const { profileEls } = await importApp('profile/profileRender.js');
chatEl.scrollTop = 123;
els.get('input').value = 'черновик сообщения';
await chatActions.attachTextFile(fakeFile);
const pendingFile = state.pendingFile;
const activeChat = state.activeId;
profileActions.openProfile();
await profileActions.loadUserProfile();
assert.equal(state.profileOpen, true);
assert.equal(els.get('chatScreen').classList.contains('hidden'), true);
assert.equal(els.get('profileScreen').classList.contains('hidden'), false);
assert.equal(document.activeElement, els.get('profileTitle'));
assert.equal(els.get('profileTelegramName').textContent, 'Тестовый пользователь');
assert.equal(els.get('profileTelegramUsername').textContent, '@test_user');
assert.equal(els.get('profileSave').disabled, true);
const edit = (id, value) => {
  els.get(id).value = value;
  els.get(id).dispatch('input');
};
edit('profileBio', 'Люблю инди-игры <не HTML>');
edit('profileDay', '29');
edit('profileMonth', '2');
assert.equal(profileValidation(), '', 'February 29 without a year is valid');
edit('profileYear', '2023');
assert.ok(profileValidation());
assert.equal(els.get('profileSave').disabled, true);
edit('profileYear', '2024');
assert.equal(profileValidation(), '');
edit('profileYear', '');
await profileActions.saveUserProfile();
assert.equal(savedProfile.biography, 'Люблю инди-игры <не HTML>');
assert.deepEqual(savedProfile.birthday, { day: 29, month: 2 });
assert.equal(els.get('profileSave').disabled, true);
assert.ok(
  !Array.from(store.values()).some((value) => value.includes('Люблю инди-игры')),
  'profile is never placed in localStorage',
);
const profilePost = fetchLog.filter((call) => call.path === '/api/profile' && call.body).at(-1);
assert.deepEqual(Object.keys(profilePost.body).sort(), ['biography', 'birthday', 'revision']);
edit('profileBio', '😀'.repeat(2000));
assert.equal(profileValidation(), '', 'Unicode code points, not UTF-16 units');
edit('profileBio', '😀'.repeat(2001));
assert.ok(profileValidation());
edit('profileBio', 'не терять черновик');
profileFailure = true;
await profileActions.saveUserProfile();
assert.equal(profileState.draft.biography, 'не терять черновик');
assert.equal(profileState.loaded.biography, 'Люблю инди-игры <не HTML>');
profileFailure = false;
profileConflict = true;
await profileActions.saveUserProfile();
assert.equal(profileState.conflict, true);
assert.equal(els.get('profileSave').disabled, true);
assert.equal(profileState.draft.biography, 'не терять черновик');
// Identity refresh must not acknowledge a newer editable revision over a dirty draft.
savedProfile = {
  ...savedProfile,
  revision: savedProfile.revision + 1,
  biography: 'другое устройство',
  displayName: 'Новое имя',
};
const draftRevision = profileState.loaded.revision;
await profileActions.loadUserProfile(true);
assert.equal(profileState.loaded.displayName, 'Новое имя');
assert.equal(profileState.loaded.revision, draftRevision);
assert.equal(profileState.draft.biography, 'не терять черновик');
assert.equal(profileState.conflict, true);
profileConflict = false;
profileActions.requestCloseProfile();
assert.equal(els.get('profileDiscard').classList.contains('hidden'), false);
keydown('Tab', document.activeElement);
assert.equal(document.activeElement, els.get('profileDiscardConfirm'));
keydown('Escape', document.activeElement);
assert.equal(els.get('profileDiscard').classList.contains('hidden'), true);
assert.equal(state.profileOpen, true);
// Hidden chat receives replies without scrolling or stealing focus.
const focusBeforeReply = document.activeElement;
renderer.addMsg('bot', 'ответ во время просмотра профиля');
assert.equal(chatEl.scrollTop, 123);
assert.equal(document.activeElement, focusBeforeReply);
profileActions.requestCloseProfile();
els.get('profileDiscardConfirm').dispatch('click');
assert.equal(state.profileOpen, false);
assert.equal(state.activeId, activeChat);
assert.equal(els.get('input').value, 'черновик сообщения');
assert.equal(state.pendingFile, pendingFile);
assert.equal(chatEl.scrollTop, 123);
assert.equal(els.get('chatScreen').inert, false);
// Loading errors cannot turn into a blank save, and do not trap Back.
profileState.loaded = null;
profileFailure = true;
profileActions.openProfile();
await profileActions.loadUserProfile();
assert.equal(els.get('profileSave').disabled, true);
assert.equal(els.get('profileFields').disabled, true);
profileActions.requestCloseProfile();
assert.equal(state.profileOpen, false);
profileFailure = false;
await profileActions.loadUserProfile();
assert.equal(profileState.loaded.biography, 'другое устройство');
assert.equal(profileEls.profileForm.tagName, 'FORM');

// 17b. Bot profile: exactly 15 numeric-only traits, three accessible groups, independent drafts.
const characterActions = await importApp('character/characterActions.js');
const { characterState, isCharacterDirty } = await importApp('character/characterState.js');
const { traitControls } = await importApp('character/characterRender.js');
assert.equal(els.get('botAvatar').tagName, 'BUTTON');
assert.ok(!html.includes('characterBio"') && !html.includes('characterDescription"'), 'no manual personality input');
els.get('botAvatar').focus();
els.get('botAvatar').dispatch('click');
await characterActions.loadCharacterProfile();
assert.equal(characterState.open, true);
assert.equal(document.activeElement, els.get('characterTitle'));
assert.equal(traitControls.size, 15);
assert.equal(els.get('characterTabs').children.length, 3);
assert.equal(els.get('characterGroups').children.filter((panel) => !panel.classList.contains('hidden')).length, 1);
assert.equal(els.get('characterGroups').querySelectorAll('input').length, 45);
assert.equal(els.get('characterGroups').querySelectorAll('textarea').length, 0);
assert.equal(els.get('characterFullName').textContent, 'Горепочка Гаспарян');
assert.equal(els.get('characterUsername').textContent, '@GORepochka');
assert.equal(els.get('characterSave').disabled, true);
const chooseTrait = (id, level) => {
  const input = traitControls.get(id).inputs[level];
  input.checked = true;
  input.dispatch('change');
};
chooseTrait('humor', 0);
assert.equal(isCharacterDirty(), true);
assert.equal(els.get('characterSave').disabled, false);
assert.match(els.get('characterSummary').textContent, /Почти без шуток/);
const firstTraitTab = els.get('characterTabs').children[0];
firstTraitTab.dispatch('keydown', { key: 'End' });
assert.equal(characterState.activeGroup, 'style');
assert.equal(document.activeElement, els.get('characterTabs').children[2]);
assert.equal(els.get('characterTabs').children[2].getAttribute('aria-selected'), 'true');
assert.equal(els.get('characterGroups').children[2].classList.contains('hidden'), false);
els.get('characterTabs').children[2].dispatch('keydown', { key: 'ArrowRight' });
assert.equal(characterState.activeGroup, 'conversation');
await characterActions.saveCharacterProfile();
assert.equal(savedCharacter.traits.humor, 0);
assert.equal(isCharacterDirty(), false);
assert.deepEqual(
  Object.keys(fetchLog.filter((call) => call.path === '/api/character-profile' && call.body).at(-1).body).sort(),
  ['revision', 'traits'],
);
assert.equal(savedProfile.biography, 'другое устройство', 'character saves cannot alter the user biography');
chooseTrait('energy', 0);
characterFailure = true;
await characterActions.saveCharacterProfile();
assert.equal(characterState.draft.energy, 0);
assert.equal(characterState.loaded.traits.energy, 2);
characterFailure = false;
characterConflict = true;
await characterActions.saveCharacterProfile();
assert.equal(characterState.conflict, true);
assert.equal(els.get('characterSave').disabled, true);
assert.equal(characterState.draft.energy, 0);
// Switching to My profile goes through the same unsaved-edit guard (also used by native Settings).
profileActions.openProfile();
assert.equal(els.get('characterDiscard').classList.contains('hidden'), false);
keydown('Tab', document.activeElement);
assert.equal(document.activeElement, els.get('characterDiscardConfirm'));
keydown('Escape', document.activeElement);
assert.equal(characterState.open, true);
const characterFocus = document.activeElement;
renderer.addMsg('bot', 'ответ при открытом характере');
assert.equal(chatEl.scrollTop, 123);
assert.equal(document.activeElement, characterFocus);
profileActions.openProfile();
els.get('characterDiscardConfirm').dispatch('click');
assert.equal(characterState.open, false);
assert.equal(profileState.open, true);
await profileActions.loadUserProfile();
profileActions.requestCloseProfile();
characterConflict = false;
characterActions.openCharacterProfile();
await characterActions.loadCharacterProfile();
characterActions.resetCharacterDraft();
assert.deepEqual(characterState.draft, defaultTraits());
assert.equal(savedCharacter.traits.humor, 0, 'reset is a draft until Save');
await characterActions.saveCharacterProfile();
assert.equal(savedCharacter.traits.humor, 2);
characterActions.requestCloseCharacter();
assert.equal(document.activeElement, els.get('botAvatar'));
assert.equal(state.profileOpen, false);
assert.equal(els.get('input').value, 'черновик сообщения');
assert.equal(state.pendingFile, pendingFile);
assert.equal(chatEl.scrollTop, 123);
assert.ok(
  !Array.from(store.values()).some((value) => /"sociability"/.test(value)),
  'trait settings are not placed in localStorage',
);
characterState.loaded = null;
characterFailure = true;
characterActions.openCharacterProfile();
await characterActions.loadCharacterProfile();
assert.equal(els.get('characterSave').disabled, true);
assert.equal(traitControls.get('humor').field.disabled, true);
characterActions.requestCloseCharacter();
assert.equal(state.profileOpen, false);
characterFailure = false;

// 17c. One lorebook: locked canonical entries, private drafts, Unicode/keyword limits and shared navigation.
const lorebookActions = await importApp('lorebook/lorebookActions.js');
const { lorebookState, isLorebookDirty } = await importApp('lorebook/lorebookState.js');
const { userLoreControls } = await importApp('lorebook/lorebookRender.js');
const chatBeforeLorebook = state.activeId;
const chatHeader = html.match(/<header class="header">([\s\S]*?)<\/header>/)[1];
const chatMenu = html.match(/<div class="chat-menu[^>]*>([\s\S]*?)<\/div>/)[1];
assert.ok(chatHeader.indexOf('id="lorebookBtn"') < chatHeader.indexOf('id="profileBtn"'));
assert.match(chatHeader, /id="lorebookBtn"[^>]*aria-label="Лорбук"[\s\S]*?<svg/);
assert.ok(!chatMenu.includes('lorebookBtn'), 'lorebook must not remain a chat menu item');
const personalLoreSection = html.match(/<section[^>]*aria-labelledby="lorebookMineTitle">([\s\S]*?)<\/section>/)[1];
const loreHints = Array.from(
  personalLoreSection.matchAll(/<p class="profile-hint"[^>]*>([^<]*)<\/p>/g),
  (match) => match[1],
);
assert.ok(loreHints.join(' ').length < 300, 'personal lore help must stay compact');
assert.ok(loreHints.some((hint) => hint.includes('300 символов') && hint.includes('10 ключей')));
assert.ok(loreHints.some((hint) => hint.includes('по ключевым словам или всегда')));
assert.ok(loreHints.some((hint) => hint.includes('ИИ-провайдеру') && hint.includes('секреты')));
els.get('lorebookBtn').focus();
els.get('lorebookBtn').dispatch('click');
await lorebookActions.loadLorebook();
assert.equal(lorebookState.open, true);
assert.equal(document.activeElement, els.get('lorebookTitle'));
assert.equal(els.get('lorebookPrimary').children.length, Object.keys(primaryLorebook).length);
Object.values(primaryLorebook).forEach((entry, index) => {
  const summary = els.get('lorebookPrimary').children[index].querySelector('summary');
  assert.equal(
    summary.textContent,
    entry.comment ||
      Array.from(entry.content).slice(0, 70).join('') + (Array.from(entry.content).length > 70 ? '…' : ''),
  );
  assert.equal(summary.children.length, 0, 'titles are rendered as text, not HTML');
});
assert.equal(els.get('lorebookPrimary').querySelectorAll('textarea').length, 0);
assert.equal(els.get('lorebookPrimary').querySelectorAll('input').length, 0);
assert.equal(els.get('lorebookPrimary').querySelectorAll('button').length, 0);
assert.equal(els.get('lorebookSave').disabled, true);
lorebookActions.addLoreEntry();
assert.equal(document.activeElement, userLoreControls[0].comment);
assert.equal(userLoreControls[0].commentCounter.textContent, '0 / 40');
userLoreControls[0].content.value = '😀'.repeat(300);
userLoreControls[0].content.dispatch('input');
assert.equal(userLoreControls[0].counter.textContent, '300 / 300');
assert.equal(els.get('lorebookSave').disabled, true, 'non-permanent entries require a keyword');
userLoreControls[0].keys.value = Array.from({ length: 11 }, (_, i) => `ключ${i}`).join(', ');
userLoreControls[0].keys.dispatch('input');
assert.equal(els.get('lorebookSave').disabled, true);
userLoreControls[0].keys.value = 'игра, музыка\nкот';
userLoreControls[0].keys.dispatch('input');
assert.equal(els.get('lorebookSave').disabled, false);
userLoreControls[0].comment.value = '😀'.repeat(40);
userLoreControls[0].comment.dispatch('input');
assert.equal(userLoreControls[0].commentCounter.textContent, '40 / 40');
assert.equal(els.get('lorebookSave').disabled, false);
userLoreControls[0].comment.value += '😀';
userLoreControls[0].comment.dispatch('input');
assert.equal(userLoreControls[0].comment.getAttribute('aria-invalid'), 'true');
assert.equal(els.get('lorebookSave').disabled, true);
userLoreControls[0].comment.value = 'Моя запись';
userLoreControls[0].comment.dispatch('input');
userLoreControls[0].content.value += '😀';
userLoreControls[0].content.dispatch('input');
assert.equal(els.get('lorebookSave').disabled, true);
userLoreControls[0].content.value = 'ONLY_LOREBOOK_PRIVATE';
userLoreControls[0].content.dispatch('input');
await lorebookActions.saveLorebook();
assert.equal(isLorebookDirty(), false);
assert.deepEqual(
  Object.keys(fetchLog.filter((call) => call.path === '/api/lorebook' && call.body).at(-1).body).sort(),
  ['entries', 'revision'],
);
assert.deepEqual(Object.keys(savedLorebook.entries[0]).sort(), ['comment', 'constant', 'content', 'key']);
assert.equal(savedLorebook.entries[0].comment, 'Моя запись');
userLoreControls[0].comment.value = '';
userLoreControls[0].comment.dispatch('input');
assert.equal(isLorebookDirty(), true, 'title-only edits must protect drafts');
assert.equal(els.get('lorebookSave').disabled, false, 'empty titles are permitted');
await lorebookActions.saveLorebook();
assert.equal(savedLorebook.entries[0].comment, '');
assert.equal(savedLorebook.entries[0].content, 'ONLY_LOREBOOK_PRIVATE');
lorebookActions.addLoreEntry();
userLoreControls[1].content.value = 'Вторая запись';
userLoreControls[1].content.dispatch('input');
userLoreControls[1].constant.checked = true;
userLoreControls[1].constant.dispatch('change');
lorebookActions.addLoreEntry();
assert.equal(els.get('lorebookAdd').disabled, true);
lorebookActions.addLoreEntry();
assert.equal(lorebookState.draft.length, 3);
lorebookActions.requestDeleteLoreEntry(2);
els.get('lorebookKeepEditing').dispatch('click');
assert.equal(lorebookState.draft.length, 3, 'delete is confirmed, not immediate');
lorebookActions.requestDeleteLoreEntry(2);
keydown('Tab', document.activeElement);
assert.equal(document.activeElement, els.get('lorebookDiscardConfirm'));
els.get('lorebookDiscardConfirm').dispatch('click');
assert.equal(lorebookState.draft.length, 2);
assert.equal(savedLorebook.entries.length, 1, 'deleting a draft does not save');
lorebookFailure = true;
await lorebookActions.saveLorebook();
assert.equal(lorebookState.draft.length, 2);
assert.equal(lorebookState.loaded.entries.length, 1);
lorebookFailure = false;
lorebookConflict = true;
await lorebookActions.saveLorebook();
assert.equal(lorebookState.conflict, true);
assert.equal(els.get('lorebookSave').disabled, true);
profileActions.openProfile();
assert.equal(els.get('lorebookDiscard').classList.contains('hidden'), false);
keydown('Escape', document.activeElement);
assert.equal(lorebookState.open, true);
const loreFocus = document.activeElement;
renderer.addMsg('bot', 'ответ при открытом лорбуке');
assert.equal(chatEl.scrollTop, 123);
assert.equal(document.activeElement, loreFocus);
profileActions.openProfile();
els.get('lorebookDiscardConfirm').dispatch('click');
assert.equal(lorebookState.open, false);
assert.equal(profileState.open, true);
await profileActions.loadUserProfile();
profileActions.requestCloseProfile();
lorebookConflict = false;
// Reopening after discarding added cards must not leave stale controls referencing deleted drafts.
lorebookActions.openLorebook();
await lorebookActions.loadLorebook();
assert.equal(userLoreControls.length, 1);
assert.equal(lorebookState.draft.length, 1);
userLoreControls[0].content.value = 'не терять';
userLoreControls[0].content.dispatch('input');
els.get('lorebookReload').dispatch('click');
assert.equal(els.get('lorebookDiscard').classList.contains('hidden'), false);
els.get('lorebookDiscardConfirm').dispatch('click');
await lorebookActions.loadLorebook();
assert.equal(lorebookState.draft[0].content, 'ONLY_LOREBOOK_PRIVATE');
lorebookActions.requestDeleteLoreEntry(0);
els.get('lorebookDiscardConfirm').dispatch('click');
assert.equal(els.get('lorebookSave').disabled, false);
await lorebookActions.saveLorebook();
assert.deepEqual(savedLorebook.entries, []);
lorebookActions.requestCloseLorebook();
assert.equal(document.activeElement, els.get('lorebookBtn'));
assert.equal(state.profileOpen, false);
assert.equal(state.activeId, chatBeforeLorebook);
assert.equal(els.get('input').value, 'черновик сообщения');
assert.equal(state.pendingFile, pendingFile);
assert.equal(chatEl.scrollTop, 123);
assert.ok(
  !Array.from(store.values()).some((value) => value.includes('ONLY_LOREBOOK_PRIVATE')),
  'lore does not enter localStorage',
);
lorebookState.loaded = null;
lorebookFailure = true;
lorebookActions.openLorebook();
await lorebookActions.loadLorebook();
assert.equal(els.get('lorebookSave').disabled, true);
assert.equal(els.get('lorebookAdd').disabled, true);
lorebookActions.requestCloseLorebook();
assert.equal(state.profileOpen, false);
lorebookFailure = false;

// 18. Tap-to-record voice composer: draft isolation, interruption preview, navigation and sending.
const voiceActions = await importApp('voice/voiceActions.js');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [voiceTrack], getAudioTracks: () => [voiceTrack] }) },
  },
});
globalThis.isSecureContext = true;
let voiceStopped = false;
const voiceTrack = {
  enabled: true,
  stop() {
    voiceStopped = true;
  },
};
let latestRecorder;
class FakeRecorder {
  static isTypeSupported(type) {
    return type === 'audio/webm;codecs=opus';
  }
  constructor(stream, options) {
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    latestRecorder = this; // eslint-disable-line @typescript-eslint/no-this-alias -- stub captures the instance for assertions
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
      this.ondataavailable?.({ data: new Blob(['voice-data'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}
globalThis.MediaRecorder = FakeRecorder;
const settle = async () => {
  for (let n = 0; n < 15; n++) await new Promise((resolve) => setTimeout(resolve, 0));
};
chatActions.clearAttachments();
els.get('input').value = 'сохранить текст, не отправлять с аудио';
await voiceActions.startVoice();
assert.equal(state.voiceActive, true);
assert.equal(els.get('textComposer').classList.contains('hidden'), true);
assert.equal(state.voicePhase, 'recording');
latestRecorder.ondataavailable({ data: new Blob(['initial']) });
// Advancing the recorder's start timestamp avoids real-time test delays.
const { VoiceRecorder } = await importApp('voice/voiceRecorder.js');
const originalDuration = VoiceRecorder.prototype.duration;
VoiceRecorder.prototype.duration = () => 1.2;
assert.equal(
  els.get('voicePause').classList.contains('hidden'),
  true,
  'preview play lives in the draft, not the recording row',
);
assert.equal(els.get('voiceSend').classList.contains('hidden'), true, 'send appears only after stopping to preview');
voiceActions.finishRecording('interrupted');
await settle();
assert.equal(state.voicePhase, 'preview');
assert.equal(voiceStopped, true);
assert.equal(els.get('voicePreviewSeek').classList.contains('hidden'), false);
assert.equal(els.get('input').value, 'сохранить текст, не отправлять с аудио');
const chatBeforeVoice = state.activeId;
chatActions.switchChat(state.chats.find((chat) => chat.id !== chatBeforeVoice).id);
assert.equal(state.activeId, chatBeforeVoice);
assert.equal(els.get('voiceDiscard').classList.contains('hidden'), false);
assert.equal(document.activeElement, els.get('voiceKeep'));
keydown('Tab', document.activeElement);
assert.equal(document.activeElement, els.get('voiceDiscardConfirm'));
keydown('Escape', document.activeElement);
assert.equal(els.get('voiceDiscard').classList.contains('hidden'), true);
assert.equal(state.voiceActive, true);
profileActions.openProfile();
assert.equal(state.profileOpen, false, 'profile cannot hide a live voice draft');
els.get('voiceKeep').dispatch('click');
characterActions.openCharacterProfile();
assert.equal(state.profileOpen, false, 'character profile cannot hide a live voice draft');
els.get('voiceKeep').dispatch('click');
lorebookActions.openLorebook();
assert.equal(state.profileOpen, false, 'lorebook cannot hide a live voice draft');
els.get('voiceKeep').dispatch('click');

// Upload and chat transport are stubbed, but the real send/render/cache graph runs.
const audioId = 'abcdef12-1234-1234-1234-123456789abc';
const readyAudio = { id: audioId, state: 'ready', duration: 1.2, size: 100, waveform: [10, 60, 100] };
let uploads = 0;
globalThis.XMLHttpRequest = class {
  constructor() {
    this.upload = {};
  }
  open(method, url) {
    this.url = url;
  }
  setRequestHeader() {}
  send(form) {
    uploads++;
    assert.ok(form.get('audio'));
    this.status = 202;
    this.responseText = JSON.stringify({ ok: true, audio: readyAudio });
    queueMicrotask(() => this.onload());
  }
  abort() {
    this.onabort?.();
  }
};
const normalFetch = globalThis.fetch;
let audioPayload;
let failAudioReply = true;
globalThis.fetch = async (url, options) => {
  if (url === `/api/audio/${audioId}`)
    return { ok: true, status: 200, json: async () => ({ ok: true, audio: readyAudio }) };
  if (url === '/api/chat' && JSON.parse(options.body).audioId) {
    audioPayload = JSON.parse(options.body);
    if (failAudioReply)
      return { ok: false, status: 502, json: async () => ({ ok: false, error: 'test audio provider failure' }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, reply: 'Голосовое услышано', model: 'test-model' }),
    };
  }
  return normalFetch(url, options);
};
els.get('voiceSend').dispatch('click');
await settle();
assert.equal(state.voiceActive, false);
assert.equal(state.sending, false);
assert.equal(audioPayload.message, '', 'text draft is not secretly included as a caption');
assert.equal(els.get('input').value, 'сохранить текст, не отправлять с аудио');
assert.equal(uploads, 1);
assert.ok(chatEl.querySelector('.voice-retry'));
const retryId = audioPayload.requestId;
failAudioReply = false;
chatEl.querySelector('.voice-retry').onclick();
await settle();
assert.equal(uploads, 1, 'retry reuses prepared audio');
assert.equal(audioPayload.requestId, retryId, 'lost/error response retains idempotency key');
assert.match(chatEl.textContent, /Голосовое услышано/);
assert.equal(chatEl.querySelector('.voice-retry'), null);
const cache = JSON.parse(store.get(`miniapp-ui-history-v1#c${state.activeId}`));
assert.equal(cache.find((message) => message.voice)?.voice.id, audioId);
assert.equal(cache.find((message) => message.voice)?.voice.delivery, 'sent');
assert.ok(!JSON.stringify(cache).includes('blob:'));
assert.ok(!JSON.stringify(cache).includes('voice-data'));
renderer.clearChatDom();
renderer.restore(state.activeId);
assert.ok(chatEl.querySelector('.bubble-voice'), 'voice descriptors survive restoration');
// Cancellation can race with successful generation. Recover the old result,
// rather than submitting a second paid request or adding another user bubble.
const userBubblesBefore = chatEl.querySelectorAll('.user').length;
let nativeSubmissions = 0;
let cancellations = 0;
const recoveredReply = { ok: true, reply: 'Ответ восстановлен после отмены', model: 'test-model' };
globalThis.fetch = async (url, options) => {
  if (url === `/api/audio/${audioId}`)
    return { ok: true, status: 200, json: async () => ({ ok: true, audio: readyAudio }) };
  if (url === '/api/chat' && JSON.parse(options.body).audioId) {
    nativeSubmissions++;
    return { ok: true, status: 202, json: async () => ({ ok: true, jobId: 'voice-job-test', state: 'analyzing' }) };
  }
  if (url.startsWith('/api/chat-jobs/request/')) {
    if (options.method === 'DELETE') {
      cancellations++;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, jobId: 'voice-job-test', state: 'complete', result: recoveredReply }),
    };
  }
  return normalFetch(url, options);
};
await voiceActions.startVoice();
voiceActions.finishRecording('preview');
await settle();
els.get('voiceSend').dispatch('click');
await settle();
assert.equal(state.sending, true);
els.get('cancelSend').onclick();
await settle();
assert.equal(state.sending, false);
assert.ok(cancellations > 0, 'cancellation is sent to the server, not just the browser');
assert.ok(chatEl.querySelector('.voice-retry'));
chatEl.querySelector('.voice-retry').onclick();
await settle();
assert.equal(nativeSubmissions, 1, 'recover completed cancellation race without paying twice');
assert.equal(chatEl.querySelectorAll('.user').length, userBubblesBefore + 1);
assert.match(chatEl.textContent, /Ответ восстановлен после отмены/);
assert.equal(chatEl.querySelector('.voice-retry'), null);
globalThis.fetch = normalFetch;
VoiceRecorder.prototype.duration = originalDuration;

// Explicitly confirmed navigation disposes a draft and restores the text composer.
await voiceActions.startVoice();
chatActions.switchChat(state.chats.find((chat) => chat.id !== state.activeId).id);
els.get('voiceDiscardConfirm').dispatch('click');
assert.equal(state.voiceActive, false);
assert.equal(els.get('textComposer').classList.contains('hidden'), false);

// 19. Single tap starts, second tap stops to preview; late permissions cannot resurrect capture.
VoiceRecorder.prototype.duration = () => 1.2;
globalThis.fetch = async (url, options) => {
  if (url === `/api/audio/${audioId}`)
    return { ok: true, status: 200, json: async () => ({ ok: true, audio: readyAudio }) };
  if (url === '/api/chat' && JSON.parse(options.body).audioId)
    return { ok: true, status: 200, json: async () => ({ ok: true, reply: 'Отправлено нажатием' }) };
  return normalFetch(url, options);
};
const recordButton = els.get('voiceBtn');
const tapRecord = async () => {
  recordButton.dispatch('click', {});
  await new Promise((resolve) => setTimeout(resolve, 350));
};
await tapRecord();
assert.equal(state.voicePhase, 'recording');
await tapRecord();
await settle();
assert.equal(state.voicePhase, 'preview');
els.get('voiceSend').dispatch('click');
await settle();
assert.equal(state.voiceActive, false);
assert.match(chatEl.textContent, /Отправлено нажатием/);

let permission;
const getUserMedia = navigator.mediaDevices.getUserMedia;
navigator.mediaDevices.getUserMedia = () =>
  new Promise((resolve) => {
    permission = resolve;
  });
await tapRecord();
assert.equal(state.voicePhase, 'requesting');
await tapRecord();
assert.equal(state.voiceActive, false);
let lateStopped = false;
const lateTrack = {
  stop() {
    lateStopped = true;
  },
};
permission({ getTracks: () => [lateTrack] });
await settle();
assert.equal(lateStopped, true);
navigator.mediaDevices.getUserMedia = getUserMedia;

// 20. Video-note capture uses the same composer, but distinct transport/rendering.
recordButton.dispatch('click', {});
recordButton.dispatch('click', {});
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(state.recordingMode, 'video-note');
assert.equal(recordButton.classList.contains('is-video-mode'), true);
assert.equal(state.voiceActive, false, 'double tap switches mode without requesting camera permission');
const createElement = document.createElement;
const cameraTracks = [];
const newTrack = (kind) => {
  const value = {
    kind,
    stop() {
      this.stopped = true;
    },
  };
  cameraTracks.push(value);
  return value;
};
globalThis.MediaStream = class {
  constructor(tracks) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
};
document.createElement = (tag) => {
  const result = createElement(tag);
  if (tag === 'canvas') {
    result.getContext = () => ({ drawImage() {} });
    result.captureStream = () => new MediaStream([newTrack('video')]);
  }
  if (tag === 'video') {
    result.videoWidth = 640;
    result.videoHeight = 480;
  }
  return result;
};
navigator.userAgent = 'Windows';
navigator.mediaDevices.getUserMedia = async () => new MediaStream([newTrack('video'), newTrack('audio')]);
navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }];
FakeRecorder.isTypeSupported = (type) => type === 'video/mp4';
const noteId = 'abcdef34-1234-1234-1234-123456789abc';
const readyNote = {
  id: noteId,
  kind: 'video-note',
  state: 'ready',
  name: 'video',
  duration: 1.2,
  size: 100,
  poster: 'data:image/jpeg;base64,YQ==',
};
let noteUploads = 0;
globalThis.XMLHttpRequest = class {
  constructor() {
    this.upload = {};
  }
  open(method, url) {
    assert.match(url, /\/api\/videos\?chatId=\d&kind=video-note/);
  }
  setRequestHeader() {}
  send(form) {
    assert.ok(form.get('video'));
    noteUploads++;
    this.status = 202;
    this.responseText = JSON.stringify({ ok: true, video: readyNote });
    queueMicrotask(() => this.onload());
  }
};
let notePayload;
let failNote = true;
let mediaDownloads = 0;
globalThis.fetch = async (url, options) => {
  if (url === `/api/videos/${noteId}`)
    return { ok: true, status: 200, json: async () => ({ ok: true, video: readyNote }) };
  if (url === `/api/videos/${noteId}/media`) {
    mediaDownloads++;
    assert.ok(options.headers['X-Miniapp-Client-Id']);
    return { ok: true, status: 200, blob: async () => new Blob(['private-note'], { type: 'video/mp4' }) };
  }
  if (url === '/api/chat' && JSON.parse(options.body).videoId === noteId) {
    notePayload = JSON.parse(options.body);
    return {
      ok: !failNote,
      status: failNote ? 502 : 200,
      json: async () =>
        failNote
          ? { ok: false, error: 'note provider test failure' }
          : { ok: true, reply: 'Кружочек увидела и услышала' },
    };
  }
  return normalFetch(url, options);
};
recordButton.dispatch('click', {});
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(state.voicePhase, 'recording');
assert.equal(els.get('videoNoteStage').classList.contains('hidden'), false);
assert.equal(
  els.get('cameraFlip').classList.contains('hidden'),
  true,
  'desktop never sees flip, even with multiple cameras',
);
recordButton.dispatch('click', {});
await new Promise((resolve) => setTimeout(resolve, 400));
await settle();
assert.equal(state.voicePhase, 'preview');
els.get('voiceSend').dispatch('click');
await settle();
assert.equal(state.voiceActive, false);
assert.equal(state.sending, false);
assert.equal(notePayload.message, '', 'video notes do not consume the typed draft');
assert.equal(notePayload.audioId, undefined);
assert.equal(noteUploads, 1);
let noteBox = chatEl.querySelector('.bubble-video-note');
assert.ok(noteBox.querySelector('.video-retry'));
const noteRequestId = notePayload.requestId;
failNote = false;
noteBox.querySelector('.video-retry').onclick();
await settle();
assert.equal(noteUploads, 1);
assert.equal(notePayload.requestId, noteRequestId);
assert.equal(noteBox.videoDescriptor.delivery, 'sent');
assert.equal(mediaDownloads, 0, 'sent notes never autoplay/download on render');
await noteBox.querySelector('.note-play').onclick();
const notePlayer = noteBox.querySelector('video');
assert.equal(mediaDownloads, 1);
assert.equal(notePlayer.muted, true);
assert.equal(notePlayer.paused, false);
noteBox.querySelector('.note-mute').onclick();
assert.equal(notePlayer.muted, false);
noteBox.querySelector('.note-mute').onclick();
assert.equal(notePlayer.muted, true);
const noteSeek = noteBox.querySelector('.note-seek');
noteSeek.value = '50';
noteSeek.oninput();
assert.equal(notePlayer.currentTime, 0.6);
const noteRing = noteBox.querySelector('.note-ring');
noteRing.getBoundingClientRect = () => ({ left: 0, top: 0, width: 260, height: 260 });
noteRing.dispatch('pointerdown', { pointerId: 3, clientX: 260, clientY: 130, button: 0 });
assert.equal(notePlayer.currentTime, 0.3, 'circular ring seeks clockwise from the top');
noteRing.dispatch('pointerup', { pointerId: 3, clientX: 260, clientY: 130 });
const { stopVoicePlayback } = await importApp('voice/voice.js');
stopVoicePlayback();
assert.equal(notePlayer.paused, true, 'voice and circular video share playback ownership');
const noteCache = JSON.parse(store.get(`miniapp-ui-history-v1#c${state.activeId}`));
assert.equal(noteCache.find((message) => message.video?.kind === 'video-note').video.delivery, 'sent');
assert.ok(!JSON.stringify(noteCache).includes('blob:') && !JSON.stringify(noteCache).includes('private-note'));
renderer.clearChatDom();
renderer.restore(state.activeId);
assert.ok(chatEl.querySelector('.bubble-video-note'), 'circular presentation survives restoration');
assert.ok(cameraTracks.every((track) => track.stopped));
globalThis.fetch = normalFetch;
document.createElement = createElement;
VoiceRecorder.prototype.duration = originalDuration;

console.log(
  'SMOKE OK — real shell/module graph, user/character profiles, lorebook locked entries/private drafts/limits/conflicts, recording guards, media send/retry/playback and private cache.',
);
