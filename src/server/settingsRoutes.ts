import type express from 'express';
import { identityRateLimit } from './middleware/identityRateLimit.js';
import { readSettings, saveSettings } from '../services/settings/index.js';
import { settingsUpdateSchema } from '../services/settings/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

export function registerSettingsRoutes(app: express.Express): void {
  app.use(
    '/api/settings',
    identityRateLimit({
      localsKey: 'settingsIdentity',
      message: 'Слишком много запросов настроек. Подождите минуту.',
    }),
  );
  const failure = (res: express.Response, err: unknown) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings operation failed');
    res.status(503).json({ ok: false, error: 'Не удалось загрузить или сохранить настройки. Попробуйте ещё раз.' });
  };
  app.get('/api/settings', (_req, res) => {
    try {
      res.json({ ok: true, settings: readSettings(res.locals.settingsIdentity) });
    } catch (err) {
      failure(res, err);
    }
  });
  app.post('/api/settings', (req, res) => {
    const parsed = settingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Выберите светлую или тёмную тему.' });
      return;
    }
    try {
      res.json({ ok: true, settings: saveSettings(res.locals.settingsIdentity, parsed.data) });
    } catch (error) {
      if (error instanceof ProfileConflict)
        res.status(409).json({ ok: false, code: 'SETTINGS_CONFLICT', error: 'Тема изменена на другом устройстве.' });
      else failure(res, error);
    }
  });
}
