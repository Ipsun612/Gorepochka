/* Private drafts stay in memory, never in localStorage or chat caches. */
export const lorebookState = {
  open: false,
  loaded: null,
  primary: {},
  draft: [],
  loading: false,
  saving: false,
  error: '',
  conflict: false,
};
export const cleanLoreText = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim();
export const cleanLoreTitle = (text) => cleanLoreText(text).replace(/\n/g, ' ');
export const splitKeywords = (text) => text.split(/[,\n]/u).map(cleanLoreText).filter(Boolean);
export function isLorebookDirty() {
  return Boolean(
    lorebookState.loaded && JSON.stringify(lorebookState.draft) !== JSON.stringify(lorebookState.loaded.entries),
  );
}
export function validLorebookDraft() {
  return (
    lorebookState.draft.length <= 3 &&
    lorebookState.draft.every((entry) => {
      const content = cleanLoreText(entry.content);
      return (
        Array.from(cleanLoreTitle(entry.comment)).length <= 40 &&
        content.length > 0 &&
        Array.from(content).length <= 300 &&
        entry.key.length <= 10 &&
        entry.key.every((key) => Array.from(key).length <= 60 && key.normalize('NFKC').trim().length > 0) &&
        (entry.constant || entry.key.length > 0)
      );
    })
  );
}
