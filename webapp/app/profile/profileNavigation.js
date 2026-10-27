/* One owner for native Back/Settings, chat visibility and unsaved-edit closing guards. */
import { tg, initData, setProfileNavigation } from '../core/telegram.js';
import { state } from '../core/state.js';
import { chatEl, inputEl, setChatVisible, updateLatest } from '../core/dom.js';
import { closeReactionPicker } from '../reactions/reactions.js';

const screens = new Map();
let active = null;
let savedScroll = 0;
let returnFocus = null;
let initialized = false;

export function updateProfileClosingGuard() {
  const dirty = [...screens.values()].some((screen) => screen.dirty() || screen.saving());
  try {
    if (tg && initData && tg.isVersionAtLeast?.('6.2')) {
      if (dirty) tg.enableClosingConfirmation();
      else tg.disableClosingConfirmation();
    }
  } catch (error) {
    /* Older clients retain in-app safeguards. */
  }
  return dirty;
}

export function requestProfileNavigation(id) {
  if (active === id) return;
  if (active) screens.get(active).requestClose(() => screens.get(id).open());
  else screens.get(id).open();
}

export function registerProfileNavigation(id, screen) {
  screens.set(id, screen);
  if (initialized) return;
  initialized = true;
  window.addEventListener('beforeunload', (event) => {
    if ([...screens.values()].some((entry) => entry.dirty() || entry.saving())) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  try {
    if (tg && initData && tg.isVersionAtLeast?.('7.0')) {
      tg.SettingsButton.onClick(() => requestProfileNavigation('user'));
      tg.SettingsButton.show();
    }
    if (tg && initData && tg.isVersionAtLeast?.('6.1'))
      tg.BackButton.onClick(() => {
        if (active) screens.get(active).requestClose();
      });
  } catch (error) {
    /* In-app navigation always works. */
  }
}

export function showProfileScreen(id, screen, title) {
  if (active) return false;
  closeReactionPicker();
  savedScroll = chatEl.scrollTop;
  returnFocus = document.activeElement;
  active = id;
  state.profileOpen = true;
  setChatVisible(false);
  const chat = document.getElementById('chatScreen');
  chat.classList.add('hidden');
  chat.inert = true;
  screen.classList.remove('hidden');
  screen.inert = false;
  setProfileNavigation(true);
  title.focus();
  return true;
}

export function hideProfileScreen(id, screen, fallback) {
  if (active !== id) return;
  active = null;
  state.profileOpen = false;
  screen.classList.add('hidden');
  screen.inert = true;
  const chat = document.getElementById('chatScreen');
  chat.classList.remove('hidden');
  chat.inert = false;
  setChatVisible(true);
  chatEl.scrollTop = savedScroll;
  updateLatest();
  setProfileNavigation(false);
  // Do not reopen the mobile keyboard after a background reply.
  (returnFocus &&
  returnFocus !== inputEl &&
  returnFocus !== document.body &&
  returnFocus.isConnected !== false &&
  typeof returnFocus.focus === 'function'
    ? returnFocus
    : fallback
  ).focus();
  updateProfileClosingGuard();
}
