import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { config } from '../config/config.js';
import { UserFacingError, type ChatMessage } from './openrouter.js';
import { sanitizeFileName } from './textfiles.js';
import { log } from '../utils/logger.js';

export const ffmpegPath = config.FFMPEG_PATH || ffmpeg || 'ffmpeg';
export const ffprobePath = config.FFPROBE_PATH || ffprobe.path;

export interface VideoUpload {
  id: string;
  owner: string;
  chatKey: string;
  name: string;
  kind: 'attachment' | 'video-note';
  state: 'uploading' | 'preparing' | 'ready' | 'failed';
  createdAt: number;
  expiresAt: number;
  sourceBytes: number;
  bytes: number;
  duration: number;
  hasAudio: boolean;
  poster: string | null;
  error?: string;
  directory: string;
  controller: AbortController;
  committed: boolean;
  pins: number;
  receiving: boolean;
  reserved: boolean;
}

const uploads = new Map<string, VideoUpload>();
let active = 0;
const running = new Set<Promise<void>>();
const root = fs.mkdtemp(path.join(os.tmpdir(), 'telegram-miniapp-video-'));
// Restrict the directory even on systems where the umask is permissive.
void root.then((dir) => fs.chmod(dir, 0o700)).catch(() => {});

/** Argument arrays only; no shell, stdin, user-controlled paths, or network protocols. */
async function run(binary: string, args: string[], signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new UserFacingError('Video processing cancelled.');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(abort, config.VIDEO_PROCESS_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    // Never retain arbitrary decoder diagnostics or expose file paths to users.
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > 1024 * 1024) child.kill('SIGKILL');
      else stdout += chunk.toString();
    });
    child.stderr.resume();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      finish();
      reject(new UserFacingError('Video tools are unavailable. Ask the operator to check FFmpeg and FFprobe.'));
    });
    child.once('close', (code) => {
      finish();
      if (code === 0 && !signal.aborted) resolve(stdout);
      else
        reject(
          new UserFacingError(
            signal.aborted
              ? 'Video processing cancelled.'
              : 'Could not decode this video, or processing exceeded its time limit. Try another file.',
          ),
        );
    });
  });
}

export async function checkVideoTools(): Promise<void> {
  const signal = new AbortController().signal;
  await run(ffmpegPath, ['-version'], signal);
  await run(ffprobePath, ['-version'], signal);
}

export async function createVideo(
  owner: string,
  chatKey: string,
  name: string,
  kind: VideoUpload['kind'] = 'attachment',
): Promise<VideoUpload> {
  if (active >= config.VIDEO_MAX_CONCURRENT || uploads.size + active >= config.VIDEO_MAX_STORED) {
    throw new UserFacingError('Video storage or processing is busy. Please try again later.');
  }
  // Reserve synchronously before awaiting filesystem work.
  active++;
  const id = crypto.randomUUID();
  try {
    const directory = path.join(await root, id);
    await fs.mkdir(directory, { mode: 0o700 });
    const now = Date.now();
    const video: VideoUpload = {
      id,
      owner,
      chatKey,
      name: sanitizeFileName(name),
      kind,
      directory,
      state: 'uploading',
      createdAt: now,
      expiresAt: now + config.VIDEO_TTL_MS,
      sourceBytes: 0,
      bytes: 0,
      duration: 0,
      hasAudio: false,
      poster: null,
      controller: new AbortController(),
      committed: false,
      pins: 0,
      receiving: false,
      reserved: true,
    };
    uploads.set(id, video);
    return video;
  } catch (err) {
    active--;
    throw err;
  }
}

export function getVideo(id: string, owner: string, chatKey?: string): VideoUpload | undefined {
  const video = uploads.get(id);
  if (!video || video.owner !== owner || (chatKey && video.chatKey !== chatKey)) return undefined;
  if (video.expiresAt <= Date.now() && !video.pins) {
    void deleteVideo(video);
    return undefined;
  }
  return video;
}

export function describeVideo(video: VideoUpload) {
  return {
    id: video.id,
    name: video.name,
    kind: video.kind,
    state: video.state,
    size: video.sourceBytes,
    bytes: video.bytes,
    duration: video.duration,
    hasAudio: video.hasAudio,
    poster: video.poster,
    error: video.error,
    expiresAt: video.expiresAt,
  };
}

export async function deleteVideo(video: VideoUpload): Promise<void> {
  video.controller.abort();
  uploads.delete(video.id);
  if (!video.receiving && video.reserved) {
    active--;
    video.reserved = false;
  }
  // Only this service's randomly-created per-upload directory is removed.
  await fs.rm(video.directory, { recursive: true, force: true }).catch(() => {});
}

interface ProbeResult {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  format?: { duration?: string };
}

let demuxerWhitelist: Promise<string> | undefined;
function safeDemuxers(): Promise<string> {
  // Discover the installed build's formats instead of maintaining a finite
  // extension/container allowlist. Exclude manifests and external file lists.
  demuxerWhitelist ??= run(ffprobePath, ['-hide_banner', '-demuxers'], new AbortController().signal).then((text) => {
    const blocked = new Set([
      'hls',
      'applehttp',
      'dash',
      'concat',
      'sdp',
      'rtsp',
      'image2',
      'image2pipe',
      'avisynth',
      'vapoursynth',
    ]);
    const names = text.split('\n').flatMap((line) => {
      const match = /^\s*D\s+(\S+)/.exec(line);
      return match ? match[1]!.split(',').filter((name) => !blocked.has(name)) : [];
    });
    if (!names.length) throw new UserFacingError('Could not discover supported video formats.');
    return names.join(',');
  });
  return demuxerWhitelist;
}

async function prepare(video: VideoUpload): Promise<void> {
  const input = path.join(video.directory, 'source');
  const output = path.join(video.directory, 'video.mp4');
  const signal = video.controller.signal;
  const safeInput = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', await safeDemuxers()];
  // Playlists and external-reference containers are intentionally not allowed.
  const metadata = JSON.parse(
    await run(
      ffprobePath,
      [
        '-v',
        'error',
        '-threads',
        '2',
        ...safeInput,
        '-show_entries',
        'stream=codec_type,width,height,duration:format=duration',
        '-of',
        'json',
        input,
      ],
      signal,
    ),
  ) as ProbeResult;
  const streams = metadata.streams ?? [];
  const visual = streams.find((stream) => stream.codec_type === 'video');
  let duration = Number(metadata.format?.duration || visual?.duration);
  if (!visual || !visual.width || !visual.height) {
    throw new UserFacingError('This file does not contain a readable video.');
  }
  if (visual.width * visual.height > config.VIDEO_MAX_PIXELS) {
    throw new UserFacingError('This video resolution is too large. Please export a smaller video.');
  }
  const limit =
    video.kind === 'video-note' ? Math.min(60, config.VIDEO_MAX_DURATION_SECONDS) : config.VIDEO_MAX_DURATION_SECONDS;
  // Live MediaRecorder WebM lacks duration metadata. Count decoded frames with a
  // bounded pass (not a client-supplied duration), then reject rather than trim.
  if (!Number.isFinite(duration) || duration <= 0) {
    const progress = await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-threads',
        '2',
        ...safeInput,
        '-i',
        input,
        '-map',
        '0:v:0',
        '-an',
        '-t',
        String(limit + 1),
        '-progress',
        'pipe:1',
        '-f',
        'null',
        '-',
      ],
      signal,
    );
    const times = [...progress.matchAll(/^out_time_us=(\d+)$/gm)].map((match) => Number(match[1]) / 1000000);
    duration = Math.max(0, ...times);
    if (!duration) throw new UserFacingError('This recording has no readable video frames.');
  }
  if (duration > limit + 0.1) {
    throw new UserFacingError(`Video is too long (max ${limit} seconds).`);
  }
  video.duration = duration;
  video.hasAudio = streams.some((stream) => stream.codec_type === 'audio');
  // Target a bounded payload; -fs additionally caps misleading/hostile inputs.
  const totalBitrate = Math.floor((config.VIDEO_MAX_OUTPUT_BYTES * 8 * 0.85) / duration);
  const audioBitrate = video.hasAudio ? 96000 : 0;
  if (totalBitrate - audioBitrate < 100000) {
    throw new UserFacingError('Video is too long for the configured AI payload limit. Please use a shorter clip.');
  }
  const dimension =
    video.kind === 'video-note' ? Math.min(480, config.VIDEO_MAX_DIMENSION) : config.VIDEO_MAX_DIMENSION;
  const filter =
    video.kind === 'video-note'
      ? `crop='min(iw,ih)':'min(iw,ih)',scale=${dimension - (dimension % 2)}:${dimension - (dimension % 2)},setsar=1`
      : `scale=w='min(${dimension},iw)':h='min(${dimension},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
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
      input,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-sn',
      '-dn',
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-b:v',
      String(Math.min(2500000, totalBitrate - audioBitrate)),
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      // The decoder cap is above acceptance so hitting -fs cannot look like success.
      '-fs',
      String(config.VIDEO_MAX_OUTPUT_BYTES + 64 * 1024),
      '-t',
      String(limit + 1),
      output,
    ],
    signal,
  );
  video.bytes = (await fs.stat(output)).size;
  if (video.bytes > config.VIDEO_MAX_OUTPUT_BYTES) {
    throw new UserFacingError('Converted video exceeds the AI payload limit. Please use a shorter clip.');
  }
  const converted = JSON.parse(
    await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], signal),
  ) as ProbeResult;
  const actualDuration = Number(converted.format?.duration);
  // Never silently send a truncated conversion (e.g. when -fs was reached).
  if (!Number.isFinite(actualDuration) || actualDuration < duration - 0.5 || actualDuration > limit + 0.15) {
    throw new UserFacingError('The complete video could not fit within processing limits. Please use a shorter clip.');
  }
  video.duration = actualDuration;
  await run(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      output,
      '-frames:v',
      '1',
      '-vf',
      'scale=256:256:force_original_aspect_ratio=decrease',
      '-q:v',
      '5',
      '-threads',
      '1',
      path.join(video.directory, 'poster.jpg'),
    ],
    signal,
  );
  const poster = await fs.readFile(path.join(video.directory, 'poster.jpg'));
  video.poster = `data:image/jpeg;base64,${poster.toString('base64')}`;
  await fs.unlink(input);
}

/** Multipart parser owns stream limits; this service checks the bytes again. */
export function receiveVideo(video: VideoUpload, stream: Readable): Promise<void> {
  video.receiving = true;
  const task = receiveAndPrepare(video, stream);
  running.add(task);
  void task.finally(() => running.delete(task));
  return task;
}

async function receiveAndPrepare(video: VideoUpload, stream: Readable): Promise<void> {
  const count = (chunk: Buffer) => {
    video.sourceBytes += chunk.length;
    if (video.sourceBytes > config.MAX_VIDEO_BYTES) video.controller.abort();
  };
  stream.on('data', count);
  try {
    await pipeline(stream, createWriteStream(path.join(video.directory, 'source'), { mode: 0o600 }), {
      signal: video.controller.signal,
    });
    if (!video.sourceBytes || (stream as Readable & { truncated?: boolean }).truncated) {
      throw new UserFacingError('Video is empty or exceeds the upload size limit.');
    }
    video.state = 'preparing';
    await prepare(video);
    if (video.controller.signal.aborted) return;
    video.state = 'ready';
  } catch (err) {
    if (uploads.has(video.id)) {
      video.state = 'failed';
      video.error =
        err instanceof UserFacingError ? err.userMessage : 'Could not prepare that video. Try another file.';
      await fs.rm(video.directory, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    stream.removeListener('data', count);
    video.receiving = false;
    if (video.reserved) {
      active--;
      video.reserved = false;
    }
    if (video.controller.signal.aborted || video.state === 'failed') {
      await fs.rm(video.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function pinVideo(video: VideoUpload): () => void {
  video.pins++;
  video.expiresAt = Date.now() + config.VIDEO_TTL_MS;
  return () => {
    video.pins--;
    video.expiresAt = Date.now() + config.VIDEO_TTL_MS;
  };
}

export function clearChatVideos(chatKey: string, keep?: Set<string>): void {
  for (const video of uploads.values()) {
    if (video.chatKey === chatKey && (!keep || (video.committed && !keep.has(video.id)))) void deleteVideo(video);
  }
}

export async function resolveVideoMessages(messages: ChatMessage[], owner: string): Promise<ChatMessage[]> {
  // Bound outgoing base64/JSON as well as storage. Prefer the most recent clips.
  const included = new Set<string>();
  let remaining = config.VIDEO_MAX_OUTPUT_BYTES * 2;
  const durableBytes = new Map<string, number>();
  for (const message of [...messages].reverse()) {
    if (typeof message.content === 'string') continue;
    for (const part of [...message.content].reverse()) {
      if (part.type !== 'video_ref' || included.has(part.videoId)) continue;
      const video = getVideo(part.videoId, owner);
      if (video && video.bytes <= remaining) {
        included.add(video.id);
        remaining -= video.bytes;
      } else if (!video && /^\d+$/.test(owner)) {
        try {
          const { profileStore } = await import('./profile/store.js');
          const { getMediaRow, mediaFilePath } = await import('./media/store.js');
          const saved = getMediaRow(profileStore().getDb(), Number(owner), part.videoId);
          if (saved && (saved.kind === 'video' || saved.kind === 'video-note') && saved.bytes <= remaining) {
            await fs.access(mediaFilePath(saved.userId, saved.slot, saved.id, 'video.mp4'));
            included.add(saved.id);
            remaining -= saved.bytes;
            durableBytes.set(saved.id, saved.bytes);
          }
        } catch {
          /* durable miss: placeholder below */
        }
      }
    }
  }
  return Promise.all(
    messages.map(async (message): Promise<ChatMessage> => {
      if (typeof message.content === 'string') return message;
      const content = await Promise.all(
        message.content.map(async (part) => {
          if (part.type !== 'video_ref') return part;
          const video = getVideo(part.videoId, owner);
          if (!video || video.state !== 'ready') {
            if (/^\d+$/.test(owner)) {
              try {
                const { profileStore } = await import('./profile/store.js');
                const { getMediaRow, mediaFilePath } = await import('./media/store.js');
                const saved = getMediaRow(profileStore().getDb(), Number(owner), part.videoId);
                if (saved && (saved.kind === 'video' || saved.kind === 'video-note') && included.has(saved.id)) {
                  const bytes = await fs.readFile(mediaFilePath(saved.userId, saved.slot, saved.id, 'video.mp4'));
                  return {
                    type: 'video_url' as const,
                    video_url: { url: `data:video/mp4;base64,${bytes.toString('base64')}` },
                  };
                }
              } catch {
                /* fall through to placeholder */
              }
            }
            return {
              type: 'text' as const,
              text: '[Previously attached video has expired. Ask the user to attach it again if needed.]',
            };
          }
          if (!included.has(video.id))
            return {
              type: 'text' as const,
              text: '[Older video omitted to respect the media context size limit. Ask the user to reattach it if needed.]',
            };
          const bytes = await fs.readFile(path.join(video.directory, 'video.mp4'));
          return {
            type: 'video_url' as const,
            video_url: { url: `data:video/mp4;base64,${bytes.toString('base64')}` },
          };
        }),
      );
      return { ...message, content };
    }),
  );
}

setInterval(() => {
  for (const video of uploads.values()) if (!video.pins && video.expiresAt <= Date.now()) void deleteVideo(video);
}, 30000).unref();

export async function shutdownVideos(): Promise<void> {
  await Promise.all([...uploads.values()].map(deleteVideo));
  await Promise.allSettled([...running]);
  const directory = await root;
  await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
}

void checkVideoTools()
  .then(() => log.info('Project-local FFmpeg and FFprobe are available'))
  .catch(() =>
    log.warn('Video tools unavailable: configure FFMPEG_PATH and FFPROBE_PATH or reinstall npm dependencies'),
  );
