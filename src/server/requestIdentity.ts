import crypto from 'node:crypto';
import type express from 'express';
import { config } from '../config/config.js';
import { log } from '../utils/logger.js';
import { isAllowedUser } from '../utils/security.js';
import { validateInitData, type WebAppUser } from './webappAuth.js';

export interface RequestIdentity {
  userId: number;
  historyKey: string;
  verified: boolean;
  displayName?: string;
  user?: WebAppUser;
  authDate?: number;
}

const ANON_CLIENT_ID = /^[a-zA-Z0-9-]{8,64}$/;
function anonBucketId(clientId: string): number {
  const hash = crypto.createHash('sha256').update(clientId).digest();
  return -(1 + (hash.readUInt32BE(0) >>> 1));
}

/** One auth policy for chat, videos and profiles. Never accept a client-supplied owner ID. */
export function resolveIdentity(
  req: express.Request,
  requireClientId: boolean,
  res: express.Response,
): RequestIdentity | null {
  // Auth travels in headers only (X-Telegram-Init-Data / X-Miniapp-Client-Id).
  // Bodies are logged, cached and persisted in places headers never go, so a
  // bearer credential must not be duplicated there.
  const header = req.get('X-Telegram-Init-Data');
  const initData = typeof header === 'string' && header !== '' ? header : undefined;
  if (initData !== undefined) {
    const result = validateInitData(initData);
    if (!result.ok || !result.user) {
      log.warn({ reason: result.reason }, 'Rejected request with invalid initData');
      res.status(401).json({ ok: false, error: 'Invalid Telegram auth. Please reopen the Mini App from the bot.' });
      return null;
    }
    if (!isAllowedUser(result.user.id)) {
      res.status(403).json({ ok: false, error: 'Access denied.' });
      return null;
    }
    const displayName =
      [result.user.first_name, result.user.last_name].filter(Boolean).join(' ') || result.user.username;
    return {
      userId: result.user.id,
      historyKey: String(result.user.id),
      verified: true,
      displayName,
      user: result.user,
      authDate: result.authDate,
    };
  }
  // An allowlist must also protect metadata endpoints in anonymous development mode.
  if (config.ANON_MODE !== 'on' || config.ALLOWED_USER_IDS.length > 0) {
    res.status(401).json({ ok: false, error: 'Please open this Mini App from Telegram.' });
    return null;
  }
  if (!requireClientId) return { userId: anonBucketId('anon'), historyKey: 'anon:meta', verified: false };
  const clientId = req.get('X-Miniapp-Client-Id');
  if (typeof clientId !== 'string' || !ANON_CLIENT_ID.test(clientId)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid client session. Please reload the app.' });
    return null;
  }
  return { userId: anonBucketId(clientId), historyKey: `anon:${clientId}`, verified: false };
}
