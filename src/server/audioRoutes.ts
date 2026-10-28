import type express from 'express';
import Busboy from 'busboy';
import path from 'node:path';
import { config } from '../config/config.js';
import {
  createAudio,
  deleteAudio,
  describeAudio,
  getAudio,
  receiveAudio,
  pinAudio,
  type AudioUpload,
} from '../services/audio.js';
import { isRateLimited } from '../services/session.js';
import { resolveIdentity } from './requestIdentity.js';
import { toUserError } from '../utils/security.js';
import { profileStore } from '../services/profile/store.js';
import { getMediaRow, mediaFilePath } from '../services/media/store.js';

export function registerAudioRoutes(app: express.Express): void {
  app.post('/api/audio', (req, res) => {
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    if (isRateLimited(String(identity.userId))) {
      res.status(429).json({ ok: false, error: 'Слишком много загрузок. Подождите немного.' });
      return;
    }
    const slot = Number(req.query.chatId);
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
      res.status(400).json({ ok: false, error: 'Выберите активный диалог (1–5).' });
      return;
    }
    const maxRequest = config.MAX_AUDIO_BYTES + 64 * 1024;
    if (Number(req.headers['content-length']) > maxRequest) {
      res.status(413).json({ ok: false, error: 'Запись превышает лимит размера.' });
      return;
    }
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          fileSize: config.MAX_AUDIO_BYTES,
          files: 1,
          fields: 0,
          parts: 2,
          headerPairs: 30,
        },
      });
    } catch {
      res.status(400).json({ ok: false, error: 'Отправьте одну запись как multipart audio.' });
      return;
    }
    let audio: AudioUpload | undefined;
    let creation: Promise<void> | undefined;
    let invalid = false;
    let totalBytes = 0;
    const fail = (status: number, error: string) => {
      invalid = true;
      if (audio) void deleteAudio(audio);
      if (!res.headersSent) res.status(status).json({ ok: false, error });
      try {
        req.unpipe(parser);
      } catch {
        /* ignore */
      }
      try {
        parser.destroy();
      } catch {
        /* ignore */
      }
      req.resume();
    };
    const timeout = setTimeout(() => {
      fail(408, 'Время загрузки истекло. Попробуйте ещё раз.');
      req.unpipe(parser);
      parser.destroy();
      req.resume();
    }, config.AUDIO_PROCESS_TIMEOUT_MS);
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxRequest && !invalid) {
        fail(413, 'Запись превышает лимит размера.');
        req.unpipe(parser);
        parser.destroy();
        req.resume();
      }
    });
    req.once('aborted', () => {
      clearTimeout(timeout);
      invalid = true;
      if (audio) void deleteAudio(audio);
      parser.destroy();
    });
    parser.on('file', (field, stream) => {
      stream.on('error', () => {});
      if (field !== 'audio' || creation) {
        stream.resume();
        fail(400, 'Отправьте ровно одну аудиозапись.');
        return;
      }
      stream.pause();
      creation = (async () => {
        try {
          audio = await createAudio(identity.historyKey, `${identity.historyKey}#c${slot}`);
          if (invalid) {
            stream.resume();
            await deleteAudio(audio);
            return;
          }
          stream.once('limit', () => fail(413, 'Запись превышает лимит размера.'));
          void receiveAudio(audio, stream);
          stream.resume();
        } catch (error) {
          stream.resume();
          fail(503, toUserError(error).replace(/^⚠️\s*/, ''));
        }
      })();
    });
    parser.on('filesLimit', () => fail(400, 'Отправьте одну запись за раз.'));
    parser.on('fieldsLimit', () => fail(400, 'Лишние поля при загрузке.'));
    parser.on('partsLimit', () => fail(400, 'Отправьте ровно одну аудиозапись.'));
    parser.on('error', () => fail(400, 'Неполная или повреждённая загрузка аудио.'));
    parser.once('close', () => {
      clearTimeout(timeout);
      void (async () => {
        await creation;
        if (invalid || res.headersSent) return;
        if (!audio) {
          fail(400, 'Прикрепите аудиозапись.');
          return;
        }
        res.status(202).json({ ok: true, audio: describeAudio(audio) });
      })();
    });
    req.pipe(parser);
  });

  app.get('/api/audio/:id', (req, res) => {
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const audio = getAudio(String(req.params.id), identity.historyKey);
    if (audio) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, audio: describeAudio(audio) });
      return;
    }
    if (identity.verified) {
      try {
        const saved = getMediaRow(profileStore().getDb(), identity.userId, String(req.params.id));
        if (saved && saved.kind === 'audio') {
          res.setHeader('Cache-Control', 'private, no-store');
          res.json({
            ok: true,
            audio: {
              id: saved.id,
              state: 'ready',
              size: saved.size,
              bytes: saved.bytes,
              duration: saved.duration,
              waveform: saved.waveform,
            },
          });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.status(404).json({ ok: false, error: 'Запись недоступна или срок хранения истёк.' });
  });

  app.delete('/api/audio/:id', (req, res) => {
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const audio = getAudio(String(req.params.id), identity.historyKey);
    if (!audio) {
      res.status(404).json({ ok: false, error: 'Запись не найдена.' });
      return;
    }
    if (audio.pins || audio.committed) {
      res.status(409).json({ ok: false, error: 'Запись используется в диалоге. Очистите его, чтобы удалить аудио.' });
      return;
    }
    void deleteAudio(audio);
    res.json({ ok: true });
  });

  app.get('/api/audio/:id/media', (req, res) => {
    const identity = resolveIdentity(req, true, res);
    if (!identity) return;
    const audio = getAudio(String(req.params.id), identity.historyKey);
    if (audio && audio.state === 'ready') {
      const release = pinAudio(audio);
      res.setHeader('Cache-Control', 'private, no-store');
      res.type('audio/mpeg');
      res.sendFile(path.join(audio.directory, 'audio.mp3'), (error) => {
        release();
        if (error && !res.headersSent) res.status(404).end();
      });
      return;
    }
    if (identity.verified) {
      try {
        const saved = getMediaRow(profileStore().getDb(), identity.userId, String(req.params.id));
        if (saved && saved.kind === 'audio') {
          res.setHeader('Cache-Control', 'private, no-store');
          res.type('audio/mpeg');
          res.sendFile(mediaFilePath(saved.userId, saved.slot, saved.id, 'audio.mp3'), (error) => {
            if (error && !res.headersSent) res.status(404).end();
          });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.status(404).json({ ok: false, error: 'Запись недоступна или срок хранения истёк.' });
  });
}
