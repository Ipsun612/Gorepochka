import type express from 'express';
import { resolveIdentity } from '../requestIdentity.js';

export interface IdentityRateLimitOptions {
  /** `res.locals` key the verified/anonymous identity is stored under. */
  localsKey: string;
  /** Requests allowed per window (per identity, per endpoint). Default 60. */
  limit?: number;
  /** Window length in ms. Default 60000. */
  windowMs?: number;
  /** Message returned with 429. */
  message?: string;
  /** Bound on tracked identities (LRU eviction). Default 10000. */
  maxKeys?: number;
}

/**
 * Shared auth + per-identity rate-limit middleware for Mini App routes.
 * Replaces the copy-pasted `hits` maps that used to live in every route file:
 * each endpoint keeps its own budget via a per-instance counter map.
 */
export function identityRateLimit({
  localsKey,
  limit = 60,
  windowMs = 60000,
  message = 'Слишком много запросов. Подождите минуту.',
  maxKeys = 10000,
}: IdentityRateLimitOptions): express.RequestHandler {
  const hits = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const now = Date.now();
    const previous = hits.get(identity.historyKey);
    const current = previous && previous.until > now ? previous : { count: 0, until: now + windowMs };
    current.count += 1;
    hits.delete(identity.historyKey);
    hits.set(identity.historyKey, current);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
    if (current.count > limit) {
      res.status(429).json({ ok: false, error: message });
      return;
    }
    res.locals[localsKey] = identity;
    next();
  };
}
