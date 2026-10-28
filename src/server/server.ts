import express from 'express';
import { config } from '../config/config.js';
import { log } from '../utils/logger.js';
import { registerBodyParser } from './middleware/bodyParser.js';
import { registerSecurityHeaders } from './middleware/securityHeaders.js';
import { registerCors } from './middleware/cors.js';
import { registerErrorHandler } from './middleware/errorHandler.js';
import { registerMetaRoutes } from './routes/metaRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { registerHistoryRoutes } from './routes/historyRoutes.js';
import { registerChatMetaRoutes } from './routes/chatMetaRoutes.js';
import { registerProfileRoutes } from './profileRoutes.js';
import { registerCharacterRoutes } from './characterRoutes.js';
import { registerLorebookRoutes } from './lorebookRoutes.js';
import { registerSettingsRoutes } from './settingsRoutes.js';
import { registerVideoRoutes } from './videoRoutes.js';
import { registerAudioRoutes } from './audioRoutes.js';
import { registerStaticFrontend } from './staticFrontend.js';
import { resolveIdentity } from './requestIdentity.js';

// Re-exported for backward compatibility (scripts/smoke-server-file.mjs).
export { MINIAPP_CHAT_SLOTS, miniAppChatKey, resolveChatSlot } from './chatSlots.js';

export function createServer(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Trust the single HTTPS tunnel hop (ngrok / cloudflared) so req.secure is
  // correct for HSTS. Without a public WEBAPP_URL there is no tunnel to trust.
  app.set('trust proxy', config.WEBAPP_URL ? 1 : 0);

  registerCors(app);
  registerBodyParser(app);
  registerSecurityHeaders(app);

  registerMetaRoutes(app);
  registerChatRoutes(app);
  registerHistoryRoutes(app);
  registerChatMetaRoutes(app);
  registerVideoRoutes(app, resolveIdentity);
  registerAudioRoutes(app);
  registerProfileRoutes(app);
  registerCharacterRoutes(app);
  registerLorebookRoutes(app);
  registerSettingsRoutes(app);

  registerStaticFrontend(app);
  registerErrorHandler(app);

  return app;
}

export function startServer(): void {
  const app = createServer();
  const port = config.PORT;
  app.listen(port, config.BIND_HOST, () => {
    log.info(`🌐 Mini App server listening on http://${config.BIND_HOST}:${port}`);
    if (config.BIND_HOST !== '127.0.0.1' && config.BIND_HOST !== 'localhost') {
      log.warn(
        'BIND_HOST is not loopback — ensure a firewall/reverse proxy guards this port; ' +
          'public traffic should arrive only via the HTTPS tunnel.',
      );
    }
    if (config.WEBAPP_URL) {
      log.info(`🔗 Public Mini App URL: ${config.WEBAPP_URL}`);
    } else {
      log.warn(
        'WEBAPP_URL is not set — the bot button will show setup instructions. ' +
          'Expose this server via HTTPS (ngrok / Cloudflare Tunnel) and set WEBAPP_URL in .env.',
      );
    }
    if (config.ANON_MODE === 'on') {
      log.warn(
        'ANON_MODE=on — /api accepts UNAUTHENTICATED requests. ' +
          'Dev tool only: never combine with a public WEBAPP_URL.',
      );
    }
  });
}
