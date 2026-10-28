import type express from 'express';
import { identityRateLimit } from './middleware/identityRateLimit.js';
import { describeCharacter, saveCharacter } from '../services/character/index.js';
import { characterUpdateSchema } from '../services/character/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

export function registerCharacterRoutes(app: express.Express): void {
  app.use(
    '/api/character-profile',
    identityRateLimit({
      localsKey: 'characterIdentity',
      message: 'Слишком много запросов профиля. Подождите минуту.',
    }),
  );
  const failure = (res: express.Response, err: unknown) => {
    // Message only: never database rows, traits or settings drafts.
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Character profile operation failed');
    res
      .status(503)
      .json({ ok: false, error: 'Не удалось прочитать или сохранить характер Горепочки. Попробуйте ещё раз.' });
  };
  app.get('/api/character-profile', (_req, res) => {
    try {
      res.json(describeCharacter(res.locals.characterIdentity));
    } catch (err) {
      failure(res, err);
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
      else failure(res, error);
    }
  });
}
