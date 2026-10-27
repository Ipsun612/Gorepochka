import { api, getClientId } from '../core/api.js';
import { tg, initData, syncTelegramColors, haptic } from '../core/telegram.js';
import { toast } from '../core/dom.js';

const control = document.getElementById('themeSwitch');
const status = document.getElementById('themeStatus');
const retry = document.getElementById('themeRetry');
let saved = null;
let loading = null;
let saving = false;
let initialized = false;
let transitionTimer;
const savedMessage = () => (initData ? 'Тема сохранена для вашего аккаунта.' : 'Тема сохранена в тестовой сессии.');

function cacheKey() {
  const id = tg?.initDataUnsafe?.user?.id;
  if (initData) return Number.isSafeInteger(id) && id > 0 ? `miniapp-theme-v1:tg:${id}` : null;
  return `miniapp-theme-v1:anon:${getClientId()}`;
}

function applyTheme(theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-changing');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => root.classList.remove('theme-changing'), 240);
  }
  root.setAttribute('data-theme', theme);
  document.getElementById('themeColor')?.setAttribute('content', theme === 'dark' ? '#202b38' : '#f7faff');
  syncTelegramColors(theme);
  control.checked = theme === 'dark';
}

function accept(data) {
  const value = data?.settings;
  if (!value || !['light', 'dark'].includes(value.theme) || !Number.isSafeInteger(value.revision) || value.revision < 0)
    throw new Error('Не удалось прочитать настройки. Попробуйте ещё раз.');
  saved = value;
  applyTheme(value.theme);
  try {
    const key = cacheKey();
    if (key) localStorage.setItem(key, value.theme);
  } catch (error) {
    /* The server remains the source of truth when local storage is blocked. */
  }
}

function showState(message, canRetry = false) {
  status.textContent = message;
  control.disabled = !saved || !!loading || saving;
  retry.classList.toggle('hidden', !canRetry);
}

export function refreshTheme() {
  if (saving) return Promise.resolve();
  if (loading) return loading;
  showState('Загрузка темы…');
  control.disabled = true;
  loading = (async () => {
    try {
      accept(await api('/api/settings'));
      showState(savedMessage());
    } catch (error) {
      saved = null;
      showState('Не удалось загрузить тему. Проверьте соединение.', true);
    } finally {
      loading = null;
      control.disabled = !saved || saving;
    }
  })();
  return loading;
}

async function changeTheme() {
  if (!saved || saving || loading) return;
  const previous = saved;
  const theme = control.checked ? 'dark' : 'light';
  if (theme === previous.theme) return;
  saving = true;
  applyTheme(theme, true);
  showState('Сохранение темы…');
  try {
    accept(await api('/api/settings', { theme, revision: previous.revision }));
    showState(savedMessage());
    haptic('success');
  } catch (error) {
    applyTheme(previous.theme, true);
    saved = null; // A lost response might still have been committed; reload before another write.
    showState('Не удалось сохранить тему. Загрузите актуальные настройки.', true);
    toast(
      error.code === 'SETTINGS_CONFLICT' ? 'Тема изменена на другом устройстве. Обновите настройки.' : error.message,
    );
    haptic('error');
  } finally {
    saving = false;
    control.disabled = !saved || !!loading;
  }
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  if (!initData) document.getElementById('themeDescription').textContent = 'Только для текущей тестовой сессии';
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  control.addEventListener('change', () => void changeTheme());
  retry.addEventListener('click', () => void refreshTheme());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshTheme();
  });
  void refreshTheme();
}
