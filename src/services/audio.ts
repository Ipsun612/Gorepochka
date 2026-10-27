import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { config } from '../config/config.js';
import { UserFacingError, type ChatMessage } from './openrouter.js';
import { ffmpegPath, ffprobePath } from './videos.js';

export interface AudioUpload {
  id: string;
  owner: string;
  chatKey: string;
  state: 'uploading' | 'preparing' | 'ready' | 'failed';
  sourceBytes: number;
  bytes: number;
  duration: number;
  waveform: number[];
  expiresAt: number;
  error?: string;
  directory: string;
  controller: AbortController;
  committed: boolean;
  pins: number;
  receiving: boolean;
  reserved: boolean;
}

const uploads = new Map<string, AudioUpload>();
const running = new Set<Promise<void>>();
let active = 0;
// Created lazily: importing the server does not create unused audio directories.
let root: Promise<string> | undefined;
function storageRoot(): Promise<string> {
  return (root ??= fs.mkdtemp(path.join(os.tmpdir(), 'telegram-miniapp-audio-')).then(async (dir) => {
    await fs.chmod(dir, 0o700).catch(() => {});
    return dir;
  }));
}

/** No shell, external protocols, playlists, or unbounded decoder output. */
function run(binary: string, args: string[], signal: AbortSignal, limit = 1024 * 1024): Promise<Buffer> {
  if (signal.aborted) return Promise.reject(new UserFacingError('Обработка аудио отменена.'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    let timedOut = false;
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, config.AUDIO_PROCESS_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        exceeded = true;
        abort();
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      finish();
      reject(new UserFacingError('Инструменты обработки аудио недоступны. Проверьте FFmpeg и FFprobe.'));
    });
    child.once('close', (code) => {
      finish();
      if (code === 0 && !signal.aborted && !exceeded && !timedOut) resolve(Buffer.concat(chunks));
      else
        reject(
          new UserFacingError(
            signal.aborted
              ? 'Обработка аудио отменена.'
              : 'Не удалось прочитать аудио или превышен лимит обработки. Попробуйте записать заново.',
          ),
        );
    });
  });
}

export async function createAudio(owner: string, chatKey: string): Promise<AudioUpload> {
  if (active >= config.AUDIO_MAX_CONCURRENT || uploads.size + active >= config.AUDIO_MAX_STORED) {
    throw new UserFacingError('Обработка аудио занята. Попробуйте чуть позже.');
  }
  active++;
  try {
    const id = crypto.randomUUID();
    const directory = path.join(await storageRoot(), id);
    await fs.mkdir(directory, { mode: 0o700 });
    const audio: AudioUpload = {
      id,
      owner,
      chatKey,
      directory,
      state: 'uploading',
      sourceBytes: 0,
      bytes: 0,
      duration: 0,
      waveform: [],
      expiresAt: Date.now() + config.AUDIO_TTL_MS,
      controller: new AbortController(),
      committed: false,
      pins: 0,
      receiving: false,
      reserved: true,
    };
    uploads.set(id, audio);
    return audio;
  } catch (error) {
    active--;
    throw error;
  }
}

export function getAudio(id: string, owner: string, chatKey?: string): AudioUpload | undefined {
  const audio = uploads.get(id);
  if (!audio || audio.owner !== owner || (chatKey && audio.chatKey !== chatKey)) return undefined;
  if (audio.expiresAt <= Date.now() && !audio.pins) {
    void deleteAudio(audio);
    return undefined;
  }
  return audio;
}

export function describeAudio(audio: AudioUpload) {
  return {
    id: audio.id,
    state: audio.state,
    size: audio.sourceBytes,
    bytes: audio.bytes,
    duration: audio.duration,
    waveform: audio.waveform,
    expiresAt: audio.expiresAt,
    error: audio.error,
  };
}

export async function deleteAudio(audio: AudioUpload): Promise<void> {
  audio.controller.abort();
  uploads.delete(audio.id);
  if (!audio.receiving && audio.reserved) {
    active--;
    audio.reserved = false;
  }
  await fs.rm(audio.directory, { recursive: true, force: true }).catch(() => {});
}

const safeInput = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,mov,ogg,mp3,wav,flac,aac'];
async function prepare(audio: AudioUpload): Promise<void> {
  const source = path.join(audio.directory, 'source');
  const output = path.join(audio.directory, 'audio.mp3');
  const signal = audio.controller.signal;
  const metadata = JSON.parse(
    (
      await run(
        ffprobePath,
        [
          '-v',
          'error',
          ...safeInput,
          '-show_entries',
          'stream=codec_type,duration:format=duration',
          '-of',
          'json',
          source,
        ],
        signal,
      )
    ).toString(),
  ) as {
    streams?: Array<{ codec_type?: string; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = metadata.streams?.find((entry) => entry.codec_type === 'audio');
  if (!stream) throw new UserFacingError('В записи нет звуковой дорожки. Запишите сообщение заново.');
  const sourceDuration = Number(metadata.format?.duration || stream.duration);
  if (sourceDuration > config.AUDIO_MAX_DURATION_SECONDS + 0.5) {
    throw new UserFacingError(`Аудио слишком длинное (до ${config.AUDIO_MAX_DURATION_SECONDS} с).`);
  }
  // MediaRecorder WebM often has no duration metadata. Decode at most limit+1s,
  // then reject overlong output instead of silently sending a shortened clip.
  await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-threads',
      '2',
      ...safeInput,
      '-i',
      source,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-t',
      String(config.AUDIO_MAX_DURATION_SECONDS + 1),
      '-fs',
      String(config.AUDIO_MAX_OUTPUT_BYTES + 64 * 1024),
      output,
    ],
    signal,
  );
  audio.bytes = (await fs.stat(output)).size;
  const converted = JSON.parse(
    (
      await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], signal)
    ).toString(),
  ) as { format?: { duration?: string } };
  audio.duration = Number(converted.format?.duration);
  // Half a second accommodates recorder scheduling and MP3 encoder padding.
  // -fs is deliberately ABOVE the acceptance cap: any size-truncated output
  // must fail validation even when the source has no duration metadata.
  if (
    !Number.isFinite(audio.duration) ||
    audio.duration <= 0 ||
    audio.duration > config.AUDIO_MAX_DURATION_SECONDS + 0.5 ||
    audio.bytes > config.AUDIO_MAX_OUTPUT_BYTES ||
    (Number.isFinite(sourceDuration) && audio.duration < sourceDuration - 0.2)
  ) {
    throw new UserFacingError('Полная запись не помещается в лимиты аудио. Запишите сообщение покороче.');
  }
  const pcm = await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      output,
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      'pipe:1',
    ],
    signal,
    Math.ceil((config.AUDIO_MAX_DURATION_SECONDS + 1) * 16000),
  );
  const samples = Math.floor(pcm.length / 2);
  const peaks = Array.from({ length: 48 }, (_, bin) => {
    let peak = 0;
    for (let i = Math.floor((bin * samples) / 48); i < Math.floor(((bin + 1) * samples) / 48); i++) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)) / 32768);
    }
    return peak;
  });
  const maximum = Math.max(0.01, ...peaks);
  audio.waveform = peaks.map((peak) => Math.round((peak / maximum) * 100));
  await fs.unlink(source);
}

export function receiveAudio(audio: AudioUpload, stream: Readable): Promise<void> {
  audio.receiving = true;
  const task = (async () => {
    const count = (chunk: Buffer) => {
      audio.sourceBytes += chunk.length;
      if (audio.sourceBytes > config.MAX_AUDIO_BYTES) audio.controller.abort();
    };
    stream.on('data', count);
    try {
      await pipeline(stream, createWriteStream(path.join(audio.directory, 'source'), { mode: 0o600 }), {
        signal: audio.controller.signal,
      });
      if (!audio.sourceBytes || (stream as Readable & { truncated?: boolean }).truncated) {
        throw new UserFacingError('Запись пуста или превышает лимит размера.');
      }
      audio.state = 'preparing';
      await prepare(audio);
      if (!audio.controller.signal.aborted) audio.state = 'ready';
    } catch (error) {
      if (uploads.has(audio.id)) {
        audio.state = 'failed';
        audio.error = error instanceof UserFacingError ? error.userMessage : 'Не удалось обработать запись.';
      }
    } finally {
      stream.removeListener('data', count);
      audio.receiving = false;
      if (audio.reserved) {
        active--;
        audio.reserved = false;
      }
      if (audio.state === 'failed' || audio.controller.signal.aborted) {
        await fs.rm(audio.directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  })();
  running.add(task);
  void task.finally(() => running.delete(task));
  return task;
}

export function pinAudio(audio: AudioUpload): () => void {
  audio.pins++;
  audio.expiresAt = Date.now() + config.AUDIO_TTL_MS;
  return () => {
    audio.pins--;
    audio.expiresAt = Date.now() + config.AUDIO_TTL_MS;
  };
}

export function clearChatAudio(chatKey: string, keep?: Set<string>): void {
  for (const audio of uploads.values()) {
    if (audio.chatKey === chatKey && (!keep || (audio.committed && !keep.has(audio.id)))) void deleteAudio(audio);
  }
}

export async function resolveAudioMessages(messages: ChatMessage[], owner: string): Promise<ChatMessage[]> {
  const included = new Set<string>();
  let remaining = config.AUDIO_CONTEXT_MAX_BYTES;
  for (const message of [...messages].reverse()) {
    if (typeof message.content === 'string') continue;
    for (const part of [...message.content].reverse()) {
      if (part.type !== 'audio_ref' || included.has(part.audioId)) continue;
      const audio = getAudio(part.audioId, owner);
      if (audio?.state === 'ready' && audio.bytes <= remaining) {
        included.add(audio.id);
        remaining -= audio.bytes;
      } else if (!audio && /^\d+$/.test(owner)) {
        try {
          const { profileStore } = await import('./profile/store.js');
          const { getMediaRow, mediaFilePath } = await import('./media/store.js');
          const saved = getMediaRow(profileStore().getDb(), Number(owner), part.audioId);
          if (saved && saved.kind === 'audio' && saved.bytes <= remaining) {
            await fs.access(mediaFilePath(saved.userId, saved.slot, saved.id, 'audio.mp3'));
            included.add(saved.id);
            remaining -= saved.bytes;
          }
        } catch {
          /* durable miss */
        }
      }
    }
  }
  return Promise.all(
    messages.map(async (message): Promise<ChatMessage> => {
      if (typeof message.content === 'string') return message;
      return {
        ...message,
        content: await Promise.all(
          message.content.map(async (part) => {
            if (part.type !== 'audio_ref') return part;
            const audio = getAudio(part.audioId, owner);
            if (!audio || audio.state !== 'ready' || !included.has(audio.id)) {
              if (/^\d+$/.test(owner)) {
                try {
                  const { profileStore } = await import('./profile/store.js');
                  const { getMediaRow, mediaFilePath } = await import('./media/store.js');
                  const saved = getMediaRow(profileStore().getDb(), Number(owner), part.audioId);
                  if (saved && saved.kind === 'audio' && included.has(saved.id)) {
                    const bytes = await fs.readFile(mediaFilePath(saved.userId, saved.slot, saved.id, 'audio.mp3'));
                    return {
                      type: 'input_audio' as const,
                      input_audio: { data: bytes.toString('base64'), format: 'mp3' as const },
                    };
                  }
                } catch {
                  /* fall through */
                }
              }
              return {
                type: 'text' as const,
                text: '[Previously attached voice message unavailable: expired or outside the audio context budget. Ask the user to record it again if needed.]',
              };
            }
            const release = pinAudio(audio);
            try {
              const bytes = await fs.readFile(path.join(audio.directory, 'audio.mp3'));
              return {
                type: 'input_audio' as const,
                input_audio: { data: bytes.toString('base64'), format: 'mp3' as const },
              };
            } finally {
              release();
            }
          }),
        ),
      };
    }),
  );
}

setInterval(() => {
  for (const audio of uploads.values()) if (!audio.pins && audio.expiresAt <= Date.now()) void deleteAudio(audio);
}, 30000).unref();

export async function shutdownAudio(): Promise<void> {
  await Promise.all([...uploads.values()].map(deleteAudio));
  await Promise.allSettled([...running]);
  if (root) await fs.rm(await root, { recursive: true, force: true }).catch(() => {});
}
