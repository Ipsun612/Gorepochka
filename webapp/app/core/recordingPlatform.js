import { tg } from './telegram.js';

export function mobileCameraPlatform(platform = tg?.platform, device = globalThis.navigator) {
  if (['android', 'ios'].includes(platform)) return true;
  if (platform && !['unknown', 'web', 'weba', 'webk'].includes(platform)) return false;
  // A narrow window or coarse pointer alone must not turn a PC into a phone.
  const ua = device?.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && device?.maxTouchPoints > 1);
}
