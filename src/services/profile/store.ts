import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config.js';
import { emptyProfile, ProfileConflict, type ProfileUpdate, type SavedProfile } from './types.js';
import { emptyCharacter, traitsSchema, type CharacterUpdate, type SavedCharacter } from '../character/types.js';
import { emptyLorebook, userEntriesSchema, type LorebookUpdate, type SavedLorebook } from '../lorebook/types.js';
import { initializeSettingsTable, readSettingsRow, saveSettingsRow } from '../settings/store.js';
import { initializeHistoryTables } from '../history/store.js';
import { initializeChatMetaTables } from '../chatMeta/store.js';
import { initializeMediaTables } from '../media/store.js';
import type { SavedSettings, SettingsUpdate } from '../settings/types.js';

/** Synchronous, short transactions: no network work or awaits while holding a lock. */
export class ProfileStore {
  private db: Database.Database;
  constructor(filename: string) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 3000');
      this.db.exec(`CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        biography TEXT NOT NULL DEFAULT '',
        birthday TEXT,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS character_profiles (
        user_id TEXT PRIMARY KEY,
        traits TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS lorebook_entries (
        user_id TEXT PRIMARY KEY,
        entries TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      initializeSettingsTable(this.db);
      initializeHistoryTables(this.db);
      initializeChatMetaTables(this.db);
      initializeMediaTables(this.db);
      if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  read(userId: number): SavedProfile {
    const row = this.db
      .prepare('SELECT biography, birthday, revision, updated_at FROM user_profiles WHERE user_id = ?')
      .get(String(userId)) as
      { biography: string; birthday: string | null; revision: number; updated_at: string } | undefined;
    return row
      ? {
          biography: row.biography,
          birthday: row.birthday ? JSON.parse(row.birthday) : null,
          revision: row.revision,
          updatedAt: row.updated_at,
        }
      : emptyProfile();
  }

  save(userId: number, update: ProfileUpdate): SavedProfile {
    return this.db
      .transaction(() => {
        const current = this.read(userId);
        if (current.revision !== update.revision) throw new ProfileConflict();
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO user_profiles (user_id, biography, birthday, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        biography=excluded.biography, birthday=excluded.birthday, revision=excluded.revision, updated_at=excluded.updated_at`,
          )
          .run(
            String(userId),
            update.biography,
            update.birthday ? JSON.stringify(update.birthday) : null,
            current.revision + 1,
            now,
            now,
          );
        return this.read(userId);
      })
      .immediate();
  }

  readCharacter(userId: number): SavedCharacter {
    const row = this.db
      .prepare('SELECT traits, revision, updated_at FROM character_profiles WHERE user_id = ?')
      .get(String(userId)) as { traits: string; revision: number; updated_at: string } | undefined;
    return row
      ? { traits: traitsSchema.parse(JSON.parse(row.traits)), revision: row.revision, updatedAt: row.updated_at }
      : emptyCharacter();
  }

  saveCharacter(userId: number, update: CharacterUpdate): SavedCharacter {
    return this.db
      .transaction(() => {
        const current = this.readCharacter(userId);
        if (current.revision !== update.revision) throw new ProfileConflict();
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO character_profiles (user_id, traits, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        traits=excluded.traits, revision=excluded.revision, updated_at=excluded.updated_at`,
          )
          .run(String(userId), JSON.stringify(update.traits), current.revision + 1, now, now);
        return this.readCharacter(userId);
      })
      .immediate();
  }

  readLorebook(userId: number): SavedLorebook {
    const row = this.db
      .prepare('SELECT entries, revision, updated_at FROM lorebook_entries WHERE user_id = ?')
      .get(String(userId)) as { entries: string; revision: number; updated_at: string } | undefined;
    return row
      ? { entries: userEntriesSchema.parse(JSON.parse(row.entries)), revision: row.revision, updatedAt: row.updated_at }
      : emptyLorebook();
  }

  saveLorebook(userId: number, update: LorebookUpdate): SavedLorebook {
    return this.db
      .transaction(() => {
        const current = this.readLorebook(userId);
        if (current.revision !== update.revision) throw new ProfileConflict();
        const entries = userEntriesSchema.parse(update.entries);
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO lorebook_entries (user_id, entries, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        entries=excluded.entries, revision=excluded.revision, updated_at=excluded.updated_at`,
          )
          .run(String(userId), JSON.stringify(entries), current.revision + 1, now, now);
        return this.readLorebook(userId);
      })
      .immediate();
  }

  readSettings(userId: number): SavedSettings {
    return readSettingsRow(this.db, userId);
  }

  getDb(): Database.Database {
    return this.db;
  }

  saveSettings(userId: number, update: SettingsUpdate): SavedSettings {
    return saveSettingsRow(this.db, userId, update);
  }

  close(): void {
    this.db.close();
  }
}

let store: ProfileStore | undefined;
export function profileStore(): ProfileStore {
  return (store ??= new ProfileStore(config.PROFILE_DB_PATH));
}
export function closeProfileStore(): void {
  store?.close();
  store = undefined;
}
