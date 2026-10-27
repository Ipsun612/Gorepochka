import { state } from '../core/state.js';
import { chatMenuBtn, chatMenuEl, modalEl } from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { hideChatMenu } from '../chat/chatActions.js';
import { guardVoiceNavigation } from '../voice/voiceActions.js';
import {
  registerProfileNavigation,
  requestProfileNavigation,
  showProfileScreen,
  hideProfileScreen,
} from '../profile/profileNavigation.js';
import { refreshTheme } from './theme.js';
import { appVersion, releases } from './releases.js';

const el = (id) => document.getElementById(id);
let open = false;
let changelog = false;
let initialized = false;

function showHome() {
  changelog = false;
  el('changelogPage').classList.add('hidden');
  el('changelogPage').inert = true;
  el('settingsHome').classList.remove('hidden');
  el('settingsHome').inert = false;
  el('settingsTitle').textContent = 'Настройки';
  el('settingsBack').setAttribute('aria-label', 'Назад к переписке');
  el('changelogBtn').focus();
}

function showChangelog() {
  changelog = true;
  el('settingsHome').classList.add('hidden');
  el('settingsHome').inert = true;
  el('changelogPage').classList.remove('hidden');
  el('changelogPage').inert = false;
  el('settingsTitle').textContent = 'Что нового';
  el('settingsBack').setAttribute('aria-label', 'Назад к настройкам');
  el('changelogTitle').focus();
}

function renderChangelog() {
  const list = el('changelogList');
  list.textContent = '';
  for (const release of releases) {
    const card = document.createElement('section');
    card.className = 'changelog-card';
    const heading = document.createElement('h3');
    heading.textContent = `Версия ${release.version}`;
    const changes = document.createElement('ul');
    for (const text of release.changes) {
      const item = document.createElement('li');
      item.textContent = text;
      changes.appendChild(item);
    }
    card.appendChild(heading);
    card.appendChild(changes);
    list.appendChild(card);
  }
}

export function openSettings() {
  if (open || state.managing || !modalEl.classList.contains('hidden')) return;
  if (state.profileOpen) {
    requestProfileNavigation('settings');
    return;
  }
  if (!guardVoiceNavigation(openSettings)) return;
  const menuWasOpen = !chatMenuEl.classList.contains('hidden');
  hideChatMenu();
  if (menuWasOpen) chatMenuBtn.focus();
  if (!showProfileScreen('settings', el('settingsScreen'), el('settingsTitle'))) return;
  open = true;
  void refreshTheme();
  haptic('light');
}

function requestClose(afterClose) {
  if (!open) return;
  if (changelog && typeof afterClose !== 'function') {
    showHome();
    return;
  }
  if (changelog) showHome();
  open = false;
  hideProfileScreen('settings', el('settingsScreen'), chatMenuBtn);
  if (typeof afterClose === 'function') afterClose();
}

export function initializeSettings() {
  if (initialized) return;
  initialized = true;
  el('settingsVersion').textContent = `Версия ${appVersion}`;
  renderChangelog();
  registerProfileNavigation('settings', { open: openSettings, requestClose, dirty: () => false, saving: () => false });
  el('settingsBtn').addEventListener('click', openSettings);
  el('settingsBack').addEventListener('click', () => requestClose());
  el('changelogBtn').addEventListener('click', showChangelog);
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    }
  });
}
