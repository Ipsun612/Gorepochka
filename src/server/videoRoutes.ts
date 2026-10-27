import type express from 'express';
import Busboy from 'busboy';
import path from 'node:path';
import { config } from '../config/config.js';
import {
  createVideo,
  deleteVideo,
  describeVideo,
  getVideo,
  receiveVideo,
  type VideoUpload,
} from '../services/videos.js';
import { cancelJob, cancelRequest, describeJob, getChatJob, findChatJob } from '../services/chatJobs.js';
import { isRateLimited } from '../services/session.js';
import { toUserError } from '../utils/security.js';
import { profileStore } from '../services/profile/store.js';
import { getMediaRow, mediaFilePath } from '../services/media/store.js';

type Authenticate = (
  req: express.Request,
  requireClient: boolean,
  res: express.Response,
) => { userId: number; historyKey: string; verified: boolean } | null;

export function registerVideoRoutes(app: express.Express, authenticate: Authenticate): void {
  app.post('/api/videos', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    if (isRateLimited(String(identity.userId))) {
      res.status(429).json({ ok: false, error: 'Too many uploads. Please wait a few seconds.' });
      return;
    }
    const slot = Number(req.query.chatId);
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
      res.status(400).json({ ok: false, error: 'Choose a valid chat slot (1..5).' });
      return;
    }
    const kind = req.query.kind ?? 'attachment';
    if (kind !== 'attachment' && kind !== 'video-note') {
      res.status(400).json({ ok: false, error: 'Unknown video kind.' });
      return;
    }
    const maxRequest = config.MAX_VIDEO_BYTES + 64 * 1024;
    if (Number(req.headers['content-length']) > maxRequest) {
      res.status(413).json({ ok: false, error: 'Video exceeds the upload size limit.' });
      return;
    }
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          fileSize: config.MAX_VIDEO_BYTES,
          files: 1,
          fields: 0,
          parts: 2,
          headerPairs: 30,
        },
      });
    } catch {
      res.status(400).json({ ok: false, error: 'Send one video as a multipart upload.' });
      return;
    }
    let video: VideoUpload | undefined;
    let creation: Promise<void> | undefined;
    let invalid = false;
    let totalBytes = 0;
    const fail = (status: number, error: string) => {
      invalid = true;
      if (video) void deleteVideo(video);
      if (!res.headersSent) res.status(status).json({ ok: false, error });
    };
    const timeout = setTimeout(() => {
      fail(408, 'Video upload timed out. Please try again.');
      req.unpipe(parser);
      parser.destroy();
      req.resume();
    }, config.VIDEO_PROCESS_TIMEOUT_MS);
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxRequest && !invalid) {
        fail(413, 'Video exceeds the upload size limit.');
        req.unpipe(parser);
        parser.destroy();
        req.resume();
      }
    });
    req.once('aborted', () => {
      clearTimeout(timeout);
      invalid = true;
      if (video) void deleteVideo(video);
      parser.destroy();
    });
    parser.on('file', (field, stream, info) => {
      stream.on('error', () => {}); // parser may fail while async storage reservation is pending
      if (field !== 'video' || creation) {
        stream.resume();
        fail(400, 'Send exactly one video.');
        return;
      }
      stream.pause();
      creation = (async () => {
        try {
          video = await createVideo(
            identity.historyKey,
            `${identity.historyKey}#c${slot}`,
            info.filename || 'video',
            kind,
          );
          if (invalid) {
            stream.resume();
            await deleteVideo(video);
            return;
          }
          stream.once('limit', () => fail(413, 'Video exceeds the upload size limit.'));
          // The upload response waits for parser.close, not expensive conversion.
          void receiveVideo(video, stream);
          stream.resume();
        } catch (err) {
          stream.resume();
          fail(503, toUserError(err).replace(/^⚠️\s*/, ''));
        }
      })();
    });
    parser.on('filesLimit', () => fail(400, 'Send one video at a time.'));
    parser.on('fieldsLimit', () => fail(400, 'Unexpected upload fields.'));
    parser.on('partsLimit', () => fail(400, 'Send exactly one video.'));
    parser.on('error', () => fail(400, 'Incomplete or malformed video upload.'));
    parser.once('close', () => {
      clearTimeout(timeout);
      void (async () => {
        await creation;
        if (invalid || res.headersSent) return;
        if (!video) {
          fail(400, 'Please attach a video.');
          return;
        }
        res.status(202).json({ ok: true, video: describeVideo(video) });
      })();
    });
    req.pipe(parser);
  });

  app.get('/api/videos/:id', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const video = getVideo(String(req.params.id), identity.historyKey);
    if (video) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, video: describeVideo(video) });
      return;
    }
    if (identity.verified) {
      try {
        const saved = getMediaRow(profileStore().getDb(), identity.userId, String(req.params.id));
        if (saved && (saved.kind === 'video' || saved.kind === 'video-note')) {
          res.setHeader('Cache-Control', 'no-store');
          res.json({
            ok: true,
            video: {
              id: saved.id,
              name: saved.name,
              kind: saved.kind,
              state: 'ready',
              size: saved.size,
              bytes: saved.bytes,
              duration: saved.duration,
              hasAudio: saved.hasAudio,
              poster: saved.poster,
            },
          });
          return;
        }
      } catch {
        /* fall through to 404 */
      }
    }
    res.status(404).json({ ok: false, error: 'Video expired or is unavailable. Please attach it again.' });
  });

  app.delete('/api/videos/:id', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const video = getVideo(String(req.params.id), identity.historyKey);
    if (!video) {
      res.status(404).json({ ok: false, error: 'Video not found.' });
      return;
    }
    if (video.pins || video.committed) {
      res.status(409).json({ ok: false, error: 'This video is in use. Clear its chat to remove it.' });
      return;
    }
    void deleteVideo(video);
    res.json({ ok: true });
  });

  app.get('/api/videos/:id/media', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const video = getVideo(String(req.params.id), identity.historyKey);
    if (video && video.state === 'ready') {
      res.setHeader('Cache-Control', 'private, no-store');
      res.type('video/mp4');
      res.sendFile(path.join(video.directory, 'video.mp4'), (err) => {
        if (err && !res.headersSent) res.status(404).json({ ok: false, error: 'Video is no longer available.' });
      });
      return;
    }
    if (identity.verified) {
      try {
        const saved = getMediaRow(profileStore().getDb(), identity.userId, String(req.params.id));
        if (saved && (saved.kind === 'video' || saved.kind === 'video-note')) {
          res.setHeader('Cache-Control', 'private, no-store');
          res.type('video/mp4');
          res.sendFile(mediaFilePath(saved.userId, saved.slot, saved.id, 'video.mp4'), (err) => {
            if (err && !res.headersSent) res.status(404).json({ ok: false, error: 'Video is no longer available.' });
          });
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.status(404).json({ ok: false, error: 'Video expired or is not ready. Please attach it again.' });
  });

  app.get('/api/chat-jobs/request/:requestId', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const job = findChatJob(identity.historyKey, String(req.params.requestId));
    if (!job) {
      res.status(404).json({ ok: false, code: 'JOB_UNAVAILABLE', error: 'Обработка сообщения не найдена.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...describeJob(job) });
  });

  app.get('/api/chat-jobs/:id', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const job = getChatJob(String(req.params.id), identity.historyKey);
    if (!job) {
      res.status(404).json({ ok: false, error: 'Analysis is no longer available.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...describeJob(job) });
  });
  app.delete('/api/chat-jobs/:id', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    const job = getChatJob(String(req.params.id), identity.historyKey);
    if (!job) {
      res.status(404).json({ ok: false, error: 'Analysis not found.' });
      return;
    }
    cancelJob(job);
    res.json({ ok: true, ...describeJob(job) });
  });
  app.delete('/api/chat-jobs/request/:id', (req, res) => {
    const identity = authenticate(req, true, res);
    if (!identity) return;
    cancelRequest(identity.historyKey, String(req.params.id));
    res.json({ ok: true });
  });
}
