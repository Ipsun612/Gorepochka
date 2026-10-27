/* Validate API/cache metadata without interpreting text as commands. */
const components = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u200d\ufe0f0-9#*\u20e3]+$/u;
const atom = '[\\p{Extended_Pictographic}\\p{Emoji_Presentation}]\\ufe0f?\\p{Emoji_Modifier}?';
const fallback = new RegExp(
  `^(?:${atom}(?:\\u200d${atom})*|[\\p{Regional_Indicator}]{2}|[0-9#*]\\ufe0f?\\u20e3)$`,
  'u',
);
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : null;

export function normalizeReaction(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const emoji = value.trim();
  if (!components.test(emoji) || !/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20e3]/u.test(emoji)) return null;
  return (segmenter ? [...segmenter.segment(emoji)].length === 1 : fallback.test(emoji)) ? emoji : null;
}
