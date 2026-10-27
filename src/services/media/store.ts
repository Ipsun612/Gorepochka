import type Database from 'better-sqlite3';
import fs from 'node:fs';
import { promises as afs } from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config.js';
import type { MediaKind, SavedMedia } from './types.js';

export function initializeMediaTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK(slot >= 1 AND slot <= 5),
    kind TEXT NOT NULL CHECK(kind IN ('video', 'video-note', 'audio')),
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    duration REAL NOT NULL,
    has_audio INTEGER NOT NULL,
    waveform TEXT NOT NULL,
    poster TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_media_user_slot ON chat_media(user_id, slot)`);
}

export function mediaRoot(): string {
  const dir = path.resolve(config.MEDIA_DIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function mediaFilePath(userId: number, slot: number, id: string, filename: string): string {
  return path.join(mediaRoot(), String(userId), String(slot), id, filename);
}

function toSaved(row: {
  id: string;
  user_id: string;
  slot: number;
  kind: string;
  name: string;
  size: number;
  bytes: number;
  duration: number;
  has_audio: number;
  waveform: string;
  poster: string | null;
  created_at: string;
}): SavedMedia {
  return {
    id: row.id,
    userId: Number(row.user_id),
    slot: row.slot,
    kind: row.kind as MediaKind,
    name: row.name,
    size: row.size,
    bytes: row.bytes,
    duration: row.duration,
    hasAudio: row.has_audio === 1,
    waveform: JSON.parse(row.waveform) as number[],
    poster: row.poster,
    createdAt: row.created_at,
  };
}

export function getMediaRow(db: Database.Database, userId: number, id: string): SavedMedia | null {
  const row = db
    .prepare(
      `SELECT id, user_id, slot, kind, name, size, bytes, duration, has_audio, waveform, poster, created_at
       FROM chat_media WHERE id = ? AND user_id = ?`,
    )
    .get(id, String(userId)) as
    | {
        id: string;
        user_id: string;
        slot: number;
        kind: string;
        name: string;
        size: number;
        bytes: number;
        duration: number;
        has_audio: number;
        waveform: string;
        poster: string | null;
        created_at: string;
      }
    | undefined;
  return row ? toSaved(row) : null;
}

export function saveMediaRow(
  db: Database.Database,
  media: Omit<SavedMedia, 'createdAt'> & { createdAt?: string },
): SavedMedia {
  const createdAt = media.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_media (id, user_id, slot, kind, name, size, bytes, duration, has_audio, waveform, poster, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET slot=excluded.slot, kind=excluded.kind, name=excluded.name,
       size=excluded.size, bytes=excluded.bytes, duration=excluded.duration, has_audio=excluded.has_audio,
       waveform=excluded.waveform, poster=excluded.poster`,
  ).run(
    media.id,
    String(media.userId),
    media.slot,
    media.kind,
    media.name,
    media.size,
    media.bytes,
    media.duration,
    media.hasAudio ? 1 : 0,
    JSON.stringify(media.waveform ?? []),
    media.poster ?? null,
    createdAt,
  );
  return { ...media, createdAt };
}

export function deleteMediaById(db: Database.Database, userId: number, id: string): void {
  const row = db.prepare('SELECT slot FROM chat_media WHERE id = ? AND user_id = ?').get(id, String(userId)) as
    { slot: number } | undefined;
  db.prepare('DELETE FROM chat_media WHERE id = ? AND user_id = ?').run(id, String(userId));
  if (row) {
    void afs
      .rm(path.join(mediaRoot(), String(userId), String(row.slot), id), { recursive: true, force: true })
      .catch(() => {});
  }
}

function collectReferencedIds(db: Database.Database, userId: number, slot: number): Set<string> {
  const rows = db
    .prepare('SELECT content FROM chat_messages WHERE user_id = ? AND slot = ?')
    .all(String(userId), slot) as Array<{ content: string }>;
  const ids = new Set<string>();
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content) as unknown;
      if (!Array.isArray(content)) continue;
      for (const part of content as Array<{ type?: string; videoId?: string; audioId?: string }>) {
        if (part?.type === 'video_ref' && typeof part.videoId === 'string') ids.add(part.videoId);
        if (part?.type === 'audio_ref' && typeof part.audioId === 'string') ids.add(part.audioId);
      }
    } catch {
      /* ignore malformed history */
    }
  }
  return ids;
}

export function pruneOrphanMedia(db: Database.Database, userId: number, slot: number): void {
  const keep = collectReferencedIds(db, userId, slot);
  const rows = db
    .prepare('SELECT id FROM chat_media WHERE user_id = ? AND slot = ?')
    .all(String(userId), slot) as Array<{ id: string }>;
  for (const row of rows) {
    if (!keep.has(row.id)) deleteMediaById(db, userId, row.id);
  }
}

export function clearMediaSlot(db: Database.Database, userId: number, slot: number): void {
  db.prepare('DELETE FROM chat_media WHERE user_id = ? AND slot = ?').run(String(userId), slot);
  void afs.rm(path.join(mediaRoot(), String(userId), String(slot)), { recursive: true, force: true }).catch(() => {});
}

export function clearAllMedia(db: Database.Database, userId: number): void {
  db.prepare('DELETE FROM chat_media WHERE user_id = ?').run(String(userId));
  void afs.rm(path.join(mediaRoot(), String(userId)), { recursive: true, force: true }).catch(() => {});
}
