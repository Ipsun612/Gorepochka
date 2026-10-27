import type express from 'express';
import { config } from '../../config/config.js';

// CORS: same-origin by default; only the Mini App's own public origin
// may call the API cross-origin. Never a wildcard: any website in any
// visitor's browser must not be able to invoke this API.
export function registerCors(app: express.Express): void {
  if (!config.WEBAPP_URL) return;
  const webappOrigin = new URL(config.WEBAPP_URL).origin;
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', webappOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Telegram-Init-Data, X-Miniapp-Client-Id, ngrok-skip-browser-warning',
    );
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}
