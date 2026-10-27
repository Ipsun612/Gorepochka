/* Run before styles paint. This cache is only a hint; the authenticated server wins. */
try {
  const tg = window.Telegram?.WebApp;
  const id = tg?.initData && tg?.initDataUnsafe?.user?.id;
  const clientId = localStorage.getItem('miniapp-client-v1');
  const owner = Number.isSafeInteger(id) && id > 0 ? `tg:${id}` : !tg?.initData && clientId ? `anon:${clientId}` : '';
  if (owner && localStorage.getItem(`miniapp-theme-v1:${owner}`) === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeColor')?.setAttribute('content', '#202b38');
  }
} catch (error) {
  /* Unavailable localStorage: default to light until the server responds. */
}
