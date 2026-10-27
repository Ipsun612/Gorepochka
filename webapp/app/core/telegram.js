/* Telegram Mini App SDK wrapper: init, initData access, haptics. */

export const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

export const initData = tg && tg.initData ? tg.initData : '';

export const userName =
  tg && tg.initDataUnsafe && tg.initDataUnsafe.user
    ? tg.initDataUnsafe.user.first_name || tg.initDataUnsafe.user.username || ''
    : '';

if (tg && initData) {
  try {
    tg.ready();
  } catch (e) {}
  try {
    tg.expand();
  } catch (e) {}
}

export function syncTelegramColors(theme) {
  const dark = theme === 'dark';
  const header = dark ? '#202b38' : '#f7faff';
  const background = dark ? '#17212b' : '#edf0fc';
  if (tg && initData && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) {
    try {
      tg.setHeaderColor(header);
    } catch (e) {}
    try {
      tg.setBackgroundColor(background);
    } catch (e) {}
  }
  if (tg && initData && tg.isVersionAtLeast && tg.isVersionAtLeast('7.10')) {
    try {
      tg.setBottomBarColor(background);
    } catch (e) {}
  }
}

export function syncViewport() {
  const root = document.documentElement;
  const heights = [
    tg && tg.viewportHeight,
    window.visualViewport && window.visualViewport.height,
    window.innerHeight,
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (heights.length) root.style.setProperty('--app-height', `${Math.min(...heights)}px`);
  if (tg && tg.safeAreaInset) {
    root.style.setProperty('--safe-top', `${tg.safeAreaInset.top || 0}px`);
    root.style.setProperty('--safe-bottom', `${tg.safeAreaInset.bottom || 0}px`);
  }
  if (tg && tg.contentSafeAreaInset) {
    root.style.setProperty('--content-top', `${tg.contentSafeAreaInset.top || 0}px`);
    root.style.setProperty('--content-bottom', `${tg.contentSafeAreaInset.bottom || 0}px`);
  }
}

export function haptic(kind) {
  try {
    if (tg && initData && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1') && tg.HapticFeedback) {
      if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
      else if (kind === 'error') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred('light');
    }
  } catch (e) {}
}

export function setProfileNavigation(visible) {
  try {
    if (tg && initData && tg.isVersionAtLeast?.('6.1')) {
      if (visible) tg.BackButton.show();
      else tg.BackButton.hide();
    }
  } catch (e) {
    /* Browser development and older Telegram clients. */
  }
}
