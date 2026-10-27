import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../openrouter.js';
import type { StoredHistoryMessage } from './types.js';

export function initializeHistoryTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK(slot >= 1 AND slot <= 5),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    user_reaction TEXT,
    bot_reaction TEXT,
    created_at TEXT NOT NULL,
    seq INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_user_slot_seq ON chat_messages(user_id, slot, seq)`);
}

function parseContent(raw: string): ChatMessage['content'] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) return parsed as ChatMessage['content'];
    return String(raw);
  } catch {
    return raw;
  }
}

function toStored(row: {
  id: string;
  role: string;
  content: string;
  created_at: string;
  user_reaction: string | null;
  bot_reaction: string | null;
}): StoredHistoryMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: parseContent(row.content),
    createdAt: row.created_at,
    userReaction: row.user_reaction,
    botReaction: row.bot_reaction,
  };
}

export function nextHistorySeq(db: Database.Database, userId: number, slot: number): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) as maxSeq FROM chat_messages WHERE user_id = ? AND slot = ?')
    .get(String(userId), slot) as { maxSeq: number };
  return (row.maxSeq ?? 0) + 1;
}

export function listHistoryRows(
  db: Database.Database,
  userId: number,
  slot: number,
  limit: number,
): StoredHistoryMessage[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at, user_reaction, bot_reaction
       FROM chat_messages WHERE user_id = ? AND slot = ? ORDER BY seq DESC LIMIT ?`,
    )
    .all(String(userId), slot, limit) as Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    user_reaction: string | null;
    bot_reaction: string | null;
  }>;
  return rows.reverse().map(toStored);
}

export function appendHistoryRow(
  db: Database.Database,
  userId: number,
  slot: number,
  msg: ChatMessage,
  cap: number,
  existing?: { userReaction?: string | null; botReaction?: string | null },
): StoredHistoryMessage {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const seq = nextHistorySeq(db, userId, slot);
  db.prepare(
    `INSERT INTO chat_messages (id, user_id, slot, role, content, user_reaction, bot_reaction, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(userId),
    slot,
    msg.role,
    JSON.stringify(msg.content),
    existing?.userReaction ?? null,
    existing?.botReaction ?? null,
    createdAt,
    seq,
  );
  db.prepare(
    `DELETE FROM chat_messages WHERE user_id = ? AND slot = ? AND id NOT IN
     (SELECT id FROM chat_messages WHERE user_id = ? AND slot = ? ORDER BY seq DESC LIMIT ?)`,
  ).run(String(userId), slot, String(userId), slot, cap);
  return {
    id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    createdAt,
    userReaction: existing?.userReaction ?? null,
    botReaction: existing?.botReaction ?? null,
  };
}

export function clearHistorySlot(db: Database.Database, userId: number, slot: number): void {
  db.prepare('DELETE FROM chat_messages WHERE user_id = ? AND slot = ?').run(String(userId), slot);
}

export function clearAllHistory(db: Database.Database, userId: number): void {
  db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(String(userId));
}

export function setMessageReaction(
  db: Database.Database,
  userId: number,
  slot: number,
  messageId: string,
  which: 'userReaction' | 'botReaction',
  reaction: string | null,
): StoredHistoryMessage | null {
  const column = which === 'userReaction' ? 'user_reaction' : 'bot_reaction';
  const row = db
    .prepare('SELECT id FROM chat_messages WHERE id = ? AND user_id = ? AND slot = ?')
    .get(messageId, String(userId), slot) as { id: string } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE chat_messages SET ${column} = ? WHERE id = ?`).run(reaction, messageId);
  const updated = db
    .prepare(
      `SELECT id, role, content, created_at, user_reaction, bot_reaction
       FROM chat_messages WHERE id = ?`,
    )
    .get(messageId) as {
    id: string;
    role: string;
    content: string;
    created_at: string;
    user_reaction: string | null;
    bot_reaction: string | null;
  };
  return toStored(updated);
}
