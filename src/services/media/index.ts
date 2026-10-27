import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RequestIdentity } from '../../server/requestIdentity.js';
import { profileStore } from '../profile/store.js';
import {
  clearAllMedia,
  clearMediaSlot,
  getMediaRow,
  mediaFilePath,
  mediaRoot,
  pruneOrphanMedia,
  saveMediaRow,
} from './store.js';
import type { SavedMedia } from './types.js';

export function readMedia(identity: RequestIdentity, id: string): SavedMedia | null {
  if (!identity.verified) return null;
  try {
    return getMediaRow(profileStore().getDb(), identity.userId, id);
  } catch {
    return null;
  }
}

export function mediaBytesPath(media: SavedMedia, filename: string): string {
  return path.join(mediaRoot(), String(media.userId), String(media.slot), media.id, filename);
}

export async function persistVideoUpload(
  identity: RequestIdentity,
  slot: number,
  upload: {
    id: string;
    name: string;
    kind: 'attachment' | 'video-note';
    sourceBytes: number;
    bytes: number;
    duration: number;
    hasAudio: boolean;
    poster: string | null;
    directory: string;
  },
): Promise<SavedMedia | null> {
  if (!identity.verified) return null;
  const db = profileStore().getDb();
  const target = mediaFilePath(identity.userId, slot, upload.id, 'video.mp4');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.copyFile(path.join(upload.directory, 'video.mp4'), target);
  await fs.chmod(target, 0o600).catch(() => {});
  const saved = saveMediaRow(db, {
    id: upload.id,
    userId: identity.userId,
    slot,
    kind: upload.kind === 'video-note' ? 'video-note' : 'video',
    name: upload.name,
    size: upload.sourceBytes,
    bytes: upload.bytes,
    duration: upload.duration,
    hasAudio: upload.hasAudio,
    waveform: [],
    poster: upload.poster,
  });
  pruneOrphanMedia(db, identity.userId, slot);
  return saved;
}

export async function persistAudioUpload(
  identity: RequestIdentity,
  slot: number,
  upload: {
    id: string;
    sourceBytes: number;
    bytes: number;
    duration: number;
    waveform: number[];
    directory: string;
  },
): Promise<SavedMedia | null> {
  if (!identity.verified) return null;
  const db = profileStore().getDb();
  const target = mediaFilePath(identity.userId, slot, upload.id, 'audio.mp3');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.copyFile(path.join(upload.directory, 'audio.mp3'), target);
  await fs.chmod(target, 0o600).catch(() => {});
  const saved = saveMediaRow(db, {
    id: upload.id,
    userId: identity.userId,
    slot,
    kind: 'audio',
    name: 'Голосовое сообщение',
    size: upload.sourceBytes,
    bytes: upload.bytes,
    duration: upload.duration,
    hasAudio: true,
    waveform: upload.waveform,
    poster: null,
  });
  pruneOrphanMedia(db, identity.userId, slot);
  return saved;
}

export function pruneMediaForSlot(identity: RequestIdentity, slot: number): void {
  if (!identity.verified) return;
  try {
    pruneOrphanMedia(profileStore().getDb(), identity.userId, slot);
  } catch {
    /* best effort */
  }
}

export function clearMediaForSlot(identity: RequestIdentity, slot: number): void {
  if (!identity.verified) return;
  try {
    clearMediaSlot(profileStore().getDb(), identity.userId, slot);
  } catch {
    /* best effort */
  }
}

export function clearAllMediaForUser(identity: RequestIdentity): void {
  if (!identity.verified) return;
  try {
    clearAllMedia(profileStore().getDb(), identity.userId);
  } catch {
    /* best effort */
  }
}
