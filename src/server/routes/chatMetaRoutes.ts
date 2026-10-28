import type express from 'express';
import { identityRateLimit } from '../middleware/identityRateLimit.js';
import { ChatMetaConflict, readChatMeta, saveChatMeta } from '../../services/chatMeta/index.js';
import { chatMetaUpdateSchema } from '../../services/chatMeta/types.js';
import { log } from '../../utils/logger.js';

export function registerChatMetaRoutes(app: express.Express): void {
  app.use(
    '/api/chats',
    identityRateLimit({
      localsKey: 'chatsIdentity',
      message: 'Слишком много запросов диалогов. Подождите минуту.',
    }),
  );

  app.get('/api/chats', (_req, res) => {
    try {
      const meta = readChatMeta(res.locals.chatsIdentity);
      res.json({ ok: true, chats: meta });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Chat meta read failed');
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
      log.error({ err: error instanceof Error ? error.message : String(error) }, 'Chat meta save failed');
      res.status(503).json({ ok: false, error: 'Не удалось сохранить диалоги. Попробуйте ещё раз.' });
    }
  });
}
