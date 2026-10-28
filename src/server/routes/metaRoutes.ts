import type express from 'express';
import { config } from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { listPromptFiles } from '../../services/prompts.js';
import { getBotAvatar, getBotProfile } from '../../services/botProfile.js';
import { resolveIdentity } from '../requestIdentity.js';

export function registerMetaRoutes(app: express.Express): void {
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/meta', async (req, res) => {
    // Not public: reveals bot identity/config details. Auth-gated like chat.
    if (!resolveIdentity(req, false, res)) return;
    // Best-effort bot identity sync (name + avatar). Never fail boot if Telegram is down.
    let bot: { name: string; username?: string; avatarUrl: string | null } | undefined;
    try {
      const profile = await getBotProfile();
      bot = {
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatarVersion ? `/api/bot-avatar?v=${encodeURIComponent(profile.avatarVersion)}` : null,
      };
    } catch (err) {
      log.warn({ err }, 'Bot profile sync failed, serving meta without it');
    }
    res.json({
      ok: true,
      model: config.OPENROUTER_MODEL,
      appName: config.APP_NAME,
      maxMessageLength: config.MAX_MESSAGE_LENGTH,
      // Image attachment limits the Mini App uses to pre-check a picked file.
      maxImageBytes: config.MAX_IMAGE_BYTES,
      maxImageDimension: config.IMAGE_MAX_DIMENSION,
      // Text-file attachment limits the Mini App uses to pre-check a picked file.
      maxFileBytes: config.MAX_FILE_BYTES,
      maxFileChars: config.FILE_MAX_CHARS,
      maxVideoBytes: config.MAX_VIDEO_BYTES,
      maxVideoDurationSeconds: config.VIDEO_MAX_DURATION_SECONDS,
      maxVideoNoteDurationSeconds: Math.min(60, config.VIDEO_MAX_DURATION_SECONDS),
      videoRetentionMs: config.VIDEO_TTL_MS,
      maxAudioBytes: config.MAX_AUDIO_BYTES,
      maxAudioDurationSeconds: config.AUDIO_MAX_DURATION_SECONDS,
      audioRetentionMs: config.AUDIO_TTL_MS,
      webappConfigured: Boolean(config.WEBAPP_URL),
      bot,
    });
  });

  // Proxied bot avatar (profile photo). Same-origin so the token never reaches the browser.
  // Non-sensitive decorative bytes (bot's own public profile photo) — kept open
  // but only for image content it fetched itself. Per-IP budget so anonymous
  // callers cannot turn Telegram fetches into an amplification loop (6h cache).
  const avatarHits = new Map<string, { count: number; until: number }>();
  app.get('/api/bot-avatar', async (req, res) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const prev = avatarHits.get(ip);
    const cur = prev && prev.until > now ? prev : { count: 0, until: now + 60000 };
    cur.count += 1;
    avatarHits.delete(ip);
    avatarHits.set(ip, cur);
    while (avatarHits.size > 5000) avatarHits.delete(avatarHits.keys().next().value!);
    if (cur.count > 120) {
      res.status(429).json({ ok: false, error: 'Too many requests. Please wait a minute.' });
      return;
    }
    try {
      const avatar = await getBotAvatar();
      if (!avatar) {
        res.status(404).json({ ok: false, error: 'No bot avatar set.' });
        return;
      }
      const etag = `"bot-${avatar.version}"`;
      if (req.headers['if-none-match'] === etag) {
        res.sendStatus(304);
        return;
      }
      res.setHeader('Content-Type', avatar.contentType);
      res.setHeader('Content-Length', String(avatar.buffer.length));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('ETag', etag);
      res.send(avatar.buffer);
    } catch (err) {
      log.warn({ err }, 'Bot avatar proxy failed');
      res.status(502).json({ ok: false, error: 'Could not load bot avatar.' });
    }
  });

  app.get('/api/prompts', (req, res) => {
    // Not public: prompt filenames expose the assistant's configuration.
    if (!resolveIdentity(req, false, res)) return;
    res.json({ ok: true, files: listPromptFiles() });
  });
}
