import type { RequestIdentity } from '../../server/requestIdentity.js';
import type { ChatMessage } from '../openrouter.js';
import { profileStore } from '../profile/store.js';
import { ProfileConflict } from '../profile/types.js';
import { primaryLorebook } from './primary.js';
import { buildLorebookContext } from './context.js';
import { emptyLorebook, LOREBOOK_LIMITS, type LorebookUpdate, type SavedLorebook } from './types.js';

const development = new Map<string, SavedLorebook>();
export function readLorebook(identity: RequestIdentity): SavedLorebook {
  return identity.verified
    ? profileStore().readLorebook(identity.userId)
    : structuredClone(development.get(identity.historyKey) ?? emptyLorebook());
}
export function saveLorebook(identity: RequestIdentity, update: LorebookUpdate): SavedLorebook {
  if (identity.verified) return profileStore().saveLorebook(identity.userId, update);
  const current = readLorebook(identity);
  if (current.revision !== update.revision) throw new ProfileConflict();
  const saved = {
    entries: structuredClone(update.entries),
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  development.delete(identity.historyKey);
  development.set(identity.historyKey, saved);
  while (development.size > 100) development.delete(development.keys().next().value!);
  return structuredClone(saved);
}
export function describeLorebook(identity: RequestIdentity) {
  return {
    ok: true,
    primary: primaryLorebook(),
    profile: { ...readLorebook(identity), verified: identity.verified },
    limits: LOREBOOK_LIMITS,
  };
}
export function getLorebookContext(identity: RequestIdentity, history: ChatMessage[], currentText: string) {
  return buildLorebookContext(Object.values(primaryLorebook()), readLorebook(identity).entries, history, currentText);
}
