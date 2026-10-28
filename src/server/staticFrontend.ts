import express from 'express';
import path from 'node:path';
import { config } from '../config/config.js';

function resolveWebappDir(): string {
  return path.isAbsolute(config.WEBAPP_DIR) ? config.WEBAPP_DIR : path.resolve(process.cwd(), config.WEBAPP_DIR);
}

// Static Mini App frontend (must be registered AFTER /api routes).
export function registerStaticFrontend(app: express.Express): void {
  const dir = resolveWebappDir();
  app.use(express.static(dir, { extensions: ['html'], maxAge: '5m', dotfiles: 'deny', index: false }));
  // SPA fallback: unknown non-API GETs serve index.html (if present).
  // NOTE: plain middleware (no '*' pattern) for Express 4/5 compatibility.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(dir, 'index.html'), (err) => {
      if (err) next();
    });
  });
}
