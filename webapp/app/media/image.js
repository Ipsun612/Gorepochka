/* Image attachment helpers for the Mini App.
   Reads any user-picked image, and (best effort) builds a small JPEG thumbnail
   for the chat bubble + local display cache. The server is what authoritatively
   converts the uploaded file to JPEG for the AI — the thumbnail here only
   powers the preview, so a format the browser can't decode still uploads fine. */

/** Largest dimension (px) of the locally generated preview thumbnail. */
const THUMB_MAX_DIM = 256;
const THUMB_QUALITY = 0.72;

export function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  // Some platforms report an empty type for images sent as files — sniff the name.
  return /\.(png|jpe?g|jfif|gif|webp|bmp|tiff?|avif|heic|heif|svg)$/i.test(file.name || '');
}

/** Read a File/Blob into a base64 data URL (whatever its original format). */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

// Decode to something drawable. Prefers createImageBitmap (honours EXIF
// orientation); falls back to an <img> for older engines.
async function decodeDrawable(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      try {
        return await createImageBitmap(file);
      } catch (e2) {
        /* fall through to the <img> path */
      }
    }
  }
  return new Promise((resolve) => {
    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch (e) {
      resolve(null);
      return;
    }
    const img = new Image();
    const done = (value) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Small JPEG data URL for the bubble preview, or null when undecodable. */
export async function makeThumbnail(file) {
  try {
    const drawable = await decodeDrawable(file);
    if (!drawable) return null;
    const w = drawable.width || drawable.naturalWidth || 0;
    const h = drawable.height || drawable.naturalHeight || 0;
    if (!w || !h) {
      if (drawable.close) drawable.close();
      return null;
    }
    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (drawable.close) drawable.close();
      return null;
    }
    // Flatten onto white so transparent PNGs don't turn black in JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
    if (drawable.close) drawable.close();
    return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch (e) {
    return null;
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МБ`;
}
