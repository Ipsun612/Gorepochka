import express from 'express';
import { maxBase64Length } from '../../services/images.js';
import { maxFileBase64Length } from '../../services/textfiles.js';

// Body parsing is split: only /api/chat may carry attachments, so it gets a
// larger limit while every other endpoint stays tight. The chat limit covers
// a worst-case message with BOTH a max-size image AND a max-size text file,
// bounding how much an unauthenticated caller can make us buffer.
export function registerBodyParser(app: express.Express): void {
  const parseSmall = express.json({ limit: '64kb' });
  const chatBodyLimit = maxBase64Length() + maxFileBase64Length() + 64 * 1024;
  const parseChat = express.json({ limit: chatBodyLimit });
  app.use((req, res, next) => {
    if (req.path === '/api/chat') return parseChat(req, res, next);
    return parseSmall(req, res, next);
  });
}
