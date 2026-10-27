import sharp from 'sharp';
import { config } from '../../config/config.js';
import type { RequestIdentity } from '../../server/requestIdentity.js';

interface Photo {
  file_id: string;
  file_unique_id: string;
}
interface TelegramIdentity {
  displayName: string;
  username: string | null;
  avatarVersion: string | null;
  sync: { state: 'launch' | 'synced' | 'unavailable' | 'development'; syncedAt: string | null };
}
interface Entry {
  profile: TelegramIdentity;
  authDate: number;
  checkedAt: number;
  photo?: Photo;
  avatar?: Buffer;
  refreshing?: Promise<void>;
  downloading?: Promise<Buffer | null>;
}
const cache = new Map<number, Entry>();
const TTL = 5 * 60 * 1000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const clean = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .slice(0, 256)
        .trim()
    : '';

/** Fixed Telegram origin only. Never log the token-bearing URL or upstream error. */
async function telegramApi<T>(method: string, body: object): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const data = (await response.json()) as { ok?: boolean; result?: T };
    if (!response.ok || !data.ok || !data.result) throw new Error('Telegram unavailable');
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

function entryFor(identity: RequestIdentity): Entry {
  let entry = cache.get(identity.userId);
  if (!entry) {
    entry = {
      profile: { displayName: '', username: null, avatarVersion: null, sync: { state: 'launch', syncedAt: null } },
      authDate: -1,
      checkedAt: 0,
    };
    cache.set(identity.userId, entry);
  }
  if ((identity.authDate ?? 0) > entry.authDate) {
    entry.authDate = identity.authDate ?? 0;
    entry.profile.displayName = [clean(identity.user?.first_name), clean(identity.user?.last_name)]
      .filter(Boolean)
      .join(' ');
    entry.profile.username = clean(identity.user?.username) || null;
  }
  // LRU bound includes cached small re-encoded avatars.
  cache.delete(identity.userId);
  cache.set(identity.userId, entry);
  while (cache.size > 500) cache.delete(cache.keys().next().value!);
  return entry;
}

export function currentTelegramIdentity(identity: RequestIdentity): TelegramIdentity {
  if (!identity.verified)
    return {
      displayName: 'Локальный профиль',
      username: null,
      avatarVersion: null,
      sync: { state: 'development', syncedAt: null },
    };
  return structuredClone(entryFor(identity).profile);
}

export async function refreshTelegramIdentity(identity: RequestIdentity, force = false): Promise<void> {
  if (!identity.verified) return;
  const entry = entryFor(identity);
  if (entry.refreshing) return entry.refreshing;
  if (Date.now() - entry.checkedAt < (force ? 10000 : TTL)) return;
  entry.checkedAt = Date.now();
  entry.refreshing = (async () => {
    const [chat, photos] = await Promise.allSettled([
      telegramApi<{ id: number; type: string; first_name?: string; last_name?: string; username?: string }>('getChat', {
        chat_id: identity.userId,
      }),
      telegramApi<{ photos: Photo[][] }>('getUserProfilePhotos', { user_id: identity.userId, limit: 1 }),
    ]);
    if (chat.status === 'fulfilled' && chat.value.id === identity.userId && chat.value.type === 'private') {
      entry.profile.displayName = [clean(chat.value.first_name), clean(chat.value.last_name)].filter(Boolean).join(' ');
      entry.profile.username = clean(chat.value.username) || null;
      entry.profile.sync = { state: 'synced', syncedAt: new Date().toISOString() };
    } else entry.profile.sync.state = 'unavailable';
    if (photos.status === 'fulfilled') {
      // The smallest Telegram size is sufficient for this UI and bounds bandwidth.
      const photo = photos.value.photos[0]?.[0];
      if (photo?.file_unique_id !== entry.photo?.file_unique_id) entry.avatar = undefined;
      entry.photo = photo;
      entry.profile.avatarVersion = photo?.file_unique_id ?? null;
    } else entry.profile.sync.state = 'unavailable';
  })();
  try {
    await entry.refreshing;
  } finally {
    entry.refreshing = undefined;
  }
}

export async function getUserAvatar(identity: RequestIdentity): Promise<Buffer | null> {
  if (!identity.verified) return null;
  await refreshTelegramIdentity(identity);
  const entry = entryFor(identity);
  if (entry.avatar) return entry.avatar;
  const photo = entry.photo;
  if (!photo) return null;
  if (entry.downloading) return entry.downloading;
  entry.downloading = (async () => {
    try {
      const file = await telegramApi<{ file_path?: string }>('getFile', { file_id: photo.file_id });
      // Do not allow a path from upstream to change origin, query, or directories.
      if (!file.file_path || !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(file.file_path) || file.file_path.includes('..'))
        return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(
          `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
          { signal: controller.signal, redirect: 'error' },
        );
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_AVATAR_BYTES)
          return null;
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_AVATAR_BYTES) {
            await reader.cancel();
            return null;
          }
          chunks.push(value);
        }
        const avatar = await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000, animated: false })
          .rotate()
          .resize(256, 256, { fit: 'cover', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        if (entry.photo?.file_unique_id === photo.file_unique_id) entry.avatar = avatar;
        return avatar;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  })();
  try {
    return await entry.downloading;
  } finally {
    entry.downloading = undefined;
  }
}
