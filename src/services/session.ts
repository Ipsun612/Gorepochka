import { config } from '../config/config.js';
import type { ChatMessage } from './openrouter.js';
import { getSystemPrompt } from './prompts.js';
import { clearChatVideos } from './videos.js';
import { clearChatAudio } from './audio.js';
import { PROFILE_CONTEXT_INSTRUCTIONS } from './profile/context.js';
import { characterInstructions } from './character/definition.js';
import { withLorebookContext, type LorebookContext } from './lorebook/context.js';

// --- Conversation history (in-memory, per identity key) ---
// Keys are strings: a verified user's Telegram id ("12345") or an anonymous
// dev client's isolated key ("anon:<clientId>"). Scoped per browser by design.
// For multi-instance / production use, replace with Redis.
const MAX_CHATS = 10_000;

const histories = new Map<string, ChatMessage[]>();

/** Refresh insertion order so "@history" acts as an LRU (oldest evicted). */
function touch(chatId: string): void {
  const existing = histories.get(chatId);
  if (existing !== undefined) {
    histories.delete(chatId);
    histories.set(chatId, existing);
  }
}

export function getHistory(chatId: string): ChatMessage[] {
  return histories.get(chatId) ?? [];
}

export function appendHistory(chatId: string, msg: ChatMessage): void {
  const history = histories.get(chatId) ?? [];
  history.push(msg);
  // Keep system prompt out of stored history; cap length (pairs of user+assistant).
  const cap = config.MAX_HISTORY_MESSAGES * 2;
  while (history.length > cap) history.shift();
  touch(chatId);
  histories.set(chatId, history);
  clearChatVideos(
    chatId,
    new Set(
      history.flatMap((entry) =>
        typeof entry.content === 'string'
          ? []
          : entry.content.flatMap((part) => (part.type === 'video_ref' ? [part.videoId] : [])),
      ),
    ),
  );
  clearChatAudio(
    chatId,
    new Set(
      history.flatMap((entry) =>
        typeof entry.content === 'string'
          ? []
          : entry.content.flatMap((part) => (part.type === 'audio_ref' ? [part.audioId] : [])),
      ),
    ),
  );

  // Hard bound: evict least-recently-used identities instead of growing forever.
  while (histories.size > MAX_CHATS) {
    const firstKey = histories.keys().next().value;
    if (firstKey === undefined) break;
    histories.delete(firstKey);
    clearChatVideos(firstKey);
    clearChatAudio(firstKey);
  }
}

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
  clearChatVideos(chatId);
  clearChatAudio(chatId);
}

export function buildMessages(
  chatId: string,
  profileContext?: ChatMessage,
  characterContext = characterInstructions(),
  lorebook?: LorebookContext,
  currentContent?: ChatMessage['content'],
): ChatMessage[] {
  touch(chatId);
  return [
    {
      role: 'system',
      content:
        getSystemPrompt() +
        characterContext +
        (profileContext ? `\n\n${PROFILE_CONTEXT_INSTRUCTIONS}` : '') +
        (lorebook?.system ?? ''),
    },
    ...getHistory(chatId),
    ...(profileContext ? [profileContext] : []),
    ...(currentContent === undefined
      ? []
      : [{ role: 'user' as const, content: withLorebookContext(currentContent, lorebook) }]),
  ];
}

// --- Simple sliding-window rate limiter (per Telegram user) ---
const MAX_TRACKED_IDENTITIES = 50_000;

const hits = new Map<string, number[]>();

export function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - config.RATE_LIMIT_WINDOW_MS;
  const times = (hits.get(userId) ?? []).filter((t) => t > windowStart);
  times.push(now);
  // Re-set refreshes insertion order (LRU-friendly eviction below).
  hits.set(userId, times);
  return times.length > config.RATE_LIMIT_MAX_REQUESTS;
}

// Periodic cleanup so the maps don't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    const fresh = v.filter((t) => now - t < config.RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) hits.delete(k);
    else hits.set(k, fresh);
  }
  // Bound the rate-limiter map as well (evict oldest by insertion order).
  while (hits.size > MAX_TRACKED_IDENTITIES) {
    const firstKey = hits.keys().next().value;
    if (firstKey === undefined) break;
    hits.delete(firstKey);
  }
}, 60_000).unref();
