import { profileState, isProfileDirty, profileValidation } from './profileState.js';
import { refreshReactionAvatars } from '../reactions/reactions.js';

const el = (id) => document.getElementById(id);
export const profileEls = Object.fromEntries(
  [
    'chatScreen',
    'profileScreen',
    'profileBtn',
    'profileBack',
    'profileSave',
    'profileTitle',
    'profileName',
    'profileUsername',
    'profileTelegramName',
    'profileTelegramUsername',
    'profileStatus',
    'profileError',
    'profileReload',
    'profileSync',
    'profileForm',
    'profileFields',
    'profileBioFields',
    'profileDay',
    'profileMonth',
    'profileYear',
    'profileBio',
    'profileCounter',
    'profileClearBirthday',
    'profileDiscard',
    'profileKeepEditing',
    'profileDiscardConfirm',
  ].map((id) => [id, el(id)]),
);

export function renderProfile() {
  const p = profileState;
  const e = profileEls;
  const profile = p.loaded;
  const invalid = profileValidation();
  const locked = !profile || p.loading || p.saving;
  e.profileFields.disabled = locked;
  e.profileBioFields.disabled = locked;
  e.profileSave.disabled = locked || !isProfileDirty() || Boolean(invalid) || p.conflict;
  e.profileSave.textContent = p.saving ? 'Сохранение…' : 'Сохранить';
  e.profileBack.disabled = p.saving;
  e.profileSync.disabled = p.loading || p.saving || !profile?.verified;
  e.profileReload.disabled = p.loading || p.saving;
  e.profileReload.classList.toggle('hidden', !p.error && !p.conflict);
  const error = p.error || invalid;
  e.profileError.textContent = error;
  e.profileError.classList.toggle('hidden', !error);
  const count = Array.from(p.draft.biography).length;
  e.profileCounter.textContent = `${count} / ${p.limits.biographyMaxChars}`;
  e.profileBio.setAttribute('aria-invalid', String(count > p.limits.biographyMaxChars));
  for (const field of [e.profileDay, e.profileMonth, e.profileYear])
    field.setAttribute('aria-invalid', String(Boolean(invalid) && count <= p.limits.biographyMaxChars));
  e.profileYear.max = String(p.limits.birthdayMaxYear);
  if (profile) {
    const name = profile.displayName || 'Пользователь Telegram';
    const username = profile.username ? `@${profile.username}` : '';
    e.profileName.textContent = name;
    e.profileUsername.textContent = username;
    e.profileTelegramName.textContent = profile.displayName || 'Не указано';
    e.profileTelegramUsername.textContent = username || 'Не задано';
    e.profileStatus.textContent = p.loading
      ? 'Обновление профиля…'
      : p.saving
        ? 'Сохранение изменений…'
        : !profile.verified
          ? 'Локальный тестовый профиль: данные исчезнут после перезапуска сервера.'
          : profile.sync?.state === 'unavailable'
            ? 'Telegram сейчас недоступен. Показаны последние доступные данные; фото может быть скрыто настройками приватности.'
            : profile.sync?.state === 'launch'
              ? 'Данные из Telegram при открытии приложения.'
              : 'Данные синхронизированы с Telegram';
  } else e.profileStatus.textContent = p.loading ? 'Загрузка профиля…' : 'Профиль не загружен. Повторите попытку.';
}

export function renderDraft() {
  const { draft } = profileState;
  profileEls.profileBio.value = draft.biography;
  profileEls.profileDay.value = draft.day;
  profileEls.profileMonth.value = draft.month;
  profileEls.profileYear.value = draft.year;
  renderProfile();
}

export function renderUserAvatar(url) {
  const name = profileState.loaded?.displayName || 'Я';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase();
  for (const id of ['profileAvatar', 'profileButtonAvatar']) {
    const target = el(id);
    target.textContent = initials;
    if (url) {
      const image = document.createElement('img');
      image.alt = '';
      image.onerror = () => {
        target.textContent = initials;
      };
      image.src = url;
      target.textContent = '';
      target.appendChild(image);
    }
  }
  refreshReactionAvatars();
}
