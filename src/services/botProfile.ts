import { config } from '../config/config.js';
import { log } from '../utils/logger.js';

// Cached Telegram bot identity + avatar (profile photo).
// The Browser never sees TELEGRAM_BOT_TOKEN: the avatar bytes are proxied
// through GET /api/bot-avatar, and /api/meta only exposes a same-origin URL.

export interface BotAvatar {
  buffer: Buffer;
  contentType: string;
  /** file_unique_id of the profile photo — used as a cache-busting version. */
  version: string;
}

export interface BotProfile {
  name: string;
  username?: string;
  avatarVersion: string | null;
}

interface TelegramOk<T> {
  ok: true;
  result: T;
}

interface TelegramErr {
  ok: false;
  description?: string;
}

interface BotMe {
  id: number;
  first_name: string;
  username?: string;
}

interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface UserProfilePhotos {
  total_count: number;
  photos: PhotoSize[][];
}

interface FileInfo {
  file_path?: string;
}

const API_TIMEOUT_MS = 10000;
// Avatar changes rarely — cache for 6h, but never fail the Mini App if down.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cached: { profile: BotProfile; avatar: BotAvatar | null; fetchedAt: number } | null = null;
let inflight: Promise<void> | null = null;

function apiBase(): string {
  return `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;
}

function fileBase(): string {
  return `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}`;
}

async function botApi<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${apiBase()}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = (await res.json()) as TelegramOk<T> | TelegramErr;
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${'description' in data ? data.description : res.status}`);
    }
    return (data as TelegramOk<T>).result;
  } finally {
    clearTimeout(timer);
  }
}

function contentTypeFor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function refresh(): Promise<void> {
  if (inflight) {
    await inflight;
    return;
  }
  inflight = (async () => {
    const me = await botApi<BotMe>('getMe');
    let avatar: BotAvatar | null = null;
    let avatarVersion: string | null = null;
    try {
      const photos = await botApi<UserProfilePhotos>('getUserProfilePhotos', {
        user_id: String(me.id),
        limit: '1',
      });
      const largest = photos.photos[0]?.[photos.photos[0].length - 1];
      if (largest) {
        const file = await botApi<FileInfo>('getFile', { file_id: largest.file_id });
        // Do not let an upstream path change origin, query or directories.
        if (
          file.file_path &&
          /^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(file.file_path) &&
          !file.file_path.includes('..')
        ) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
          try {
            const dl = await fetch(`${fileBase()}/${file.file_path}`, {
              signal: ctrl.signal,
            });
            if (!dl.ok) throw new Error(`avatar download failed (${dl.status})`);
            const buf = Buffer.from(await dl.arrayBuffer());
            if (buf.length > 0) {
              avatarVersion = largest.file_unique_id;
              avatar = { buffer: buf, contentType: contentTypeFor(file.file_path), version: avatarVersion };
            }
          } finally {
            clearTimeout(timer);
          }
        }
      }
    } catch (err) {
      // No photo (or photo fetch failed) — identity still syncs, frontend shows the name initial.
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Could not fetch bot avatar, using fallback');
    }
    cached = {
      profile: { name: me.first_name, username: me.username, avatarVersion },
      avatar,
      fetchedAt: Date.now(),
    };
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** Bot display name/username + avatar version. Never throws — falls back to nulls. */
export async function getBotProfile(): Promise<BotProfile> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.profile;
  try {
    await refresh();
    return cached?.profile ?? { name: 'AI Assistant', avatarVersion: null };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Could not fetch bot profile, using fallback');
    if (cached) return cached.profile;
    return { name: 'AI Assistant', avatarVersion: null };
  }
}

/** Avatar image bytes, or null when the bot has no photo / fetch failed. Never throws. */
export async function getBotAvatar(): Promise<BotAvatar | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.avatar;
  try {
    await refresh();
    return cached?.avatar ?? null;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Could not fetch bot avatar, using fallback');
    return cached?.avatar ?? null;
  }
}
