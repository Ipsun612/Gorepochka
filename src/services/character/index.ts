import type { RequestIdentity } from '../../server/requestIdentity.js';
import { profileStore } from '../profile/store.js';
import { ProfileConflict } from '../profile/types.js';
import { CHARACTER, TRAITS, TRAIT_GROUPS, defaultTraits, characterInstructions } from './definition.js';
import { emptyCharacter, type CharacterUpdate, type SavedCharacter } from './types.js';

const development = new Map<string, SavedCharacter>();
export function readCharacter(identity: RequestIdentity): SavedCharacter {
  return identity.verified
    ? profileStore().readCharacter(identity.userId)
    : structuredClone(development.get(identity.historyKey) ?? emptyCharacter());
}
export function saveCharacter(identity: RequestIdentity, update: CharacterUpdate): SavedCharacter {
  if (identity.verified) return profileStore().saveCharacter(identity.userId, update);
  const current = readCharacter(identity);
  if (current.revision !== update.revision) throw new ProfileConflict();
  const saved = {
    traits: structuredClone(update.traits),
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  development.delete(identity.historyKey);
  development.set(identity.historyKey, saved);
  while (development.size > 100) development.delete(development.keys().next().value!);
  return structuredClone(saved);
}
export function describeCharacter(identity: RequestIdentity) {
  // Public catalog deliberately excludes model instructions/guidance and raw system prompts.
  return {
    ok: true,
    character: CHARACTER,
    profile: { ...readCharacter(identity), verified: identity.verified },
    groups: TRAIT_GROUPS,
    traits: TRAITS.map(({ guidance: _guidance, ...trait }) => trait),
    defaults: defaultTraits(),
  };
}
export function getCharacterInstructions(identity: RequestIdentity): string {
  return characterInstructions(readCharacter(identity).traits);
}
