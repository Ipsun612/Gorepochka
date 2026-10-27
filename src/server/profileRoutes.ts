import type express from 'express';
import { config } from '../config/config.js';
import { resolveIdentity } from './requestIdentity.js';
import { describeProfile, loadProfile, saveProfile } from '../services/profile/index.js';
import { getUserAvatar } from '../services/profile/telegram.js';
import { ProfileConflict, profileUpdateSchema } from '../services/profile/types.js';
import { log } from '../utils/logger.js';

const hits = new Map<string, { count: number; until: number }>();
export function registerProfileRoutes(app: express.Express): void {
  // A separate budget: loading/saving profiles must not consume chat rate limits.
  app.use('/api/profile', (req, res, next) => {
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
    res.locals.profileIdentity = identity;
    next();
  });
  const limits = () => ({
    biographyMaxChars: config.PROFILE_BIO_MAX_CHARS,
    birthdayMinYear: 1900,
    birthdayMaxYear: new Date().getUTCFullYear(),
  });
  const failure = (res: express.Response) => {
    log.error('Profile operation failed'); // Never log database errors, biography or birthdays.
    res.status(503).json({ ok: false, error: 'Не удалось загрузить или сохранить профиль. Попробуйте ещё раз.' });
  };
  app.get('/api/profile', async (_req, res) => {
    try {
      res.json({ ok: true, profile: await loadProfile(res.locals.profileIdentity), limits: limits() });
    } catch {
      failure(res);
    }
  });
  app.post('/api/profile/sync', async (_req, res) => {
    try {
      res.json({ ok: true, profile: await loadProfile(res.locals.profileIdentity, true), limits: limits() });
    } catch {
      failure(res);
    }
  });
  app.post('/api/profile', (req, res) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ ok: false, error: 'Проверьте дату рождения и длину поля «О себе». Можно менять только эти два поля.' });
      return;
    }
    try {
      saveProfile(res.locals.profileIdentity, parsed.data);
      res.json({ ok: true, profile: describeProfile(res.locals.profileIdentity), limits: limits() });
    } catch (error) {
      if (error instanceof ProfileConflict) {
        res.status(409).json({
          ok: false,
          code: 'PROFILE_CONFLICT',
          error: 'Профиль изменён на другом устройстве. Загрузите актуальную версию, затем повторите изменения.',
        });
      } else failure(res);
    }
  });
  app.get('/api/profile/avatar', async (_req, res) => {
    const avatar = await getUserAvatar(res.locals.profileIdentity);
    if (!avatar) {
      res.status(404).json({ ok: false, error: 'Фото профиля недоступно.' });
      return;
    }
    res.type('image/jpeg').send(avatar);
  });
}
