import { config } from '../config/config.js';
import type { ChatMessage } from './openrouter.js';
import { getSystemPrompt } from './prompts.js';
import { clearChatVideos } from './videos.js';
import { clearChatAudio } from './audio.js';
import { PROFILE_CONTEXT_INSTRUCTIONS } from './profile/context.js';
import { characterInstructions } from './character/definition.js';
import { withLorebookContext, type LorebookContext } from './lorebook/context.js';
import { profileStore } from './profile/store.js';
import {
  appendHistoryRow,
  clearAllHistory as clearAllHistoryRows,
  clearHistorySlot as clearHistorySlotRows,
  listHistoryRows,
  setMessageReaction as setMessageReactionRow,
} from './history/store.js';
import type { StoredHistoryMessage } from './history/types.js';
import { randomUUID } from 'node:crypto';

// --- Conversation history (durable SQLite for verified users, memory for anon) ---
// Keys are "<historyKey>#c<slot>": verified historyKey is a Telegram id ("12345"),
// anonymous dev keys are "anon:<clientId>". Verified turns persist in
// chat_messages and survive restarts/devices; anon stays process-local.
// The Map below is a hot LRU cache over SQLite, not the source of truth.
const MAX_CHATS = 10_000;

const histories = new Map<string, ChatMessage[]>();
const historyIds = new Map<string, StoredHistoryMessage[]>();

function parseChatKey(chatId: string): { userId: number | null; slot: number } {
  const hash = chatId.lastIndexOf('#c');
  if (hash < 0) return { userId: null, slot: 0 };
  const slot = Number(chatId.slice(hash + 2));
  const owner = chatId.slice(0, hash);
  const userId = /^\d+$/.test(owner) ? Number(owner) : null;
  const validSlot = Number.isInteger(slot) && slot >= 1 && slot <= 5 ? slot : 0;
  if (validSlot === 0) return { userId: null, slot: 0 };
  return { userId: userId !== null && Number.isSafeInteger(userId) ? userId : null, slot: validSlot };
}

function loadVerifiedHistory(chatId: string, userId: number, slot: number): ChatMessage[] {
  try {
    const rows = listHistoryRows(profileStore().getDb(), userId, slot, config.MAX_HISTORY_MESSAGES * 2);
    const messages = rows.map((row) => ({ role: row.role, content: row.content }) as ChatMessage);
    histories.set(chatId, messages);
    historyIds.set(chatId, rows);
    touch(chatId);
    return messages;
  } catch {
    return histories.get(chatId) ?? [];
  }
}

/** Refresh insertion order so "@history" acts as an LRU (oldest evicted). */
function touch(chatId: string): void {
  const existing = histories.get(chatId);
  if (existing !== undefined) {
    histories.delete(chatId);
    histories.set(chatId, existing);
  }
  const stored = historyIds.get(chatId);
  if (stored !== undefined) {
    historyIds.delete(chatId);
    historyIds.set(chatId, stored);
  }
}

export function getHistory(chatId: string): ChatMessage[] {
  const cached = histories.get(chatId);
  if (cached !== undefined) return cached;
  const { userId, slot } = parseChatKey(chatId);
  if (userId === null) return [];
  return loadVerifiedHistory(chatId, userId, slot);
}

export function getStoredHistory(chatId: string): StoredHistoryMessage[] {
  const cached = historyIds.get(chatId);
  if (cached !== undefined) return [...cached];
  const { userId, slot } = parseChatKey(chatId);
  if (userId === null) return [];
  try {
    const rows = listHistoryRows(profileStore().getDb(), userId, slot, config.MAX_HISTORY_MESSAGES * 2);
    histories.set(
      chatId,
      rows.map((row) => ({ role: row.role, content: row.content }) as ChatMessage),
    );
    historyIds.set(chatId, rows);
    touch(chatId);
    return [...rows];
  } catch {
    return [];
  }
}

export function updateStoredReaction(
  chatId: string,
  messageId: string,
  which: 'userReaction' | 'botReaction',
  reaction: string | null,
): StoredHistoryMessage | null {
  const { userId, slot } = parseChatKey(chatId);
  if (userId !== null) {
    try {
      const updated = setMessageReactionRow(profileStore().getDb(), userId, slot, messageId, which, reaction);
      if (updated) {
        const ids = (historyIds.get(chatId) ?? []).map((entry) => (entry.id === messageId ? updated : entry));
        historyIds.set(chatId, ids);
        touch(chatId);
      }
      return updated;
    } catch {
      return null;
    }
  }
  const list = historyIds.get(chatId);
  const found = list?.find((entry) => entry.id === messageId);
  if (!found) return null;
  if (which === 'userReaction') found.userReaction = reaction;
  else found.botReaction = reaction;
  touch(chatId);
  return { ...found };
}

export function appendHistory(
  chatId: string,
  msg: ChatMessage,
  existing?: { userReaction?: string | null; botReaction?: string | null },
): StoredHistoryMessage | null {
  // Mutate the cached array in place: smoke tests hold live references.
  const history = histories.get(chatId) ?? getHistory(chatId);
  if (!histories.has(chatId)) histories.set(chatId, history);
  history.push(msg);
  // Keep system prompt out of stored history; cap length (pairs of user+assistant).
  const cap = config.MAX_HISTORY_MESSAGES * 2;
  while (history.length > cap) history.shift();
  touch(chatId);
  const { userId, slot } = parseChatKey(chatId);
  let stored: StoredHistoryMessage | null = null;
  if (userId !== null) {
    try {
      stored = appendHistoryRow(profileStore().getDb(), userId, slot, msg, cap, existing);
    } catch {
      stored = null;
    }
  } else if (slot !== 0) {
    stored = {
      id: randomUUID(),
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      createdAt: new Date().toISOString(),
      userReaction: existing?.userReaction ?? null,
      botReaction: existing?.botReaction ?? null,
    };
  }
  if (stored) {
    const ids = [...(historyIds.get(chatId) ?? []), stored].slice(-cap);
    historyIds.set(chatId, ids);
    touch(chatId);
  } else if (userId === null) {
    historyIds.delete(chatId);
  } else {
    historyIds.delete(chatId);
  }
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
    historyIds.delete(firstKey);
    clearChatVideos(firstKey);
    clearChatAudio(firstKey);
  }
  return stored;
}

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
  historyIds.delete(chatId);
  const { userId, slot } = parseChatKey(chatId);
  if (userId !== null) {
    try {
      clearHistorySlotRows(profileStore().getDb(), userId, slot);
    } catch {
      /* SQLite unavailable: cache clear is enough for this request. */
    }
  }
  clearChatVideos(chatId);
  clearChatAudio(chatId);
}

export function clearAllVerifiedHistory(userId: number): void {
  try {
    clearAllHistoryRows(profileStore().getDb(), userId);
  } catch {
    /* best effort */
  }
  for (const key of [...histories.keys()]) {
    if (key === String(userId) || key.startsWith(`${userId}#c`)) {
      histories.delete(key);
      historyIds.delete(key);
      clearChatVideos(key);
      clearChatAudio(key);
    }
  }
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
