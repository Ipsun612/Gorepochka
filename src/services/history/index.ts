import type { RequestIdentity } from '../../server/requestIdentity.js';
import { config } from '../../config/config.js';
import type { ChatMessage } from '../openrouter.js';
import { profileStore } from '../profile/store.js';
import { appendHistoryRow, clearAllHistory, clearHistorySlot, listHistoryRows, setMessageReaction } from './store.js';
import { clearHistory, getStoredHistory, updateStoredReaction } from '../session.js';
import type { StoredHistoryMessage } from './types.js';

function cap(): number {
  return config.MAX_HISTORY_MESSAGES * 2;
}

function chatKeyFor(identity: RequestIdentity, slot: number): string {
  return `${identity.historyKey}#c${slot}`;
}

export function readHistory(identity: RequestIdentity, slot: number): StoredHistoryMessage[] {
  // Anonymous dev turns live in the session cache (single writer: POST /api/chat).
  if (!identity.verified) return getStoredHistory(chatKeyFor(identity, slot));
  return listHistoryRows(profileStore().getDb(), identity.userId, slot, cap());
}

export function appendHistoryEntry(
  identity: RequestIdentity,
  slot: number,
  msg: ChatMessage,
  existing?: { userReaction?: string | null; botReaction?: string | null },
): StoredHistoryMessage {
  if (!identity.verified) {
    throw new Error('Anonymous history is written via session cache');
  }
  return appendHistoryRow(profileStore().getDb(), identity.userId, slot, msg, cap(), existing);
}

export function clearHistoryEntries(identity: RequestIdentity, slot: number): void {
  if (!identity.verified) {
    clearHistory(chatKeyFor(identity, slot));
    return;
  }
  clearHistorySlot(profileStore().getDb(), identity.userId, slot);
}

export function clearAllHistoryEntries(identity: RequestIdentity): void {
  if (!identity.verified) {
    for (let slot = 1; slot <= 5; slot++) clearHistory(chatKeyFor(identity, slot));
    return;
  }
  clearAllHistory(profileStore().getDb(), identity.userId);
}

export function saveMessageReaction(
  identity: RequestIdentity,
  slot: number,
  messageId: string,
  which: 'userReaction' | 'botReaction',
  reaction: string | null,
): StoredHistoryMessage | null {
  if (!identity.verified) return updateStoredReaction(chatKeyFor(identity, slot), messageId, which, reaction);
  return setMessageReaction(profileStore().getDb(), identity.userId, slot, messageId, which, reaction);
}
