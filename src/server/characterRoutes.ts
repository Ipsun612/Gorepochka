import type express from 'express';
import { resolveIdentity } from './requestIdentity.js';
import { describeCharacter, saveCharacter } from '../services/character/index.js';
import { characterUpdateSchema } from '../services/character/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

const hits = new Map<string, { count: number; until: number }>();
export function registerCharacterRoutes(app: express.Express): void {
  app.use('/api/character-profile', (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const now = Date.now();
    const hit = hits.get(identity.historyKey);
    const current = hit && hit.until > now ? hit : { count: 0, until: now + 60000 };
    current.count++;
    hits.delete(identity.historyKey);
    hits.set(identity.historyKey, current);
    while (hits.size > 10000) hits.delete(hits.keys().next().value!);
    if (current.count > 60) {
      res.status(429).json({ ok: false, error: 'Слишком много запросов профиля. Подождите минуту.' });
      return;
    }
    res.locals.characterIdentity = identity;
    next();
  });
  const failure = (res: express.Response) => {
    log.error('Character profile operation failed');
    res
      .status(503)
      .json({ ok: false, error: 'Не удалось прочитать или сохранить характер Горепочки. Попробуйте ещё раз.' });
  };
  app.get('/api/character-profile', (_req, res) => {
    try {
      res.json(describeCharacter(res.locals.characterIdentity));
    } catch {
      failure(res);
    }
  });
  app.post('/api/character-profile', (req, res) => {
    const parsed = characterUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ ok: false, error: 'Можно менять только 15 черт характера: выберите один из трёх уровней для каждой.' });
      return;
    }
    try {
      saveCharacter(res.locals.characterIdentity, parsed.data);
      res.json(describeCharacter(res.locals.characterIdentity));
    } catch (error) {
      if (error instanceof ProfileConflict)
        res.status(409).json({
          ok: false,
          code: 'CHARACTER_CONFLICT',
          error: 'Характер изменён на другом устройстве. Загрузите актуальную версию перед сохранением.',
        });
      else failure(res);
    }
  });
}
