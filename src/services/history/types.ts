import { z } from 'zod';
import type { ChatMessage } from '../openrouter.js';

// Stored history turn: model content plus display-only metadata.
// Reactions are never injected into model context (display only).
export interface StoredHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ChatMessage['content'];
  createdAt: string;
  userReaction: string | null;
  botReaction: string | null;
}

export const slotSchema = z.number().int().min(1).max(5);

export const messageIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[a-zA-Z0-9-]+$/);

export const reactionValueSchema = z.string().min(1).max(64).nullable();

export const historyListQuerySchema = z.object({
  chatId: z.coerce.number().int().min(1).max(5).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const reactionUpdateSchema = z
  .object({
    messageId: messageIdSchema,
    chatId: z.number().int().min(1).max(5),
    reaction: reactionValueSchema,
  })
  .strict();

export type ReactionUpdate = z.infer<typeof reactionUpdateSchema>;
