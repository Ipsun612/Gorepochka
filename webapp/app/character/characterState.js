/* Per-user character settings are memory-only in the browser, separate from chat caches. */
export const characterState = {
  open: false,
  loaded: null,
  draft: {},
  defaults: {},
  character: null,
  traits: [],
  groups: [],
  activeGroup: 'conversation',
  loading: false,
  saving: false,
  error: '',
  conflict: false,
};
export function isCharacterDirty() {
  return Boolean(
    characterState.loaded &&
    characterState.traits.some((trait) => characterState.draft[trait.id] !== characterState.loaded.traits[trait.id]),
  );
}
export function validCharacterDraft() {
  return (
    characterState.traits.length === 15 &&
    characterState.traits.every(
      (trait) =>
        Number.isInteger(characterState.draft[trait.id]) &&
        characterState.draft[trait.id] >= 0 &&
        characterState.draft[trait.id] <= 2,
    )
  );
}
