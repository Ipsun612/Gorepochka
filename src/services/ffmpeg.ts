import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { config } from '../config/config.js';

/**
 * Shared decoder binaries for video and audio pipelines. Both services must
 * resolve the same binaries (project-local npm packages unless overridden),
 * so the paths live here instead of `videos.ts` importing into `audio.ts`.
 */
export const ffmpegPath = config.FFMPEG_PATH || ffmpeg || 'ffmpeg';
export const ffprobePath = config.FFPROBE_PATH || ffprobe.path;
