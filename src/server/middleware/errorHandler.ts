import type express from 'express';
import { log } from '../../utils/logger.js';

// Body-parser + unexpected errors, always as JSON (never Express's HTML page)
// so the Mini App can show a clean message.
export function registerErrorHandler(app: express.Express): void {
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
    const type = (err as { type?: unknown })?.type;
    if (status === 413) {
      res.status(413).json({ ok: false, error: 'That file is too large. Please attach a smaller file.' });
      return;
    }
    if (status === 400 && type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, error: 'Malformed request body.' });
      return;
    }
    log.error({ err }, 'Unhandled server error');
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  });
}
