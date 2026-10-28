import type express from 'express';
import { resolveIdentity, type RequestIdentity } from '../requestIdentity.js';
import { identityRateLimit } from '../middleware/identityRateLimit.js';
import { MINIAPP_CHAT_SLOTS, resolveChatSlot } from '../chatSlots.js';
import { readHistory, saveMessageReaction } from '../../services/history/index.js';
import { toDisplayTurn } from '../../services/history/display.js';
import { getAudio } from '../../services/audio.js';
import { getVideo } from '../../services/videos.js';
import { readMedia } from '../../services/media/index.js';
import { normalizeReaction } from '../../services/tags/reaction.js';
import { log } from '../../utils/logger.js';

function videoDescriptorFor(
  identity: RequestIdentity,
  slot: number,
  videoId: string,
): {
  id: string;
  name: string;
  size: number;
  duration: number;
  poster: string | null;
  kind?: string;
  delivery: string;
} | null {
  const live = getVideo(videoId, identity.historyKey);
  if (live && live.state === 'ready') {
    return {
      id: live.id,
      name: live.name,
      size: live.sourceBytes,
      duration: live.duration,
      poster: live.poster,
      ...(live.kind === 'video-note' ? { kind: 'video-note' as const } : {}),
      delivery: 'sent',
    };
  }
  const saved = readMedia(identity, videoId);
  if (saved && (saved.kind === 'video' || saved.kind === 'video-note')) {
    return {
      id: saved.id,
      name: saved.name,
      size: saved.size,
      duration: saved.duration,
      poster: saved.poster,
      ...(saved.kind === 'video-note' ? { kind: 'video-note' as const } : {}),
      delivery: 'sent',
    };
  }
  return null;
}

function voiceDescriptorFor(
  identity: RequestIdentity,
  audioId: string,
): { id: string; duration: number; size: number; waveform: number[]; delivery: string } | null {
  const live = getAudio(audioId, identity.historyKey);
  if (live && live.state === 'ready') {
    return {
      id: live.id,
      duration: live.duration,
      size: live.sourceBytes,
      waveform: live.waveform,
      delivery: 'sent',
    };
  }
  const saved = readMedia(identity, audioId);
  if (saved && saved.kind === 'audio') {
    return {
      id: saved.id,
      duration: saved.duration,
      size: saved.size,
      waveform: saved.waveform,
      delivery: 'sent',
    };
  }
  return null;
}

function mediaIds(content: unknown): { videoId: string | null; audioId: string | null } {
  if (!Array.isArray(content)) return { videoId: null, audioId: null };
  let videoId: string | null = null;
  let audioId: string | null = null;
  for (const part of content as Array<{ type?: string; videoId?: string; audioId?: string }>) {
    if (part?.type === 'video_ref' && typeof part.videoId === 'string' && !videoId) videoId = part.videoId;
    if (part?.type === 'audio_ref' && typeof part.audioId === 'string' && !audioId) audioId = part.audioId;
  }
  return { videoId, audioId };
}

export function registerHistoryRoutes(app: express.Express): void {
  app.use('/api/chat/history', (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    res.locals.historyIdentity = identity;
    next();
  });
  app.use(
    '/api/chat/reaction',
    identityRateLimit({
      localsKey: 'historyIdentity',
      message: 'Слишком много запросов реакций. Подождите минуту.',
    }),
  );

  app.get('/api/chat/history', (req, res) => {
    try {
      const slot = resolveChatSlot(req.query.chatId === undefined ? undefined : Number(req.query.chatId));
      if (slot === null) {
        res.status(400).json({ ok: false, error: `"chatId" must be an integer 1..${MINIAPP_CHAT_SLOTS}.` });
        return;
      }
      const rawLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
      const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50;
      const identity: RequestIdentity = res.locals.historyIdentity;
      const entries = readHistory(identity, slot).slice(-limit);
      res.json({
        ok: true,
        chatId: slot,
        messages: entries.map((entry) => {
          const display = toDisplayTurn(entry.content);
          const { videoId, audioId } = mediaIds(entry.content);
          const video = videoId ? videoDescriptorFor(identity, slot, videoId) : null;
          const voice = audioId ? voiceDescriptorFor(identity, audioId) : null;
          return {
            id: entry.id,
            role: entry.role === 'assistant' ? 'bot' : 'user',
            text: display.text.slice(0, 24000),
            createdAt: entry.createdAt,
            userReaction: entry.userReaction,
            botReaction: entry.botReaction,
            image: display.image,
            file: display.file,
            video,
            voice,
            hasImage: display.images.length > 0,
            hasVideo: Boolean(videoId),
            hasAudio: Boolean(audioId),
          };
        }),
      });
    } catch (error) {
      log.error({ err: error instanceof Error ? error.message : String(error) }, 'History read failed');
      res.status(503).json({ ok: false, error: 'Не удалось загрузить историю. Попробуйте ещё раз.' });
    }
  });

  app.post('/api/chat/reaction', (req, res) => {
    const slot = resolveChatSlot(req.body?.chatId);
    const messageId = req.body?.messageId;
    const rawReaction = req.body?.reaction ?? null;
    if (slot === null || typeof messageId !== 'string' || messageId.length < 8 || messageId.length > 80) {
      res.status(400).json({ ok: false, error: 'Укажите chatId (1..5) и messageId.' });
      return;
    }
    let reaction: string | null = null;
    if (rawReaction !== null) {
      reaction = normalizeReaction(rawReaction);
      if (!reaction) {
        res.status(400).json({ ok: false, error: 'Недопустимая реакция.' });
        return;
      }
    }
    try {
      // User picks attach only to bot bubbles (assistant turns). AI reactions
      // on user turns are set at commit time and never modified here.
      const saved = saveMessageReaction(res.locals.historyIdentity, slot, messageId, 'userReaction', reaction);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'Сообщение не найдено.' });
        return;
      }
      res.json({ ok: true, chatId: slot, messageId: saved.id, userReaction: saved.userReaction });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Reaction save failed');
      res.status(503).json({ ok: false, error: 'Не удалось сохранить реакцию. Попробуйте ещё раз.' });
    }
  });
}
