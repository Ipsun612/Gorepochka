import type express from 'express';
import { identityRateLimit } from './middleware/identityRateLimit.js';
import { describeLorebook, saveLorebook } from '../services/lorebook/index.js';
import { lorebookUpdateSchema } from '../services/lorebook/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

export function registerLorebookRoutes(app: express.Express): void {
  app.use(
    '/api/lorebook',
    identityRateLimit({
      localsKey: 'lorebookIdentity',
      message: 'Слишком много запросов лорбука. Подождите минуту.',
    }),
  );
  const failure = (res: express.Response, err: unknown) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Lorebook operation failed');
    res.status(503).json({ ok: false, error: 'Не удалось прочитать или сохранить лорбук. Попробуйте ещё раз.' });
  };
  app.get('/api/lorebook', (_req, res) => {
    try {
      res.json(describeLorebook(res.locals.lorebookIdentity));
    } catch (err) {
      failure(res, err);
    }
  });
  app.post('/api/lorebook', (req, res) => {
    const parsed = lorebookUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error:
          'Можно сохранить до 3 личных записей: до 300 символов текста и 10 ключевых слов (до 60 символов каждое). Укажите ключ или включите постоянную запись. Основные записи менять нельзя.',
      });
      return;
    }
    try {
      saveLorebook(res.locals.lorebookIdentity, parsed.data);
      res.json(describeLorebook(res.locals.lorebookIdentity));
    } catch (error) {
      if (error instanceof ProfileConflict)
        res.status(409).json({
          ok: false,
          code: 'LOREBOOK_CONFLICT',
          error: 'Лорбук изменён на другом устройстве. Загрузите актуальную версию перед сохранением.',
        });
      else failure(res, error);
    }
  });
}
