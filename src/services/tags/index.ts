import { getTypingDelayMs } from '../typingDelay.js';
import { splitMessageTag } from './splitMessage.js';
import { reactionTag } from './reaction.js';
import { tokenizeAssistantText } from './tokenize.js';
import type { AssistantTagContext, AssistantTagDefinition } from './types.js';

/** Register new tag modules here. Unregistered phrases are hidden, never executed. */
export const ASSISTANT_TAGS: readonly AssistantTagDefinition[] = [splitMessageTag, reactionTag];
const handlers = new Map(ASSISTANT_TAGS.filter((tag) => !tag.parameterized).map((tag) => [tag.name, tag]));
const parameterizedHandlers = ASSISTANT_TAGS.filter((tag) => tag.parameterized);

export interface AssistantReplyMessage {
  text: string;
  /** Wait after the preceding message, before showing this one. First is zero. */
  delayMs: number;
}

export interface ProcessedAssistantReply {
  /** Tag-free, backwards-compatible text and one assistant turn for model history. */
  reply: string;
  messages: AssistantReplyMessage[];
  /** Горепочка's reaction to the user turn that triggered this reply. */
  userReaction: string | null;
}

export function processAssistantReply(raw: string): ProcessedAssistantReply {
  const parts: string[] = [];
  let current: string[] = [];
  let userReaction: string | null = null;
  const flush = () => {
    const text = current.join('').trim();
    if (text) parts.push(text);
    current = [];
  };
  const context: AssistantTagContext = {
    splitMessage: flush,
    setUserReaction: (emoji) => {
      userReaction = emoji;
    },
  };

  for (const token of tokenizeAssistantText(raw)) {
    if (token.type === 'text') current.push(token.value);
    else {
      const exact = handlers.get(token.value);
      if (exact) exact.handle(context);
      else {
        const handler = parameterizedHandlers.find((tag) => token.value.startsWith(`${tag.name}: `));
        if (handler) handler.handle(context, token.value.slice(handler.name.length + 2));
      }
    }
  }
  flush();

  return {
    reply: parts.join('\n\n'),
    messages: parts.map((text, index) => ({ text, delayMs: index === 0 ? 0 : getTypingDelayMs(text) })),
    userReaction,
  };
}
