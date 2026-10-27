import type Database from 'better-sqlite3';
import { ProfileConflict } from '../profile/types.js';
import { themeSchema, type SettingsUpdate, type SavedSettings } from './types.js';

export function initializeSettingsTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    user_id TEXT PRIMARY KEY,
    theme TEXT NOT NULL CHECK(theme IN ('light', 'dark')),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

export function readSettingsRow(db: Database.Database, userId: number): SavedSettings {
  const row = db
    .prepare('SELECT theme, revision, updated_at FROM app_settings WHERE user_id = ?')
    .get(String(userId)) as { theme: string; revision: number; updated_at: string } | undefined;
  return row
    ? { theme: themeSchema.parse(row.theme), revision: row.revision, updatedAt: row.updated_at }
    : { theme: 'light', revision: 0, updatedAt: null };
}

export function saveSettingsRow(db: Database.Database, userId: number, update: SettingsUpdate): SavedSettings {
  return db
    .transaction(() => {
      const current = readSettingsRow(db, userId);
      if (current.revision !== update.revision) throw new ProfileConflict();
      db.prepare(
        `INSERT INTO app_settings (user_id, theme, revision, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, revision=excluded.revision, updated_at=excluded.updated_at`,
      ).run(String(userId), update.theme, current.revision + 1, new Date().toISOString());
      return readSettingsRow(db, userId);
    })
    .immediate();
}
