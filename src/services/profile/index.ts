import type { RequestIdentity } from '../../server/requestIdentity.js';
import { profileStore } from './store.js';
import { currentTelegramIdentity, refreshTelegramIdentity } from './telegram.js';
import { emptyProfile, ProfileConflict, type ProfileUpdate, type SavedProfile } from './types.js';

// Anonymous browser profiles are isolated, bounded and deliberately non-durable.
const development = new Map<string, SavedProfile>();
export function readSavedProfile(identity: RequestIdentity): SavedProfile {
  return identity.verified
    ? profileStore().read(identity.userId)
    : structuredClone(development.get(identity.historyKey) ?? emptyProfile());
}
export function saveProfile(identity: RequestIdentity, update: ProfileUpdate): SavedProfile {
  if (identity.verified) return profileStore().save(identity.userId, update);
  const current = readSavedProfile(identity);
  if (current.revision !== update.revision) throw new ProfileConflict();
  const saved = {
    biography: update.biography,
    birthday: update.birthday,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  development.set(identity.historyKey, saved);
  while (development.size > 100) development.delete(development.keys().next().value!);
  return structuredClone(saved);
}
export function describeProfile(identity: RequestIdentity) {
  const telegram = currentTelegramIdentity(identity);
  return {
    ...readSavedProfile(identity),
    ...telegram,
    verified: identity.verified,
    avatarUrl: telegram.avatarVersion ? '/api/profile/avatar' : null,
  };
}
export async function loadProfile(identity: RequestIdentity, force = false) {
  await refreshTelegramIdentity(identity, force);
  return describeProfile(identity);
}
