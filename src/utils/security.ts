import { config } from '../config/config.js';
import { UserFacingError } from '../services/openrouter.js';

/** Allowlist check. Empty ALLOWED_USER_IDS = public bot. */
export function isAllowedUser(userId: number): boolean {
  if (config.ALLOWED_USER_IDS.length === 0) return true;
  return config.ALLOWED_USER_IDS.includes(userId);
}

/** Trim, enforce max length, strip control chars (keep newlines/tabs). */
export function sanitizeInput(raw: string): string {
  const trimmed = raw.trim().slice(0, config.MAX_MESSAGE_LENGTH);
  // Remove C0/C1 control chars except \n, \r, \t.
  return trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

/** Telegram message limit is 4096 chars; split long AI replies safely. */
export function splitForTelegram(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit; // no good newline: hard cut
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Generic user-facing error — never leak stack traces or provider details.
 *  Only explicitly consented messages (UserFacingError) pass through. */
export function toUserError(err: unknown): string {
  if (err instanceof UserFacingError) return `⚠️ ${err.userMessage}`;
  return '⚠️ Something went wrong. Please try again.';
}
