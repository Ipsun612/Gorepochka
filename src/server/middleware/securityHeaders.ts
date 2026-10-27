import type express from 'express';
import { config } from '../../config/config.js';

// Security headers (defense in depth for the Mini App frontend).
export function registerSecurityHeaders(app: express.Express): void {
  const frameAncestors = ["'self'"];
  if (config.WEBAPP_URL) frameAncestors.push(new URL(config.WEBAPP_URL).origin);
  frameAncestors.push('https://web.telegram.org'); // Telegram desktop web (iframe webview)
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://telegram.org", // telegram-web-app.js from the official CDN
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.join(' ')}`,
  ].join('; ');
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (_req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
}
