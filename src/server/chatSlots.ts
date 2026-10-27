// Multi-chat slots: the Mini App supports up to 5 parallel chats per identity.
// Each slot holds its own dialog history, stored under "<historyKey>#c<slot>"
// (the same LRU map in session.ts, just more keys). Slots are independent of
// each other and of the classic bot-chat history (directly on historyKey).

export const MINIAPP_CHAT_SLOTS = 5;

/** Slot key suffix — keep in sync with the Mini App's localStorage keys. */
export function miniAppChatKey(historyKey: string, slot: number): string {
  return `${historyKey}#c${slot}`;
}

/**
 * Validate an optional multi-chat slot from the request body.
 * Returns the default slot (1) when omitted, the validated integer when
 * present, or null when the value is not an integer within 1..MAX.
 */
export function resolveChatSlot(raw: unknown): number | null {
  if (raw === undefined) return 1;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MINIAPP_CHAT_SLOTS ? raw : null;
}
