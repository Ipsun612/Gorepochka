import type { ChatContentPart } from '../../services/openrouter.js';
import { convertToJpeg, decodeImageDataUrl } from '../../services/images.js';
import {
  decodeTextFile,
  decodeTextFileDataUrl,
  formatFileBlock,
  sanitizeFileName,
  type DecodedTextFile,
} from '../../services/textfiles.js';
import type { AudioUpload } from '../../services/audio.js';
import type { VideoUpload } from '../../services/videos.js';

// Convert the attachments BEFORE touching history, so a rejected image or
// file never leaves a half-written turn behind.
export async function decodeImageAttachment(rawImage: unknown): Promise<{
  dataUrl: string;
  sourceBytes: number;
  bytes: number;
  width: number;
  height: number;
}> {
  const source = decodeImageDataUrl(rawImage);
  const converted = await convertToJpeg(source);
  return {
    dataUrl: converted.dataUrl,
    sourceBytes: converted.sourceBytes,
    bytes: converted.bytes,
    width: converted.width,
    height: converted.height,
  };
}

export function decodeFileAttachment(rawFile: unknown, rawFileName: unknown): { name: string; file: DecodedTextFile } {
  const source = decodeTextFileDataUrl(rawFile);
  const decoded = decodeTextFile(source);
  return { name: sanitizeFileName(rawFileName), file: decoded };
}

/** Text for a turn: the message plus any attached file block. */
export function appendFileBlock(input: string, attachment: { name: string; file: DecodedTextFile } | null): string {
  if (!attachment) return input;
  const block = formatFileBlock(attachment.name, attachment.file);
  return input ? `${input}\n\n${block}` : block;
}

/** Multimodal turn: text (+ image/video/audio) parts, plain string when media-free. */
export function buildChatContent(
  textContent: string,
  imageDataUrl: string | null,
  video: VideoUpload | undefined,
  audio: AudioUpload | undefined,
): string | ChatContentPart[] {
  if (!imageDataUrl && !video && !audio) return textContent;
  return [
    ...(textContent
      ? [{ type: 'text' as const, text: textContent }]
      : video
        ? [
            {
              type: 'text' as const,
              text:
                video.kind === 'video-note'
                  ? 'This is a circular video message from the user. Watch and listen, then respond naturally to what they communicate, in the language they use. If speech is unclear or absent, do not invent words.'
                  : 'Analyze this video, including its audio when present.',
            },
          ]
        : audio
          ? [
              {
                type: 'text' as const,
                text: 'This is a voice message from the user. Listen to it and respond naturally to what they say, in the language they use. If speech is unclear or absent, say so; do not invent words.',
              },
            ]
          : []),
    ...(imageDataUrl ? [{ type: 'image_url' as const, image_url: { url: imageDataUrl } }] : []),
    ...(video ? [{ type: 'video_ref' as const, videoId: video.id }] : []),
    ...(audio ? [{ type: 'audio_ref' as const, audioId: audio.id }] : []),
  ];
}
