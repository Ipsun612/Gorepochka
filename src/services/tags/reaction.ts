import type { AssistantTagDefinition } from './types.js';

const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
// Only emoji components, never arbitrary text/markup. Includes flags and keycaps.
const components = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u200d\ufe0f0-9#*\u20e3]+$/u;

export function normalizeReaction(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const emoji = value.trim();
  if (!components.test(emoji) || !/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u20e3]/u.test(emoji)) return null;
  return [...segmenter.segment(emoji)].length === 1 ? emoji : null;
}

export const reactionTag: AssistantTagDefinition = {
  name: 'Поставить реакцию',
  parameterized: true,
  handle(context, argument) {
    let value = argument?.trim() ?? '';
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1).trim();
    const emoji = normalizeReaction(value);
    if (emoji) context.setUserReaction(emoji);
  },
};
