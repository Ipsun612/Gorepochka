/* Chat modal: rename input and delete/clear confirmations share one dialog. */

import { state } from '../core/state.js';
import {
  modalEl,
  modalTitleEl,
  modalInputEl,
  modalOkBtn,
  modalDescription,
  modalCancelBtn,
  chatMenuBtn,
  toast,
  focusModal,
} from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { api, chatPayload } from '../core/api.js';
import { findChat, saveChatMeta, removeSlot, defaultChatName, isLiveSlot } from './chatState.js';
import { renderTabs, switchChat, hideChatMenu, management } from './chatTabs.js';
import { newChat } from './chatSend.js';
import { guardVoiceNavigation } from '../voice/voiceNavigation.js';
import { closeReactionPicker } from '../reactions/reactions.js';

// --- Modal (rename input + delete confirm share one dialog) ---
export function closeModal(restoreFocus = true) {
  if (state.managing) return;
  const wasOpen = !modalEl.classList.contains('hidden');
  state.modalMode = null;
  modalEl.classList.add('hidden');
  modalInputEl.blur();
  if (wasOpen && restoreFocus) chatMenuBtn.focus();
}

function showModal(mode, title, description, withInput = false) {
  if (!guardVoiceNavigation(() => showModal(mode, title, description, withInput))) return false;
  if (state.sending || state.managing) return false;
  closeReactionPicker();
  state.modalMode = mode;
  modalTitleEl.textContent = title;
  modalDescription.textContent = description;
  modalInputEl.style.display = withInput ? '' : 'none';
  modalCancelBtn.style.display = mode === 'info' ? 'none' : '';
  modalOkBtn.disabled = false;
  modalOkBtn.className = `modal-btn ${mode === 'delete' || mode === 'clear' ? 'danger' : 'primary'}`;
  modalOkBtn.textContent = { rename: 'Сохранить', delete: 'Удалить', clear: 'Очистить', info: 'Понятно' }[mode];
  hideChatMenu();
  modalEl.classList.remove('hidden');
  focusModal();
  return true;
}

export function openRenameModal() {
  if (!guardVoiceNavigation(openRenameModal)) return;
  const chat = findChat(state.activeId);
  if (!chat) return;
  if (!showModal('rename', 'Название диалога', 'До 32 символов. Имя Горепочки останется прежним.', true)) return;
  modalInputEl.value = chat.name;
  modalInputEl.select();
}

export function openDeleteModal() {
  if (!guardVoiceNavigation(openDeleteModal)) return;
  if (state.chats.length <= 1 && isLiveSlot(state.activeId)) return;
  const chat = findChat(state.activeId);
  if (!chat) return;
  showModal('delete', `Удалить «${chat.name}»?`, 'Диалог и его история будут удалены. Это действие нельзя отменить.');
}

export function openClearModal() {
  if (!guardVoiceNavigation(openClearModal)) return;
  if (!isLiveSlot(state.activeId)) return;
  showModal(
    'clear',
    'Очистить историю?',
    'Все сообщения и прикреплённые видео и голосовые записи этого диалога будут удалены. Название диалога сохранится.',
  );
}

export function openModelModal() {
  if (!guardVoiceNavigation(openModelModal)) return;
  showModal(
    'info',
    'О модели',
    state.model
      ? `Текущая модель:\n${state.model}\n\nМодель задаётся на сервере. Возможность анализа фото, видео и голосовых сообщений зависит от её поддержки.`
      : 'Не удалось загрузить сведения о модели. Проверьте подключение и откройте мини-приложение заново.',
  );
}

export async function applyModal() {
  if (state.managing || state.sending) return;
  if (state.modalMode === 'rename') {
    const chat = findChat(state.activeId);
    const name = modalInputEl.value.trim().slice(0, 32);
    if (!name) {
      modalDescription.textContent = 'Введите название диалога.';
      modalInputEl.focus();
      return;
    }
    if (chat) {
      chat.name = name;
      saveChatMeta();
      renderTabs();
      haptic('success');
    }
    closeModal();
  } else if (state.modalMode === 'delete') {
    const chatId = state.activeId;
    const idx = state.chats.findIndex((c) => c.id === chatId);
    if (idx === -1) {
      closeModal();
      return;
    }
    management(true);
    try {
      if (isLiveSlot(chatId)) await api('/api/new', chatPayload(chatId));
      // Invalid legacy IDs were never accepted by the server. Only their local archive exists.
      if (state.chats.length === 1) await api('/api/new', chatPayload(1));
      state.chats.splice(idx, 1);
      removeSlot(chatId);
      if (!state.chats.length) {
        removeSlot(1);
        state.chats.push({ id: 1, name: defaultChatName(1) });
      }
      const next = state.chats[idx] || state.chats[idx - 1];
      state.activeId = null; // Do not persist the deleted DOM back into its released slot.
      saveChatMeta();
      management(false);
      switchChat(next.id);
      toast('Диалог удалён');
      haptic('success');
    } catch (err) {
      toast(err.message || 'Не удалось удалить диалог');
    } finally {
      management(false);
    }
  } else if (state.modalMode === 'clear') {
    if (await newChat()) closeModal();
  } else if (state.modalMode === 'info') {
    closeModal();
  }
}
