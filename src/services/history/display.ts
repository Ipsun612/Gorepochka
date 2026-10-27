import type { ChatMessage } from '../openrouter.js';

export interface FileDescriptor {
  name: string;
  snippet: string;
}

export interface DisplayTurn {
  text: string;
  image: string | null;
  images: string[];
  file: FileDescriptor | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

function snippetOf(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function splitFileBlock(full: string): { message: string; file: FileDescriptor | null } {
  const marker = '\n[Attached file: ';
  let idx = full.lastIndexOf(marker);
  let offset = 1;
  if (idx === -1 && full.startsWith('[Attached file: ')) {
    idx = 0;
    offset = 0;
  }
  if (idx === -1) return { message: full, file: null };
  const block = full.slice(idx + offset);
  const lines = block.split('\n');
  const header = lines[0] ?? '';
  const footer = lines[lines.length - 1] ?? '';
  const headerMatch = /^\[Attached file: (.+?)( — truncated to \d+ characters)?\]$/.exec(header);
  if (!headerMatch || !/^\[\/Attached file: .+\]$/.test(footer)) {
    return { message: full, file: null };
  }
  const name = (headerMatch[1] ?? '').slice(0, 120) || 'file';
  const fileText = lines.slice(1, -1).join('\n');
  const message = full.slice(0, idx).trimEnd();
  return { message, file: { name, snippet: snippetOf(fileText) } };
}

export function toDisplayTurn(content: ChatMessage['content']): DisplayTurn {
  if (typeof content === 'string') {
    const { message, file } = splitFileBlock(content);
    return { text: message, image: null, images: [], file, hasVideo: false, hasAudio: false };
  }
  if (!Array.isArray(content))
    return { text: '', image: null, images: [], file: null, hasVideo: false, hasAudio: false };
  const texts: string[] = [];
  const images: string[] = [];
  let hasVideo = false;
  let hasAudio = false;
  for (const part of content as Array<{ type?: string; text?: string; image_url?: { url?: string } }>) {
    if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') images.push(part.image_url.url);
    else if (part?.type === 'video_ref') hasVideo = true;
    else if (part?.type === 'audio_ref') hasAudio = true;
  }
  const joined = texts.join('\n\n');
  const { message, file } = splitFileBlock(joined);
  return { text: message, image: images[0] ?? null, images, file, hasVideo, hasAudio };
}
