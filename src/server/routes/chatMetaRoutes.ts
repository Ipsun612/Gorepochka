import type express from 'express';
import { resolveIdentity } from '../requestIdentity.js';
import { ChatMetaConflict, readChatMeta, saveChatMeta } from '../../services/chatMeta/index.js';
import { chatMetaUpdateSchema } from '../../services/chatMeta/types.js';
import { log } from '../../utils/logger.js';

const hits = new Map<string, { count: number; until: number }>();

export function registerChatMetaRoutes(app: express.Express): void {
  app.use('/api/chats', (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const now = Date.now();
    const previous = hits.get(identity.historyKey);
    const current = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
    current.count++;
    hits.delete(identity.historyKey);
    hits.set(identity.historyKey, current);
    while (hits.size > 10000) hits.delete(hits.keys().next().value!);
    if (current.count > 60) {
      res.status(429).json({ ok: false, error: 'Слишком много запросов диалогов. Подождите минуту.' });
      return;
    }
    res.locals.chatsIdentity = identity;
    next();
  });

  app.get('/api/chats', (_req, res) => {
    try {
      const meta = readChatMeta(res.locals.chatsIdentity);
      res.json({ ok: true, chats: meta });
    } catch {
      log.error('Chat meta read failed');
      res.status(503).json({ ok: false, error: 'Не удалось загрузить диалоги. Попробуйте ещё раз.' });
    }
  });

  app.put('/api/chats', (req, res) => {
    const parsed = chatMetaUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Укажите tabs (1..5, имена до 32 символов) и activeSlot.' });
      return;
    }
    try {
      const meta = saveChatMeta(res.locals.chatsIdentity, parsed.data);
      res.json({ ok: true, chats: meta });
    } catch (error) {
      if (error instanceof ChatMetaConflict) {
        res.status(409).json({
          ok: false,
          code: 'CHATS_CONFLICT',
          error: 'Диалоги изменены на другом устройстве. Загрузите актуальную версию.',
        });
        return;
      }
      log.error('Chat meta save failed');
      res.status(503).json({ ok: false, error: 'Не удалось сохранить диалоги. Попробуйте ещё раз.' });
    }
  });
}
