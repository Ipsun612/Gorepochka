import crypto from 'node:crypto';
import { config } from '../config/config.js';

export interface WebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface InitDataResult {
  ok: boolean;
  user?: WebAppUser;
  authDate?: number;
  reason?: string;
}

/**
 * Validate Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 *
 * initData is a query-string like:
 *   query_id=AAH...&user=%7B%22id%22%3A123...%7D&auth_date=1728...&hash=...
 *
 * Validation:
 *   1. Extract `hash`, sort remaining `key=value` pairs, join with "\n".
 *   2. secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
 *   3. calc = HMAC_SHA256(key=secret_key, msg=data_check_string) hex
 *   4. timing-safe compare with `hash`.
 *   5. auth_date must be recent (1h) to prevent replay.
 */
// Short validity window: initData is effectively a bearer credential, so a
// captured one must become useless quickly. 1h comfortably covers normal use
// (Telegram attaches a fresh initData every time the Mini App is opened).
const MAX_AUTH_AGE_SEC = 60 * 60;

export function validateInitData(initData: string | undefined | null): InitDataResult {
  if (!initData || typeof initData !== 'string' || initData.trim() === '') {
    return { ok: false, reason: 'missing initData' };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unparseable initData' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing hash' };
  // Strict format check: HMAC-SHA256 hex digest is exactly 64 hex chars.
  // (Prevents Buffer.from('hex') truncation tricks like appending "x".)
  if (!/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'bad hash' };

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === 'hash') return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.TELEGRAM_BOT_TOKEN).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  try {
    const a = Buffer.from(calcHash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad hash' };
    }
  } catch {
    return { ok: false, reason: 'bad hash' };
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw ? Number(authDateRaw) : 0;
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return { ok: false, reason: 'bad auth_date' };
  }
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > MAX_AUTH_AGE_SEC) {
    return { ok: false, reason: 'stale initData' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'missing user' };
  try {
    const user = JSON.parse(userRaw) as WebAppUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: 'bad user id' };
    for (const field of ['first_name', 'last_name', 'username', 'language_code'] as const) {
      if (user[field] !== undefined && (typeof user[field] !== 'string' || user[field]!.length > 256)) {
        return { ok: false, reason: 'bad user fields' };
      }
    }
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'bad user JSON' };
  }
}
