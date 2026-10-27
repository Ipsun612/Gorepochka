import { api } from '../core/api.js';
import { haptic } from '../core/telegram.js';
import { state } from '../core/state.js';
import { toast, modalEl } from '../core/dom.js';
import { hideChatMenu } from '../chat/chatActions.js';
import { guardVoiceNavigation } from '../voice/voiceActions.js';
import { characterState as p, isCharacterDirty, validCharacterDraft } from './characterState.js';
import { characterEls as e, buildTraitControls, renderCharacter } from './characterRender.js';
import {
  registerProfileNavigation,
  requestProfileNavigation,
  showProfileScreen,
  hideProfileScreen,
  updateProfileClosingGuard,
} from '../profile/profileNavigation.js';

let initialized = false;
let loadPromise = null;
let pendingDiscard = null;
let discardFocus = null;

function accept(data) {
  if (
    !data.character ||
    !Array.isArray(data.traits) ||
    data.traits.length !== 15 ||
    !Array.isArray(data.groups) ||
    data.groups.length !== 3 ||
    !data.profile?.traits ||
    !Number.isSafeInteger(data.profile.revision) ||
    data.profile.revision < 0 ||
    !data.defaults ||
    new Set(data.traits.map((trait) => trait.id)).size !== 15 ||
    data.traits.some(
      (trait) =>
        !Array.isArray(trait.levels) ||
        trait.levels.length !== 3 ||
        !data.groups.some((group) => group.id === trait.group) ||
        ![0, 1, 2].includes(data.profile.traits[trait.id]) ||
        ![0, 1, 2].includes(data.defaults[trait.id]),
    )
  ) {
    throw new Error('Не удалось прочитать характер. Попробуйте ещё раз.');
  }
  p.loaded = data.profile;
  p.draft = { ...data.profile.traits };
  p.defaults = data.defaults;
  p.character = data.character;
  p.traits = data.traits;
  p.groups = data.groups;
  p.error = '';
  p.conflict = false;
  buildTraitControls((id, level) => {
    if (p.loading || p.saving) return;
    p.draft[id] = level;
    if (!p.conflict) p.error = '';
    renderCharacter();
    updateProfileClosingGuard();
  });
  renderCharacter();
  updateProfileClosingGuard();
}

export async function loadCharacterProfile() {
  if (loadPromise) return loadPromise;
  if (isCharacterDirty()) return;
  p.loading = true;
  renderCharacter();
  loadPromise = (async () => {
    try {
      accept(await api('/api/character-profile'));
    } catch (error) {
      p.error = error.message || 'Не удалось загрузить характер.';
    } finally {
      p.loading = false;
      loadPromise = null;
      renderCharacter();
    }
  })();
  return loadPromise;
}

export function openCharacterProfile() {
  if (p.open || state.managing || !modalEl.classList.contains('hidden')) return;
  if (state.profileOpen) {
    requestProfileNavigation('character');
    return;
  }
  if (!guardVoiceNavigation(openCharacterProfile)) return;
  hideChatMenu();
  if (!showProfileScreen('character', e.characterScreen, e.characterTitle)) return;
  p.open = true;
  renderCharacter();
  void loadCharacterProfile();
  haptic('light');
}

function keepEditing() {
  pendingDiscard = null;
  e.characterDiscard.classList.add('hidden');
  e.characterScreen.inert = false;
  (discardFocus && discardFocus.isConnected !== false ? discardFocus : e.characterBack).focus();
}
function confirmDiscard(action) {
  if (p.saving) return;
  if (!isCharacterDirty()) {
    action();
    return;
  }
  pendingDiscard = action;
  discardFocus = document.activeElement;
  e.characterScreen.inert = true;
  e.characterDiscard.classList.remove('hidden');
  e.characterKeepEditing.focus();
}
export function requestCloseCharacter(afterClose) {
  if (!p.open || p.saving) return;
  if (!e.characterDiscard.classList.contains('hidden')) {
    keepEditing();
    return;
  }
  confirmDiscard(() => {
    if (p.loaded) p.draft = { ...p.loaded.traits };
    p.error = '';
    p.conflict = false;
    p.open = false;
    hideProfileScreen('character', e.characterScreen, e.botAvatar);
    if (typeof afterClose === 'function') afterClose();
  });
}
export async function saveCharacterProfile() {
  if (!p.loaded || p.loading || p.saving || p.conflict || !isCharacterDirty() || !validCharacterDraft()) return;
  p.saving = true;
  p.error = '';
  renderCharacter();
  updateProfileClosingGuard();
  try {
    accept(await api('/api/character-profile', { traits: { ...p.draft }, revision: p.loaded.revision }));
    toast('Характер Горепочки сохранён');
    haptic('success');
  } catch (error) {
    p.error = error.message || 'Не удалось сохранить характер.';
    p.conflict = error.code === 'CHARACTER_CONFLICT';
    toast(p.error);
    haptic('error');
  } finally {
    p.saving = false;
    renderCharacter();
    updateProfileClosingGuard();
  }
}
export function resetCharacterDraft() {
  if (!p.loaded || p.loading || p.saving) return;
  p.draft = { ...p.defaults };
  renderCharacter();
  updateProfileClosingGuard();
}

export function initializeCharacterProfile() {
  if (initialized) return;
  initialized = true;
  registerProfileNavigation('character', {
    open: openCharacterProfile,
    requestClose: requestCloseCharacter,
    dirty: isCharacterDirty,
    saving: () => p.saving,
  });
  e.botAvatar.addEventListener('click', openCharacterProfile);
  e.characterBack.addEventListener('click', () => requestCloseCharacter());
  e.characterSave.addEventListener('click', () => void saveCharacterProfile());
  e.characterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveCharacterProfile();
  });
  e.characterReset.addEventListener('click', resetCharacterDraft);
  e.characterReload.addEventListener('click', () =>
    confirmDiscard(() => {
      if (p.loaded) p.draft = { ...p.loaded.traits };
      void loadCharacterProfile();
    }),
  );
  e.characterKeepEditing.addEventListener('click', keepEditing);
  e.characterDiscardConfirm.addEventListener('click', () => {
    const action = pendingDiscard;
    keepEditing();
    action?.();
  });
  document.addEventListener('keydown', (event) => {
    if (!p.open) return;
    if (!e.characterDiscard.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        keepEditing();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === e.characterKeepEditing
          ? e.characterDiscardConfirm
          : e.characterKeepEditing
        ).focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      requestCloseCharacter();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveCharacterProfile();
    }
  });
}
