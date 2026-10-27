// Minimal structured logger. Never log secrets (tokens, API keys, full message history).
type Level = 'info' | 'warn' | 'error';

function write(level: Level, args: unknown[]): void {
  const ts = new Date().toISOString();
  // console is fine for a small bot; swap for pino/winston if needed.
  if (level === 'error') console.error(`[${ts}] [${level}]`, ...args);
  else if (level === 'warn') console.warn(`[${ts}] [${level}]`, ...args);
  else console.log(`[${ts}] [${level}]`, ...args);
}

function sanitize(meta: unknown): unknown {
  if (meta == null || typeof meta !== 'object') return meta;
  const banned = ['token', 'apikey', 'api_key', 'authorization', 'OPENROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN'];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (banned.some((b) => k.toLowerCase().includes(b.toLowerCase()))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 500) {
      out[k] = v.slice(0, 500) + '…[truncated]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const log = {
  info: (metaOrMsg: unknown, msg?: string) =>
    write('info', msg !== undefined ? [msg, sanitize(metaOrMsg)] : [sanitize(metaOrMsg)]),
  warn: (metaOrMsg: unknown, msg?: string) =>
    write('warn', msg !== undefined ? [msg, sanitize(metaOrMsg)] : [sanitize(metaOrMsg)]),
  error: (metaOrMsg: unknown, msg?: string) =>
    write('error', msg !== undefined ? [msg, sanitize(metaOrMsg)] : [sanitize(metaOrMsg)]),
};
