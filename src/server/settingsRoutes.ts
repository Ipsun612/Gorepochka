import type express from 'express';
import { resolveIdentity } from './requestIdentity.js';
import { readSettings, saveSettings } from '../services/settings/index.js';
import { settingsUpdateSchema } from '../services/settings/types.js';
import { ProfileConflict } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

const hits = new Map<string, { count: number; until: number }>();
export function registerSettingsRoutes(app: express.Express): void {
  app.use('/api/settings', (req, res, next) => {
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
      res.status(429).json({ ok: false, error: 'Слишком много запросов настроек. Подождите минуту.' });
      return;
    }
    res.locals.settingsIdentity = identity;
    next();
  });
  const failure = (res: express.Response) => {
    log.error('Settings operation failed');
    res.status(503).json({ ok: false, error: 'Не удалось загрузить или сохранить настройки. Попробуйте ещё раз.' });
  };
  app.get('/api/settings', (_req, res) => {
    try {
      res.json({ ok: true, settings: readSettings(res.locals.settingsIdentity) });
    } catch {
      failure(res);
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
      else failure(res);
    }
  });
}
