export type MediaKind = 'video' | 'video-note' | 'audio';

export interface SavedMedia {
  id: string;
  userId: number;
  slot: number;
  kind: MediaKind;
  name: string;
  size: number;
  bytes: number;
  duration: number;
  hasAudio: boolean;
  waveform: number[];
  poster: string | null;
  createdAt: string;
}
