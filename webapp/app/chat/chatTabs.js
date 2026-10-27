/* Chat tab bar rendering, switching and creation.
   The tab menu opens when tapping the active tab. */

import { state, MAX_CHATS } from '../core/state.js';
import {
  chatTabsEl,
  addChatBtn,
  chatMenuEl,
  menuRenameBtn,
  menuDeleteBtn,
  menuClearBtn,
  chatMenuBtn,
  modalOkBtn,
  modalCancelBtn,
  inputEl,
  toast,
  setManaging,
  setArchived,
} from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { api, chatPayload } from '../core/api.js';
import { findChat, saveChatMeta, removeSlot, defaultChatName, persist, isLiveSlot } from './chatState.js';
import { clearChatDom, restore } from './renderRestore.js';
import { clearAttachments } from './chatAttachments.js';
import { closeModal } from './chatModals.js';
import { guardVoiceNavigation } from '../voice/voiceNavigation.js';
import { closeReactionPicker } from '../reactions/reactions.js';

export function renderTabs() {
  chatTabsEl.innerHTML = '';
  for (const c of state.chats) {
    const tab = document.createElement('button');
    tab.className = `tab${c.id === state.activeId ? ' active' : ''}`;
    tab.setAttribute('aria-label', `Диалог: ${c.name}${!isLiveSlot(c.id) ? ' (архив)' : ''}`);
    if (c.id === state.activeId) tab.setAttribute('aria-current', 'true');
    tab.disabled = state.managing || state.sending;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = `${c.name}${!isLiveSlot(c.id) ? ' · архив' : ''}`;
    tab.appendChild(name);
    tab.addEventListener('click', (evt) => {
      if (c.id === state.activeId) {
        // stopPropagation keeps the "close menu on outside tap" document
        // listener from instantly closing the menu we are about to open.
        if (evt && evt.stopPropagation) evt.stopPropagation();
        openChatMenu();
        return;
      }
      switchChat(c.id);
    });
    chatTabsEl.appendChild(tab);
  }
  addChatBtn.disabled = state.managing || state.sending || state.chats.length >= MAX_CHATS;
  addChatBtn.title = state.chats.length >= MAX_CHATS ? `Можно создать до ${MAX_CHATS} диалогов` : 'Новый диалог';
  chatMenuBtn.disabled = state.managing || state.sending;
  setArchived(!isLiveSlot(state.activeId));
}

export function hideChatMenu(restoreFocus = false) {
  chatMenuEl.classList.add('hidden');
  chatMenuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) chatMenuBtn.focus();
}

export function openChatMenu() {
  if (state.sending || state.managing || state.profileOpen) return;
  if (!findChat(state.activeId)) return;
  closeReactionPicker();
  if (!chatMenuEl.classList.contains('hidden')) {
    hideChatMenu(true);
    return;
  }
  menuDeleteBtn.style.display = state.chats.length > 1 || !isLiveSlot(state.activeId) ? '' : 'none';
  menuClearBtn.disabled = !isLiveSlot(state.activeId);
  chatMenuEl.classList.remove('hidden');
  chatMenuBtn.setAttribute('aria-expanded', 'true');
  menuRenameBtn.focus();
  haptic('light');
}

export function switchChat(id) {
  if (id === state.activeId) return;
  if (state.sending || state.managing || !findChat(id)) return;
  if (!guardVoiceNavigation(() => switchChat(id))) return;
  persist(); // save the chat we are leaving
  hideChatMenu();
  closeModal(false);
  clearAttachments(); // don't carry a staged attachment into another chat
  state.activeId = id;
  saveChatMeta();
  clearChatDom();
  restore(id);
  renderTabs();
  haptic('light');
}

export function management(value) {
  state.managing = value;
  setManaging(value);
  modalOkBtn.disabled = value;
  modalCancelBtn.disabled = value;
  renderTabs();
}

export async function createChat() {
  if (
    !guardVoiceNavigation(() => {
      void createChat();
    })
  )
    return;
  if (state.chats.length >= MAX_CHATS) {
    toast(`Можно создать до ${MAX_CHATS} диалогов.`);
    haptic('error');
    return;
  }
  if (state.sending || state.managing) return;
  const id = Array.from({ length: MAX_CHATS }, (_, i) => i + 1).find((slot) => !findChat(slot));
  if (!id) return;
  management(true);
  try {
    // A slot is reusable only after the server has confirmed its history/media are clear.
    await api('/api/new', chatPayload(id));
    removeSlot(id);
    state.chats.push({ id, name: defaultChatName(id) });
    saveChatMeta();
    management(false);
    switchChat(id);
    toast('Новый диалог создан');
    inputEl.focus();
    haptic('success');
  } catch (err) {
    toast(err.message || 'Не удалось создать диалог');
  } finally {
    management(false);
  }
}
