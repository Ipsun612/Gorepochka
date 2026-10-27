/* Theme controller, early-paint cache, release data and synchronization races. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = (file) => import(pathToFileURL(path.join(root, 'webapp', 'app', file)).href);
function element() {
  const classes = new Set();
  const attrs = new Map();
  const events = new Map();
  return {
    checked: false,
    disabled: false,
    textContent: '',
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
    },
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getAttribute: (name) => attrs.get(name) ?? null,
    addEventListener: (name, handler) => events.set(name, handler),
    dispatch: (name) => events.get(name)?.({ target: this }),
  };
}
const store = new Map([['miniapp-theme-v1:tg:101', 'dark']]);
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};
const els = new Map();
const documentEvents = new Map();
globalThis.document = {
  documentElement: element(),
  visibilityState: 'visible',
  getElementById(id) {
    if (!els.has(id)) els.set(id, element());
    return els.get(id);
  },
  addEventListener: (name, handler) => documentEvents.set(name, handler),
};
const colors = [];
globalThis.window = globalThis;
globalThis.Telegram = {
  WebApp: {
    initData: 'signed-launch',
    initDataUnsafe: { user: { id: 101 } },
    isVersionAtLeast: () => true,
    ready() {},
    expand() {},
    setHeaderColor: (value) => colors.push(value),
    setBackgroundColor() {},
    setBottomBarColor() {},
    HapticFeedback: { notificationOccurred() {}, impactOccurred() {} },
  },
};
const boot = await readFile(path.join(root, 'webapp/app/settings/themeBoot.js'), 'utf8');
vm.runInNewContext(boot, { window, document, localStorage, Number });
assert.equal(document.documentElement.getAttribute('data-theme'), 'dark', 'cache applies before paint');
const otherDocument = { documentElement: element(), getElementById: () => element() };
vm.runInNewContext(boot, {
  window: { Telegram: { WebApp: { initData: 'signed', initDataUnsafe: { user: { id: 202 } } } } },
  document: otherDocument,
  localStorage,
  Number,
});
assert.equal(otherDocument.documentElement.getAttribute('data-theme'), null, 'cache is scoped to the Telegram user');
assert.doesNotThrow(() =>
  vm.runInNewContext(boot, {
    window,
    document: otherDocument,
    localStorage: {
      getItem: () => {
        throw Error();
      },
    },
    Number,
  }),
);

let remote = { theme: 'dark', revision: 1, updatedAt: null };
let failWrite = false;
let loseWriteResponse = false;
globalThis.fetch = async (_url, options) => {
  if (options.method === 'POST') {
    if (failWrite) throw new Error('offline');
    const update = JSON.parse(options.body);
    if (update.revision !== remote.revision)
      return { ok: false, status: 409, json: async () => ({ ok: false, code: 'SETTINGS_CONFLICT' }) };
    remote = { ...update, revision: update.revision + 1, updatedAt: null };
    if (loseWriteResponse) throw new Error('response lost after commit');
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, settings: { ...remote } }) };
};
const { initializeTheme, refreshTheme } = await app('settings/theme.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
initializeTheme();
await settle();
const toggle = els.get('themeSwitch');
assert.equal(toggle.checked, true);
assert.equal(toggle.disabled, false);
toggle.checked = false;
toggle.dispatch('change');
assert.equal(document.documentElement.getAttribute('data-theme'), 'light', 'selection applies immediately');
assert.equal(toggle.disabled, true, 'writes are serialized');
await settle();
assert.equal(remote.theme, 'light');
assert.equal(store.get('miniapp-theme-v1:tg:101'), 'light');
remote = { theme: 'dark', revision: remote.revision + 1, updatedAt: null };
toggle.checked = true;
toggle.dispatch('change');
await settle();
assert.equal(toggle.checked, false, 'conflict rolls back the unconfirmed choice');
assert.equal(toggle.disabled, true);
assert.equal(els.get('themeRetry').classList.contains('hidden'), false);
await refreshTheme();
assert.equal(toggle.checked, true, 'retry loads the other device’s choice');
failWrite = true;
toggle.checked = false;
toggle.dispatch('change');
await settle();
assert.equal(toggle.checked, true, 'failed save restores the last confirmed theme');
assert.equal(toggle.disabled, true);
failWrite = false;
await refreshTheme();
loseWriteResponse = true;
toggle.checked = false;
toggle.dispatch('change');
await settle();
assert.equal(remote.theme, 'light', 'the server can commit even when the response is lost');
assert.equal(toggle.checked, true, 'an unconfirmed write is not shown as saved');
loseWriteResponse = false;
await refreshTheme();
assert.equal(toggle.checked, false, 'retry recovers a committed write after a lost response');
remote = { theme: 'dark', revision: remote.revision + 1, updatedAt: null };
documentEvents.get('visibilitychange')();
await settle();
assert.equal(toggle.checked, true, 'foreground refresh applies a remote change');
assert.ok(colors.includes('#202b38') && colors.includes('#f7faff'));

let nativeSettingsClick;
let openedSettings = 0;
window.addEventListener = () => {};
globalThis.Telegram.WebApp.SettingsButton = {
  onClick: (handler) => {
    nativeSettingsClick = handler;
  },
  show() {},
};
globalThis.Telegram.WebApp.BackButton = { onClick() {} };
const navigation = await app('profile/profileNavigation.js');
navigation.registerProfileNavigation('settings', {
  open: () => {
    openedSettings++;
  },
  requestClose() {},
  dirty: () => false,
  saving: () => false,
});
nativeSettingsClick();
assert.equal(openedSettings, 1, 'Telegram native Settings opens the settings screen');

const { releases, appVersion } = await app('settings/releases.js');
assert.equal(appVersion, releases[0].version);
assert.ok(releases.length);
const versions = new Set();
for (const release of releases) {
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  assert.ok(!versions.has(release.version));
  versions.add(release.version);
  assert.ok(Array.isArray(release.changes) && release.changes.length > 0);
  assert.ok(release.changes.every((text) => typeof text === 'string' && text.trim() && !/[<>]/.test(text)));
}
console.log('settings UI smoke OK');
