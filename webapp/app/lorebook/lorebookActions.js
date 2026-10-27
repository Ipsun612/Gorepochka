import { api } from '../core/api.js';
import { haptic } from '../core/telegram.js';
import { state } from '../core/state.js';
import { toast, modalEl } from '../core/dom.js';
import { hideChatMenu } from '../chat/chatActions.js';
import { guardVoiceNavigation } from '../voice/voiceActions.js';
import { lorebookState as p, isLorebookDirty, validLorebookDraft } from './lorebookState.js';
import { lorebookEls as e, buildLorebookControls, renderLorebook, userLoreControls } from './lorebookRender.js';
import {
  registerProfileNavigation,
  requestProfileNavigation,
  showProfileScreen,
  hideProfileScreen,
  updateProfileClosingGuard,
} from '../profile/profileNavigation.js';

let initialized = false;
let loadPromise = null;
let pendingAction = null;
let dialogFocus = null;
function changed() {
  if (!p.conflict) p.error = '';
  renderLorebook();
  updateProfileClosingGuard();
}
function validEntry(entry) {
  return (
    entry &&
    typeof entry.comment === 'string' &&
    typeof entry.content === 'string' &&
    typeof entry.constant === 'boolean' &&
    Array.isArray(entry.key) &&
    entry.key.every((key) => typeof key === 'string') &&
    Object.keys(entry).sort().join(',') === 'comment,constant,content,key'
  );
}
function accept(data) {
  if (
    !data.primary ||
    Array.isArray(data.primary) ||
    typeof data.primary !== 'object' ||
    !Object.values(data.primary).every(validEntry) ||
    !data.profile ||
    !Array.isArray(data.profile.entries) ||
    data.profile.entries.length > 3 ||
    !data.profile.entries.every(validEntry) ||
    !Number.isSafeInteger(data.profile.revision) ||
    data.profile.revision < 0
  )
    throw new Error('Не удалось прочитать лорбук. Попробуйте ещё раз.');
  p.primary = data.primary;
  p.loaded = data.profile;
  p.draft = structuredClone(data.profile.entries);
  p.error = '';
  p.conflict = false;
  buildLorebookControls(changed, requestDeleteLoreEntry);
  changed();
}
export async function loadLorebook() {
  if (loadPromise) return loadPromise;
  if (isLorebookDirty()) return;
  p.loading = true;
  renderLorebook();
  loadPromise = (async () => {
    try {
      accept(await api('/api/lorebook'));
    } catch (error) {
      p.error = error.message || 'Не удалось загрузить лорбук.';
    } finally {
      p.loading = false;
      loadPromise = null;
      renderLorebook();
    }
  })();
  return loadPromise;
}
export function openLorebook() {
  if (p.open || state.managing || !modalEl.classList.contains('hidden')) return;
  if (state.profileOpen) {
    requestProfileNavigation('lorebook');
    return;
  }
  if (!guardVoiceNavigation(openLorebook)) return;
  hideChatMenu();
  e.lorebookBtn.focus();
  if (!showProfileScreen('lorebook', e.lorebookScreen, e.lorebookTitle)) return;
  p.open = true;
  renderLorebook();
  void loadLorebook();
  haptic('light');
}
function keepEditing() {
  pendingAction = null;
  e.lorebookDiscard.classList.add('hidden');
  e.lorebookScreen.inert = false;
  (dialogFocus && dialogFocus.isConnected !== false ? dialogFocus : e.lorebookBack).focus();
}
function confirmAction(action, deleting = false) {
  if (p.saving) return;
  pendingAction = action;
  dialogFocus = document.activeElement;
  e.lorebookDiscardTitle.textContent = deleting ? 'Удалить личную запись?' : 'Не сохранять изменения?';
  e.lorebookDiscardDescription.textContent = deleting
    ? 'Запись будет удалена из черновика. Нажмите «Сохранить», чтобы применить удаление.'
    : 'Изменения лорбука ещё не сохранены. Можно вернуться к редактированию.';
  e.lorebookDiscardConfirm.textContent = deleting ? 'Удалить' : 'Не сохранять';
  e.lorebookScreen.inert = true;
  e.lorebookDiscard.classList.remove('hidden');
  e.lorebookKeepEditing.focus();
}
export function requestCloseLorebook(afterClose) {
  if (!p.open || p.saving) return;
  if (!e.lorebookDiscard.classList.contains('hidden')) {
    keepEditing();
    return;
  }
  const close = () => {
    p.draft = structuredClone(p.loaded?.entries ?? []);
    p.error = '';
    p.conflict = false;
    p.open = false;
    buildLorebookControls(changed, requestDeleteLoreEntry);
    hideProfileScreen('lorebook', e.lorebookScreen, e.lorebookBtn);
    if (typeof afterClose === 'function') afterClose();
  };
  if (isLorebookDirty()) confirmAction(close);
  else close();
}
export function addLoreEntry() {
  if (!p.loaded || p.loading || p.saving || p.draft.length >= 3) return;
  p.draft.push({ key: [], comment: '', content: '', constant: false });
  buildLorebookControls(changed, requestDeleteLoreEntry);
  changed();
  userLoreControls.at(-1).comment.focus();
}
export function requestDeleteLoreEntry(index) {
  if (!p.loaded || p.loading || p.saving || !p.draft[index]) return;
  confirmAction(() => {
    p.draft.splice(index, 1);
    buildLorebookControls(changed, requestDeleteLoreEntry);
    changed();
    (userLoreControls[index]?.content ?? userLoreControls.at(-1)?.content ?? e.lorebookAdd).focus();
  }, true);
}
export async function saveLorebook() {
  if (!p.loaded || p.loading || p.saving || p.conflict || !isLorebookDirty() || !validLorebookDraft()) return;
  p.saving = true;
  p.error = '';
  renderLorebook();
  updateProfileClosingGuard();
  try {
    accept(await api('/api/lorebook', { entries: structuredClone(p.draft), revision: p.loaded.revision }));
    toast('Лорбук сохранён');
    haptic('success');
  } catch (error) {
    p.error = error.message || 'Не удалось сохранить лорбук.';
    p.conflict = error.code === 'LOREBOOK_CONFLICT';
    toast(p.error);
    haptic('error');
  } finally {
    p.saving = false;
    renderLorebook();
    updateProfileClosingGuard();
  }
}
export function initializeLorebook() {
  if (initialized) return;
  initialized = true;
  registerProfileNavigation('lorebook', {
    open: openLorebook,
    requestClose: requestCloseLorebook,
    dirty: isLorebookDirty,
    saving: () => p.saving,
  });
  e.lorebookBtn.addEventListener('click', openLorebook);
  e.lorebookBack.addEventListener('click', () => requestCloseLorebook());
  e.lorebookSave.addEventListener('click', () => void saveLorebook());
  e.lorebookForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveLorebook();
  });
  e.lorebookAdd.addEventListener('click', addLoreEntry);
  e.lorebookReload.addEventListener('click', () => {
    const reload = () => {
      p.draft = structuredClone(p.loaded?.entries ?? []);
      void loadLorebook();
    };
    if (isLorebookDirty()) confirmAction(reload);
    else reload();
  });
  e.lorebookKeepEditing.addEventListener('click', keepEditing);
  e.lorebookDiscardConfirm.addEventListener('click', () => {
    const action = pendingAction;
    keepEditing();
    action?.();
  });
  document.addEventListener('keydown', (event) => {
    if (!p.open) return;
    if (!e.lorebookDiscard.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        keepEditing();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === e.lorebookKeepEditing ? e.lorebookDiscardConfirm : e.lorebookKeepEditing).focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      requestCloseLorebook();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveLorebook();
    }
  });
}
