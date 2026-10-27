import type { RequestIdentity } from '../../server/requestIdentity.js';
import { profileStore } from '../profile/store.js';
import { readChatMetaRow, saveChatMetaRow } from './store.js';
import type { ChatMetaUpdate, SavedChatMeta } from './types.js';

export class ChatMetaConflict extends Error {}

// Anonymous dev identities stay memory-only, like profiles/settings.
const development = new Map<string, SavedChatMeta>();

function defaultMeta(): SavedChatMeta {
  return { tabs: [{ slot: 1, name: 'Диалог 1' }], activeSlot: 1, revision: 0, updatedAt: null };
}

export function readChatMeta(identity: RequestIdentity): SavedChatMeta {
  if (!identity.verified) {
    const saved = development.get(identity.historyKey);
    return saved ? structuredClone(saved) : defaultMeta();
  }
  return readChatMetaRow(profileStore().getDb(), identity.userId);
}

export function saveChatMeta(identity: RequestIdentity, update: ChatMetaUpdate): SavedChatMeta {
  if (!identity.verified) {
    const current = readChatMeta(identity);
    if (current.revision !== update.revision) throw new ChatMetaConflict();
    const saved: SavedChatMeta = {
      tabs: structuredClone(update.tabs),
      activeSlot: update.activeSlot,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    development.set(identity.historyKey, saved);
    while (development.size > 100) development.delete(development.keys().next().value!);
    return structuredClone(saved);
  }
  try {
    return saveChatMetaRow(profileStore().getDb(), identity.userId, update.tabs, update.activeSlot, update.revision);
  } catch (error) {
    if (error instanceof Error && error.name === 'ChatMetaConflict') throw new ChatMetaConflict();
    throw error;
  }
}
