import type Database from 'better-sqlite3';
import type { ChatTab, SavedChatMeta } from './types.js';

export const DEFAULT_TAB_NAME = (slot: number): string => `Диалог ${slot}`;

export function initializeChatMetaTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_tabs (
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK(slot >= 1 AND slot <= 5),
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, slot)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_meta (
    user_id TEXT PRIMARY KEY,
    active_slot INTEGER NOT NULL CHECK(active_slot >= 1 AND active_slot <= 5),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

export function readChatMetaRow(db: Database.Database, userId: number): SavedChatMeta {
  const meta = db
    .prepare('SELECT active_slot, revision, updated_at FROM chat_meta WHERE user_id = ?')
    .get(String(userId)) as { active_slot: number; revision: number; updated_at: string } | undefined;
  const rows = db
    .prepare('SELECT slot, name FROM chat_tabs WHERE user_id = ? ORDER BY slot')
    .all(String(userId)) as Array<{ slot: number; name: string }>;
  if (!meta && rows.length === 0) {
    return { tabs: [{ slot: 1, name: DEFAULT_TAB_NAME(1) }], activeSlot: 1, revision: 0, updatedAt: null };
  }
  const tabs: ChatTab[] = rows.map((row) => ({ slot: row.slot, name: row.name.slice(0, 32) }));
  if (tabs.length === 0) tabs.push({ slot: 1, name: DEFAULT_TAB_NAME(1) });
  return {
    tabs,
    activeSlot: meta?.active_slot ?? tabs[0]?.slot ?? 1,
    revision: meta?.revision ?? 0,
    updatedAt: meta?.updated_at ?? null,
  };
}

export function saveChatMetaRow(
  db: Database.Database,
  userId: number,
  tabs: ChatTab[],
  activeSlot: number,
  revision: number,
): SavedChatMeta {
  return db.transaction(() => {
    const current = readChatMetaRow(db, userId);
    if (current.revision !== revision) {
      const conflict = new Error('CHAT_META_CONFLICT');
      conflict.name = 'ChatMetaConflict';
      throw conflict;
    }
    const now = new Date().toISOString();
    const existing = new Set(
      (db.prepare('SELECT slot FROM chat_tabs WHERE user_id = ?').all(String(userId)) as Array<{ slot: number }>).map(
        (row) => row.slot,
      ),
    );
    for (const tab of tabs) {
      db.prepare(
        `INSERT INTO chat_tabs (user_id, slot, name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, slot) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`,
      ).run(String(userId), tab.slot, tab.name.slice(0, 32), now);
      existing.delete(tab.slot);
    }
    for (const slot of existing) {
      db.prepare('DELETE FROM chat_tabs WHERE user_id = ? AND slot = ?').run(String(userId), slot);
    }
    db.prepare(
      `INSERT INTO chat_meta (user_id, active_slot, revision, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET active_slot=excluded.active_slot, revision=excluded.revision, updated_at=excluded.updated_at`,
    ).run(String(userId), activeSlot, current.revision + 1, now);
    return readChatMetaRow(db, userId);
  })();
}
