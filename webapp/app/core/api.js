/* Server API client + anonymous dev-mode session id. */

import { initData } from './telegram.js';
import { LS_CLIENT_KEY } from './state.js';

// Anonymous dev-mode session id (local storage, strict format server-side).
// Keeps each browser's history bucket isolated instead of one shared one.
export function getClientId() {
  let stored = null;
  try {
    stored = localStorage.getItem(LS_CLIENT_KEY);
  } catch (e) {}
  if (stored && /^[a-zA-Z0-9-]{8,64}$/.test(stored)) return stored;
  const bytes = new Uint8Array(12);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    // No WebCrypto (very old browser): mix time + Math.random; dev-mode only.
    try {
      console.warn('WebCrypto unavailable; using weak dev-mode client id');
    } catch (e) {}
    let seed = Date.now() % 2147483647;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 16807) % 2147483647;
      bytes[i] = ((Math.random() * 256) | 0) ^ (seed & 0xff);
    }
  }
  const id = `web-${Array.from(bytes, (x) => `000${x.toString(36)}`.slice(-3)).join('')}`;
  try {
    localStorage.setItem(LS_CLIENT_KEY, id);
  } catch (e) {}
  return id;
}

// Common payload for chat-scoped endpoints: chat slot only. Auth travels in
// headers (X-Telegram-Init-Data / X-Miniapp-Client-Id); bodies can be logged,
// cached and persisted, so bearer credentials must not be duplicated there.
export function chatPayload(chatId) {
  return { chatId };
}

export function apiHeaders(json = true) {
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  if (initData)
    headers['X-Telegram-Init-Data'] = initData; // server-side auth (GET + POST)
  else headers['X-Miniapp-Client-Id'] = getClientId();
  // ngrok's free-tier abuse-interstitial hijacks every request whose User-Agent
  // looks like a browser (which every Telegram webview's fetch() does), so this
  // header is required for the API to pass the tunnel. Ignored elsewhere.
  headers['ngrok-skip-browser-warning'] = 'true';
  return headers;
}

export async function api(path, body, options = {}) {
  const headers = apiHeaders();
  // Never hang forever: abort a stalled request so boot can show an explicit
  // error instead of staying stuck on "connecting…". Default comfortably
  // exceeds the server's OPENROUTER_TIMEOUT_MS (60s); media chat polling uses
  // fast job endpoints, while the initial chat POST may wait for the model.
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 75000;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const abort = () => {
    if (ctrl) ctrl.abort();
  };
  if (options.signal) {
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
  }
  let res;
  try {
    res = await fetch(path, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : options.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', abort);
    throw new Error(
      e && e.name === 'AbortError'
        ? 'Время ожидания истекло. Попробуйте ещё раз.'
        : 'Нет соединения с сервером. Проверьте интернет.',
    );
  }
  clearTimeout(timer);
  if (options.signal) options.signal.removeEventListener('abort', abort);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok || !data || data.ok !== true) {
    const friendly = {
      401: 'Откройте мини-приложение заново из Telegram.',
      403: 'Доступ к этому боту ограничен.',
      413: 'Файл слишком большой. Выберите файл поменьше.',
      429: 'Слишком много запросов. Подождите немного.',
    };
    const msg =
      friendly[res.status] || (data && data.error ? data.error : `Не удалось выполнить запрос (${res.status}).`);
    const error = new Error(msg);
    error.status = res.status;
    error.code = data && data.code;
    throw error;
  }
  return data;
}
