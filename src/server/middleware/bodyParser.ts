import express from 'express';
import { maxBase64Length } from '../../services/images.js';
import { maxFileBase64Length } from '../../services/textfiles.js';

// Body parsing is split: only /api/chat may carry attachments, so it gets a
// larger limit while every other endpoint stays tight. The chat limit covers
// a worst-case message with BOTH a max-size image AND a max-size text file.
// Unauthenticated callers never get the large buffer: without Telegram/client
// auth headers /api/chat parses as small (64kb) and rejects oversized bodies
// with 413 before allocating megabytes.
export function registerBodyParser(app: express.Express): void {
  const parseSmall = express.json({ limit: '64kb' });
  const chatBodyLimit = maxBase64Length() + maxFileBase64Length() + 64 * 1024;
  const parseChat = express.json({ limit: chatBodyLimit });
  app.use((req, res, next) => {
    if (req.path === '/api/chat') {
      const hasAuthHeader =
        typeof req.headers['x-telegram-init-data'] === 'string' ||
        typeof req.headers['x-miniapp-client-id'] === 'string';
      if (!hasAuthHeader) return parseSmall(req, res, next);
      return parseChat(req, res, next);
    }
    return parseSmall(req, res, next);
  });
}
