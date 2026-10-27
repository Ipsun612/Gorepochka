import { api, apiHeaders } from '../core/api.js';
import { haptic } from '../core/telegram.js';
import { state } from '../core/state.js';
import { toast, modalEl } from '../core/dom.js';
import { hideChatMenu } from '../chat/chatActions.js';
import { guardVoiceNavigation } from '../voice/voiceActions.js';
import { profileState, draftOf, isProfileDirty, profileValidation } from './profileState.js';
import { profileEls as e, renderProfile, renderDraft, renderUserAvatar } from './profileRender.js';
import {
  registerProfileNavigation,
  requestProfileNavigation,
  showProfileScreen,
  hideProfileScreen,
  updateProfileClosingGuard,
} from './profileNavigation.js';

let avatarUrl = '';
let avatarVersion = null;
let avatarController = null;
let avatarGeneration = 0;
let loadPromise = null;
let initialized = false;
let pendingDiscard = null;
let discardFocus = null;

function setClosingGuard() {
  updateProfileClosingGuard();
}

async function loadAvatar(profile) {
  // A failed image load is retryable on a later profile open/refresh.
  if (profile.avatarVersion === avatarVersion && (avatarUrl || !profile.avatarUrl)) {
    renderUserAvatar(avatarUrl);
    return;
  }
  avatarController?.abort();
  const generation = ++avatarGeneration;
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = '';
  avatarVersion = null;
  renderUserAvatar('');
  if (!profile.avatarUrl) return;
  const controller = new AbortController();
  avatarController = controller;
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/profile/avatar', {
      headers: apiHeaders(false),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return;
    const blob = await response.blob();
    if (generation !== avatarGeneration || controller.signal.aborted) return;
    avatarUrl = URL.createObjectURL(blob);
    avatarVersion = profile.avatarVersion;
    renderUserAvatar(avatarUrl);
  } catch (error) {
    /* The initials remain usable. */
  } finally {
    clearTimeout(timer);
  }
}

function accept(data, replaceDraft) {
  if (!data.profile || typeof data.profile.biography !== 'string' || !Number.isInteger(data.profile.revision)) {
    throw new Error('Не удалось прочитать ответ профиля. Попробуйте ещё раз.');
  }
  profileState.loaded = data.profile;
  if (data.limits) profileState.limits = data.limits;
  if (replaceDraft) profileState.draft = draftOf(data.profile);
  profileState.error = '';
  profileState.conflict = false;
  if (replaceDraft) renderDraft();
  else renderProfile();
  void loadAvatar(data.profile);
  setClosingGuard();
}

export async function loadUserProfile(force = false) {
  if (loadPromise) return loadPromise;
  profileState.loading = true;
  renderProfile();
  // Identity refresh never overwrites editable drafts or advances their revision.
  const dirty = isProfileDirty();
  loadPromise = (async () => {
    try {
      const data = force ? await api('/api/profile/sync', {}) : await api('/api/profile');
      if (dirty && profileState.loaded) {
        const current = profileState.loaded;
        profileState.loaded = {
          ...current,
          displayName: data.profile.displayName,
          username: data.profile.username,
          avatarUrl: data.profile.avatarUrl,
          avatarVersion: data.profile.avatarVersion,
          sync: data.profile.sync,
        };
        void loadAvatar(profileState.loaded);
      } else accept(data, true);
      if (!profileState.conflict) profileState.error = '';
    } catch (error) {
      profileState.error = error.message || 'Не удалось загрузить профиль.';
    } finally {
      profileState.loading = false;
      loadPromise = null;
      renderProfile();
    }
  })();
  return loadPromise;
}

export function openProfile() {
  if (profileState.open || state.managing || !modalEl.classList.contains('hidden')) return;
  if (state.profileOpen) {
    requestProfileNavigation('user');
    return;
  }
  if (!guardVoiceNavigation(openProfile)) return;
  hideChatMenu();
  if (!showProfileScreen('user', e.profileScreen, e.profileTitle)) return;
  profileState.open = true;
  renderDraft();
  e.profileTitle.focus();
  void loadUserProfile();
  haptic('light');
}

function closeProfile() {
  profileState.open = false;
  hideProfileScreen('user', e.profileScreen, e.profileBtn);
}

function confirmDiscard(action) {
  if (profileState.saving) return;
  if (!isProfileDirty()) {
    action();
    return;
  }
  pendingDiscard = action;
  discardFocus = document.activeElement;
  e.profileScreen.inert = true;
  e.profileDiscard.classList.remove('hidden');
  e.profileKeepEditing.focus();
}

function keepEditing() {
  pendingDiscard = null;
  e.profileDiscard.classList.add('hidden');
  e.profileScreen.inert = false;
  (discardFocus || e.profileBack).focus();
}

export function requestCloseProfile(afterClose) {
  if (!profileState.open || profileState.saving) return;
  if (!e.profileDiscard.classList.contains('hidden')) {
    keepEditing();
    return;
  }
  confirmDiscard(() => {
    if (profileState.loaded) profileState.draft = draftOf(profileState.loaded);
    profileState.error = '';
    profileState.conflict = false;
    setClosingGuard();
    closeProfile();
    if (typeof afterClose === 'function') afterClose();
  });
}

export async function saveUserProfile() {
  if (!profileState.loaded || profileState.loading || profileState.saving || profileState.conflict || !isProfileDirty())
    return;
  const invalid = profileValidation();
  if (invalid) {
    profileState.error = invalid;
    renderProfile();
    return;
  }
  profileState.saving = true;
  profileState.error = '';
  renderProfile();
  setClosingGuard();
  const d = profileState.draft;
  const birthday =
    d.day || d.month || d.year
      ? { day: Number(d.day), month: Number(d.month), ...(d.year ? { year: Number(d.year) } : {}) }
      : null;
  try {
    accept(
      await api('/api/profile', { biography: d.biography, birthday, revision: profileState.loaded.revision }),
      true,
    );
    toast('Профиль сохранён');
    haptic('success');
  } catch (error) {
    profileState.error = error.message || 'Не удалось сохранить профиль.';
    profileState.conflict = error.code === 'PROFILE_CONFLICT';
    toast(profileState.error);
    haptic('error');
  } finally {
    profileState.saving = false;
    renderProfile();
    setClosingGuard();
  }
}

export function handleProfileKeydown(event) {
  if (!profileState.open) return;
  if (!e.profileDiscard.classList.contains('hidden')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      keepEditing();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === e.profileKeepEditing ? e.profileDiscardConfirm : e.profileKeepEditing).focus();
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    requestCloseProfile();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void saveUserProfile();
  }
}

export function initializeProfile() {
  if (initialized) return;
  initialized = true;
  registerProfileNavigation('user', {
    open: openProfile,
    requestClose: requestCloseProfile,
    dirty: isProfileDirty,
    saving: () => profileState.saving,
  });
  e.profileBtn.addEventListener('click', openProfile);
  e.profileBack.addEventListener('click', requestCloseProfile);
  e.profileSave.addEventListener('click', () => void saveUserProfile());
  e.profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveUserProfile();
  });
  e.profileSync.addEventListener('click', () => {
    if (!profileState.saving) void loadUserProfile(true);
  });
  e.profileReload.addEventListener('click', () =>
    confirmDiscard(() => {
      if (profileState.loaded) profileState.draft = draftOf(profileState.loaded);
      void loadUserProfile();
    }),
  );
  e.profileClearBirthday.addEventListener('click', () => {
    profileState.draft = { ...profileState.draft, day: '', month: '', year: '' };
    renderDraft();
    setClosingGuard();
  });
  for (const [control, key] of [
    [e.profileBio, 'biography'],
    [e.profileDay, 'day'],
    [e.profileMonth, 'month'],
    [e.profileYear, 'year'],
  ]) {
    const edit = () => {
      profileState.draft[key] = control.value;
      if (!profileState.conflict) profileState.error = '';
      renderProfile();
      setClosingGuard();
    };
    control.addEventListener('input', edit);
    control.addEventListener('change', edit);
  }
  e.profileKeepEditing.addEventListener('click', keepEditing);
  e.profileDiscardConfirm.addEventListener('click', () => {
    const action = pendingDiscard;
    keepEditing();
    if (action) action();
  });
  document.addEventListener('keydown', handleProfileKeydown);
  window.addEventListener('pagehide', () => {
    avatarController?.abort();
    avatarGeneration++;
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    avatarUrl = '';
    avatarVersion = null;
  });
  void loadUserProfile();
}
