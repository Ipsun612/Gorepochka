import { config } from '../config/config.js';

export interface TypingDelayOptions {
  charactersPerSecond: number;
  minDelayMs: number;
  maxDelayMs: number;
}

/** Time to type the NEXT visible message; count Unicode code points, not bytes. */
export function getTypingDelayMs(
  text: string,
  options: TypingDelayOptions = {
    charactersPerSecond: config.AI_TYPING_CHARS_PER_SECOND,
    minDelayMs: config.AI_TYPING_MIN_DELAY_MS,
    maxDelayMs: config.AI_TYPING_MAX_DELAY_MS,
  },
): number {
  const typingMs = Math.ceil((Array.from(text).length * 1000) / options.charactersPerSecond);
  return Math.min(options.maxDelayMs, Math.max(options.minDelayMs, typingMs));
}
