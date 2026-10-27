import sharp from 'sharp';
import { config } from '../config/config.js';
import { log } from '../utils/logger.js';
import { UserFacingError } from './openrouter.js';

// ---------------------------------------------------------------------------
// Image attachments
//
// The Mini App accepts an image file in ANY format (the browser sends the raw
// file as a base64 data URL). The server is the single authority that turns it
// into a clean JPEG before it reaches the AI:
//   - the format is sniffed from the bytes (not trusted from the client),
//   - EXIF orientation is applied and the pixels are re-encoded (strips EXIF,
//     ICC junk and any polyglot payload riding along in the container),
//   - the longest side is capped so vision payloads stay small.
// ---------------------------------------------------------------------------

/** Any `data:image/<subtype>;base64,...` URL. The subtype is only a hint —
 *  sharp sniffs the real format from the decoded bytes. */
const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i;

export interface ConvertedImage {
  /** `data:image/jpeg;base64,…` ready to embed in a chat message. */
  dataUrl: string;
  /** Encoded JPEG size in bytes. */
  bytes: number;
  /** Size of the uploaded source in bytes. */
  sourceBytes: number;
  width: number;
  height: number;
}

function humanMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Upper bound on base64 length for MAX_IMAGE_BYTES of raw data (4/3 + padding). */
export function maxBase64Length(): number {
  return Math.ceil((config.MAX_IMAGE_BYTES * 4) / 3) + 8;
}

/**
 * Validate + decode a client-supplied image data URL.
 * Size is checked BEFORE decoding so a hostile client can never make us
 * allocate more than the configured limit.
 */
export function decodeImageDataUrl(raw: unknown): Buffer {
  if (typeof raw !== 'string' || raw === '') {
    throw new UserFacingError('Please attach a valid image file.');
  }
  const match = IMAGE_DATA_URL.exec(raw);
  if (!match) {
    throw new UserFacingError('Only image files are supported. Please attach a picture.');
  }
  const base64 = match[1] ?? '';
  if (base64.length > maxBase64Length()) {
    throw new UserFacingError(`That image is too large (max ${humanMb(config.MAX_IMAGE_BYTES)}).`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new UserFacingError('Please attach a valid image file.');
  }
  if (buffer.length > config.MAX_IMAGE_BYTES) {
    throw new UserFacingError(`That image is too large (max ${humanMb(config.MAX_IMAGE_BYTES)}).`);
  }
  return buffer;
}

/**
 * Re-encode any accepted image buffer to JPEG. Throws UserFacingError when the
 * bytes are not a decodable image or exceed the pixel guard.
 */
export async function convertToJpeg(input: Buffer): Promise<ConvertedImage> {
  const quality = Math.min(100, Math.max(1, config.IMAGE_JPEG_QUALITY));
  try {
    const { data, info } = await sharp(input, {
      // Keep going on slightly-damaged files; still fail on real corruption.
      failOn: 'error',
      // Decompression-bomb guard (huge pixel dimensions in a tiny file).
      limitInputPixels: config.IMAGE_MAX_PIXELS,
      animated: false,
    })
      .rotate() // bake in EXIF orientation, then drop the metadata
      .resize({
        width: config.IMAGE_MAX_DIMENSION,
        height: config.IMAGE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // JPEG has no alpha channel: flatten transparency onto white.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
      bytes: data.length,
      sourceBytes: input.length,
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), bytes: input.length },
      'Image conversion failed (unsupported or corrupt file?)',
    );
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError('Could not read that image. Try a JPEG, PNG, WebP, GIF, TIFF, HEIC/AVIF or SVG file.');
  }
}
