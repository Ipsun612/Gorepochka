import type { RequestIdentity } from '../../server/requestIdentity.js';
import { profileStore } from '../profile/store.js';
import { ProfileConflict } from '../profile/types.js';
import type { SavedSettings, SettingsUpdate } from './types.js';

// Development identities are browser-local and deliberately non-durable, like profiles.
const development = new Map<string, SavedSettings>();
export function readSettings(identity: RequestIdentity): SavedSettings {
  return identity.verified
    ? profileStore().readSettings(identity.userId)
    : { ...(development.get(identity.historyKey) ?? { theme: 'light', revision: 0, updatedAt: null }) };
}
export function saveSettings(identity: RequestIdentity, update: SettingsUpdate): SavedSettings {
  if (identity.verified) return profileStore().saveSettings(identity.userId, update);
  const current = readSettings(identity);
  if (current.revision !== update.revision) throw new ProfileConflict();
  const saved = { theme: update.theme, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  development.delete(identity.historyKey);
  development.set(identity.historyKey, saved);
  while (development.size > 100) development.delete(development.keys().next().value!);
  return { ...saved };
}
