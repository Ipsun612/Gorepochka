import type express from 'express';
import { resolveIdentity } from './requestIdentity.js';
import { describeLorebook, saveLorebook } from '../services/lorebook/index.js';
import { lorebookUpdateSchema } from '../services/lorebook/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

const hits = new Map<string, { count: number; until: number }>();
export function registerLorebookRoutes(app: express.Express): void {
  app.use('/api/lorebook', (req, res, next) => {
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
      res.status(429).json({ ok: false, error: 'Слишком много запросов лорбука. Подождите минуту.' });
      return;
    }
    res.locals.lorebookIdentity = identity;
    next();
  });
  const failure = (res: express.Response) => {
    log.error('Lorebook operation failed');
    res.status(503).json({ ok: false, error: 'Не удалось прочитать или сохранить лорбук. Попробуйте ещё раз.' });
  };
  app.get('/api/lorebook', (_req, res) => {
    try {
      res.json(describeLorebook(res.locals.lorebookIdentity));
    } catch {
      failure(res);
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
      else failure(res);
    }
  });
}
