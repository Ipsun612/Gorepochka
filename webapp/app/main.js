/* GorCOgramm: bundler-free Telegram Mini App entry point. */
import { tg, syncViewport } from './core/telegram.js';
import { state } from './core/state.js';
import {
  chatEl,
  inputEl,
  sendBtn,
  toast,
  setStatus,
  addChatBtn,
  chatMenuEl,
  chatMenuBtn,
  menuRenameBtn,
  menuDeleteBtn,
  menuClearBtn,
  modelBtn,
  settingsBtn,
  modalEl,
  modalInputEl,
  modalOkBtn,
  modalCancelBtn,
  attachBtn,
  attachInput,
  attachRemoveBtn,
  fileRemoveBtn,
  videoRemoveBtn,
  latestBtn,
  scrollLatest,
  updateLatest,
} from './core/dom.js';
import { api } from './core/api.js';
import { loadChatMeta } from './chat/chatState.js';
import { restore, clearChatDom, applyBotProfile } from './chat/render.js';
import { initializeProfile } from './profile/profileActions.js';
import { initializeCharacterProfile } from './character/characterActions.js';
import { initializeLorebook } from './lorebook/lorebookActions.js';
import { initializeSettings } from './settings/settingsActions.js';
import { initializeTheme } from './settings/theme.js';
import { initializeVoice } from './voice/voiceActions.js';
import { initializeReactions, closeReactionPicker } from './reactions/reactions.js';
import {
  renderTabs,
  createChat,
  sendMessage,
  hideChatMenu,
  openChatMenu,
  closeModal,
  openRenameModal,
  openDeleteModal,
  openClearModal,
  openModelModal,
  applyModal,
  autoGrow,
  openAttachPicker,
  clearAttachment,
  clearFileAttachment,
  attachPickedFile,
  clearVideoAttachment,
} from './chat/chatActions.js';

async function boot() {
  loadChatMeta();
  renderTabs();
  restore(state.activeId);
  autoGrow();
  applyBotProfile(null);
  setStatus('', 'Подключение…');
  try {
    const meta = await api('/api/meta');
    state.model = typeof meta.model === 'string' ? meta.model : '';
    for (const key of [
      'maxImageBytes',
      'maxFileBytes',
      'maxVideoBytes',
      'maxVideoDurationSeconds',
      'maxVideoNoteDurationSeconds',
      'maxAudioBytes',
      'maxAudioDurationSeconds',
    ]) {
      if (Number.isFinite(meta[key]) && meta[key] > 0) state[key] = meta[key];
    }
    if (Number.isInteger(meta.maxMessageLength) && meta.maxMessageLength > 0) inputEl.maxLength = meta.maxMessageLength;
    applyBotProfile(meta.bot);
    setStatus('online', 'на связи');
    // Cross-device sync (best-effort, local cache stays for offline): chats first,
    // then history for the (possibly updated) active slot.
    try {
      const { syncChatsFromServer } = await import('./chat/chatMetaSync.js');
      const synced = await syncChatsFromServer();
      if (synced) {
        clearChatDom();
        restore(state.activeId);
      }
    } catch {}
    try {
      const { syncHistoryFromServer } = await import('./history/historySync.js');
      await syncHistoryFromServer(state.activeId);
    } catch {}
  } catch (err) {
    setStatus('offline', 'нет соединения');
    toast(err.message || 'Не удалось подключиться. Откройте мини-приложение заново.');
  }
}

sendBtn.addEventListener('click', () => sendMessage());
inputEl.addEventListener('input', autoGrow);
inputEl.addEventListener('keydown', (e) => {
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !touch) {
    e.preventDefault();
    sendMessage();
  }
});

attachBtn.addEventListener('click', openAttachPicker);
attachRemoveBtn.addEventListener('click', clearAttachment);
fileRemoveBtn.addEventListener('click', clearFileAttachment);
videoRemoveBtn.addEventListener('click', clearVideoAttachment);
attachInput.addEventListener('change', () => {
  const file = attachInput.files && attachInput.files[0];
  if (file) void attachPickedFile(file);
});
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    e.preventDefault();
    void attachPickedFile(file);
    break;
  }
});
chatEl.addEventListener('dragover', (e) => e.preventDefault());
chatEl.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  e.preventDefault();
  void attachPickedFile(file);
});

chatMenuBtn.addEventListener('click', openChatMenu);
addChatBtn.addEventListener('click', () => void createChat());
menuRenameBtn.addEventListener('click', openRenameModal);
menuDeleteBtn.addEventListener('click', openDeleteModal);
menuClearBtn.addEventListener('click', openClearModal);
modelBtn.addEventListener('click', openModelModal);
modalOkBtn.addEventListener('click', () => void applyModal());
modalCancelBtn.addEventListener('click', () => closeModal());
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeModal();
});

document.addEventListener('click', (e) => {
  if (!chatMenuEl.contains(e.target) && !chatMenuBtn.contains(e.target)) hideChatMenu();
});
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('voiceDiscard').classList.contains('hidden')) return;
  if (state.profileOpen) return;
  if (!modalEl.classList.contains('hidden')) {
    const controls = [modalInputEl, modalCancelBtn, modalOkBtn].filter(
      (el) => el.style.display !== 'none' && !el.disabled,
    );
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
    if (e.key === 'Enter' && e.target === modalInputEl) {
      e.preventDefault();
      void applyModal();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const index = controls.indexOf(document.activeElement);
      controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
    return;
  }
  if (chatMenuEl.classList.contains('hidden')) return;
  const items = [menuRenameBtn, menuClearBtn, modelBtn, settingsBtn, menuDeleteBtn].filter(
    (el) => el.style.display !== 'none' && !el.disabled,
  );
  if (e.key === 'Escape' || e.key === 'Tab') {
    hideChatMenu(e.key === 'Escape');
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
});

chatEl.addEventListener('click', (e) => {
  const chip = e.target.closest && e.target.closest('.chip');
  if (chip) sendMessage(chip.getAttribute('data-suggest') || '');
});
chatEl.addEventListener('scroll', updateLatest, { passive: true });
latestBtn.addEventListener('click', scrollLatest);

function resize() {
  closeReactionPicker();
  const follow = latestBtn.classList.contains('hidden');
  syncViewport();
  if (follow) scrollLatest();
  else updateLatest();
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
if (tg && tg.onEvent) {
  for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) {
    try {
      tg.onEvent(event, resize);
    } catch (e) {
      /* Older Telegram clients. */
    }
  }
}
// Image/video dimensions can change after insertion without a viewport event.
function mediaLayoutChanged() {
  if (latestBtn.classList.contains('hidden')) scrollLatest();
  else updateLatest();
}
chatEl.addEventListener('load', mediaLayoutChanged, true);
chatEl.addEventListener('loadedmetadata', mediaLayoutChanged, true);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (latestBtn.classList.contains('hidden')) scrollLatest();
    else updateLatest();
  }).observe(chatEl);
}
resize();
initializeVoice();
initializeReactions();
void boot();
initializeProfile();
initializeCharacterProfile();
initializeLorebook();
initializeSettings();
initializeTheme();
