/* Chat attachment staging: image / text-file / video composer previews.
   Staged files live on shared state until send; switching chats clears them. */

import { state } from '../core/state.js';
import {
  attachPreview,
  attachThumb,
  attachName,
  attachSize,
  attachInput,
  filePreview,
  fileIcon,
  fileName,
  fileSize,
  videoPreview,
  videoPlayer,
  videoName,
  videoSize,
  toast,
} from '../core/dom.js';
import { haptic } from '../core/telegram.js';
import { isLiveSlot } from './chatState.js';
import { isImageFile, fileToDataUrl, makeThumbnail, formatBytes } from '../media/image.js';
import { isTextFile, readTextFile, fileSnippet } from '../media/textfile.js';
import { isVideoFile, videoDetails } from '../video/video.js';

// Discard asynchronous picker reads after remove/send/switch or a newer selection.
let attachmentGeneration = 0;
let imageReadVersion = 0;
let fileReadVersion = 0;

// Placeholder shown when the browser can't decode the format for a local
// preview (e.g. HEIC outside Safari). The server still converts the original.
const PLACEHOLDER_THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46"><rect width="46" height="46" rx="10" fill="#d6e4ff"/><path d="m10 32 9-11 7 7 5-5 6 9z" fill="#7a9aca"/><circle cx="30" cy="14" r="4" fill="#7a9aca"/></svg>',
  );

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
};

// If a platform reports no/unknown MIME (common for some Android/Safari
// pickers), re-tag the data URL as an image from the file extension so it
// passes the server's image-only gate. The server sniffs the real format.
function normalizeImageDataUrl(dataUrl, file) {
  if (/^data:image\//i.test(dataUrl)) return dataUrl;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return '';
  const base64 = dataUrl.slice(comma + 1);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64.slice(0, 64))) return '';
  const ext = (
    String(file.name || '')
      .split('.')
      .pop() || ''
  ).toLowerCase();
  return `data:${MIME_BY_EXT[ext] || 'image/jpeg'};base64,${base64}`;
}

// --- Image attachment (composer) ---
function showAttachment() {
  const img = state.pendingImage;
  if (!img) {
    attachPreview.classList.add('hidden');
    return;
  }
  attachThumb.src = img.thumb || PLACEHOLDER_THUMB;
  attachName.textContent = img.name;
  attachSize.textContent = formatBytes(img.size);
  attachPreview.classList.remove('hidden');
}

export function clearAttachment() {
  imageReadVersion++;
  state.pendingImage = null;
  attachPreview.classList.add('hidden');
  attachThumb.removeAttribute('src');
  if (attachInput) attachInput.value = '';
}

export function clearFileAttachment() {
  fileReadVersion++;
  state.pendingFile = null;
  filePreview.classList.add('hidden');
  if (attachInput) attachInput.value = '';
}

/** Reset every staged attachment (used when switching/clearing chats or after send). */
export function clearAttachments() {
  attachmentGeneration++;
  clearAttachment();
  clearFileAttachment();
  clearVideoAttachment();
}

export function clearVideoAttachment() {
  const video = state.pendingVideo;
  state.pendingVideo = null;
  if (typeof videoPlayer.pause === 'function') videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.onloadedmetadata = null;
  videoPlayer.onerror = null;
  if (video && video.url) URL.revokeObjectURL(video.url);
  videoPreview.classList.add('hidden');
  if (attachInput) attachInput.value = '';
}

export function attachVideoFile(file) {
  if (state.voiceActive) return;
  if (!file || state.sending || state.managing || !isLiveSlot(state.activeId)) return;
  if (!file.size || file.size > state.maxVideoBytes) {
    toast(`Выберите непустое видео до ${formatBytes(state.maxVideoBytes)}.`);
    haptic('error');
    return;
  }
  clearVideoAttachment();
  let url = '';
  try {
    url = URL.createObjectURL(file);
  } catch (e) {
    /* preview is optional */
  }
  const video = { file, name: file.name || 'Видео', size: file.size, url, duration: 0 };
  state.pendingVideo = video;
  videoName.textContent = video.name;
  videoSize.textContent = `${videoDetails(video)} · до ${state.maxVideoDurationSeconds} с`;
  videoPlayer.classList.toggle('hidden', !url);
  if (url) {
    videoPlayer.onloadedmetadata = () => {
      if (state.pendingVideo !== video) return;
      video.duration = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : 0;
      videoSize.textContent = videoDetails(video);
      if (video.duration > state.maxVideoDurationSeconds)
        toast(`Видео слишком длинное (до ${state.maxVideoDurationSeconds} с).`);
    };
    videoPlayer.onerror = () => {
      videoPlayer.classList.add('hidden');
      videoSize.textContent = `${formatBytes(video.size)} · предпросмотр недоступен; видео обработает сервер`;
    };
    videoPlayer.src = url;
  }
  videoPreview.classList.remove('hidden');
  haptic('light');
}

export async function attachPickedFile(file) {
  if (state.voiceActive) {
    toast('Завершите запись сообщения перед выбором файла.');
    return;
  }
  const generation = attachmentGeneration;
  // .ts is both TypeScript and an MPEG transport-stream extension. Inspect a
  // tiny prefix so binary transport streams are not misrouted as source code.
  if (file && /\.ts$/i.test(file.name || '') && typeof file.slice === 'function') {
    const bytes = new Uint8Array(await file.slice(0, 600).arrayBuffer());
    if (generation !== attachmentGeneration) return;
    if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return attachVideoFile(file);
  }
  if (isImageFile(file)) return attachImageFile(file);
  if (isVideoFile(file)) return attachVideoFile(file);
  if (isTextFile(file)) return attachTextFile(file);
  // Unknown extensions/MIME types are allowed through to authoritative probing.
  return attachVideoFile(file);
}

/** Open the one picker for both images and text files. */
export function openAttachPicker() {
  if (state.voiceActive) return;
  if (state.sending || state.managing || !isLiveSlot(state.activeId)) {
    toast('Сейчас нельзя прикрепить файл. Дождитесь ответа или откройте активный диалог.');
    return;
  }
  if (!attachInput) return;
  attachInput.value = ''; // allow re-picking the same file
  attachInput.click();
}

/** Stage a picked/dropped/pasted file. Anything the browser can read is fine:
 *  the server converts every format to JPEG before the AI sees it. */
export async function attachImageFile(file) {
  if (state.voiceActive) return;
  if (!file) return;
  if (state.sending || state.managing || !isLiveSlot(state.activeId)) {
    toast('Сейчас нельзя прикрепить изображение.');
    return;
  }
  if (!isImageFile(file)) {
    toast('Выберите изображение.');
    haptic('error');
    return;
  }
  if (file.size > state.maxImageBytes) {
    toast(`Изображение слишком большое (до ${formatBytes(state.maxImageBytes)}).`);
    haptic('error');
    return;
  }
  const version = ++imageReadVersion;
  const chatId = state.activeId;
  let dataUrl = '';
  try {
    dataUrl = normalizeImageDataUrl(await fileToDataUrl(file), file);
  } catch (e) {
    dataUrl = '';
  }
  if (version !== imageReadVersion || chatId !== state.activeId || state.sending || state.managing) return;
  if (!dataUrl) {
    toast('Не удалось прочитать изображение. Выберите другое.');
    haptic('error');
    return;
  }
  const thumb = await makeThumbnail(file);
  if (version !== imageReadVersion || chatId !== state.activeId || state.sending || state.managing) return;
  state.pendingImage = {
    name: file.name || 'Изображение',
    size: file.size,
    dataUrl,
    // Real JPEG preview thumbnail, or null when the browser can't decode the
    // format locally (the server still converts the original for the AI).
    thumb: thumb || null,
  };
  showAttachment();
  haptic('light');
}

// --- Text-file attachment (composer) ---
function showFileAttachment() {
  const f = state.pendingFile;
  if (!f) {
    filePreview.classList.add('hidden');
    return;
  }
  fileIcon.textContent = 'TXT';
  fileName.textContent = f.name;
  const size = formatBytes(f.size);
  const chars = f.chars ? `${f.chars.toLocaleString('ru-RU')} симв.` : '';
  fileSize.textContent = [size, chars].filter(Boolean).join(' · ');
  filePreview.classList.remove('hidden');
}

/** Stage a picked/dropped/pasted text file. The server re-checks the bytes. */
export async function attachTextFile(file) {
  if (state.voiceActive) return;
  if (!file) return;
  if (state.sending || state.managing || !isLiveSlot(state.activeId)) {
    toast('Сейчас нельзя прикрепить файл.');
    return;
  }
  if (!isTextFile(file)) {
    toast('Выберите текстовый файл.');
    haptic('error');
    return;
  }
  if (file.size > state.maxFileBytes) {
    toast(`Файл слишком большой (до ${formatBytes(state.maxFileBytes)}).`);
    haptic('error');
    return;
  }
  const version = ++fileReadVersion;
  const chatId = state.activeId;
  let read = null;
  try {
    read = await readTextFile(file);
  } catch (e) {
    read = null;
  }
  if (version !== fileReadVersion || chatId !== state.activeId || state.sending || state.managing) return;
  if (!read || !read.dataUrl) {
    toast('Не удалось прочитать файл. Выберите другой.');
    haptic('error');
    return;
  }
  state.pendingFile = {
    name: file.name || 'Файл',
    size: file.size,
    dataUrl: read.dataUrl,
    chars: read.text.length,
    snippet: fileSnippet(read.text),
  };
  showFileAttachment();
  haptic('light');
}
