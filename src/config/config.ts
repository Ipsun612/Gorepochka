import 'dotenv/config';
import { z } from 'zod';

const IntFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return fallback;
      const trimmed = v.trim();
      if (!/^\d+$/.test(trimmed)) return Number.NaN;
      return Number(trimmed);
    })
    .pipe(z.number().int().positive());

const FloatFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().min(0).max(2));

const envSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is missing or too short'),
    OPENROUTER_API_KEY: z.string().min(10, 'OPENROUTER_API_KEY is missing or too short'),

    // Developer selects the model here. Any OpenRouter model ID is valid.
    OPENROUTER_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),

    APP_NAME: z.string().default('telegram-ai-bot'),
    APP_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? undefined : v)),
    OPENROUTER_TEMPERATURE: FloatFromString(0.7),
    OPENROUTER_MAX_TOKENS: IntFromString(1024),
    OPENROUTER_TIMEOUT_MS: IntFromString(60000),

    // File-based system prompts: any NN_name.txt/.md file inside this dir
    // (e.g. 01_base.txt, 02_style.txt) is concatenated in prefix order.
    PROMPTS_DIR: z.string().min(1).default('prompts'),
    PROMPT_MAX_TOTAL_CHARS: IntFromString(32000),

    ALLOWED_USER_IDS: z
      .string()
      .optional()
      .default('')
      .transform((v, ctx) => {
        const tokens = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const ids: number[] = [];
        for (const token of tokens) {
          if (!/^\d+$/.test(token)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid ALLOWED_USER_IDS entry "${token}" (expected a numeric Telegram user ID)`,
            });
            return z.NEVER;
          }
          const n = Number(token);
          if (!Number.isSafeInteger(n)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid ALLOWED_USER_IDS entry "${token}" (not a safe integer)`,
            });
            return z.NEVER;
          }
          ids.push(n);
        }
        return ids;
      }),

    MAX_HISTORY_MESSAGES: IntFromString(35),
    MAX_MESSAGE_LENGTH: IntFromString(4000),
    RATE_LIMIT_WINDOW_MS: IntFromString(10000),
    RATE_LIMIT_MAX_REQUESTS: IntFromString(3),

    PROFILE_DB_PATH: z.string().min(1).default('data/profiles.sqlite'),
    PROFILE_BIO_MAX_CHARS: IntFromString(2000).pipe(z.number().max(8000)),
    MEDIA_DIR: z.string().min(1).default('data/media'),

    // Character-based pauses between tag-separated Mini App reply messages.
    AI_TYPING_CHARS_PER_SECOND: IntFromString(20),
    AI_TYPING_MIN_DELAY_MS: IntFromString(800),
    AI_TYPING_MAX_DELAY_MS: IntFromString(8000).pipe(z.number().max(2_147_483_647)),

    // --- Image attachments (Mini App) ---
    // Max size of an uploaded source image (any format, before JPEG conversion).
    MAX_IMAGE_BYTES: IntFromString(10 * 1024 * 1024),
    // Longest side (px) the converted JPEG is scaled down to (keeps vision payloads small).
    IMAGE_MAX_DIMENSION: IntFromString(1568),
    // JPEG quality (clamped to 1..100) used when re-encoding uploads.
    IMAGE_JPEG_QUALITY: IntFromString(80),
    // Reject images with more total pixels than this (decompression-bomb guard).
    IMAGE_MAX_PIXELS: IntFromString(40_000_000),

    // --- Text-file attachments (Mini App) ---
    // Max size of an uploaded text file (any text/code format, before decoding).
    MAX_FILE_BYTES: IntFromString(2 * 1024 * 1024),
    // Max number of characters of file content injected into the model prompt.
    FILE_MAX_CHARS: IntFromString(20000),

    // Video uploads are streamed to private temporary storage, never JSON/base64.
    MAX_VIDEO_BYTES: IntFromString(100 * 1024 * 1024),
    VIDEO_MAX_DURATION_SECONDS: IntFromString(300),
    VIDEO_MAX_OUTPUT_BYTES: IntFromString(20 * 1024 * 1024),
    VIDEO_MAX_DIMENSION: IntFromString(1280).pipe(z.number().min(2).max(3840)),
    VIDEO_MAX_PIXELS: IntFromString(33_177_600),
    VIDEO_PROCESS_TIMEOUT_MS: IntFromString(180000),
    VIDEO_ANALYSIS_TIMEOUT_MS: IntFromString(180000),
    VIDEO_TTL_MS: IntFromString(60 * 60 * 1000),
    VIDEO_MAX_CONCURRENT: IntFromString(2),
    VIDEO_MAX_STORED: IntFromString(20),
    // Voice recordings: binary uploads and native audio input to the same model.
    MAX_AUDIO_BYTES: IntFromString(20 * 1024 * 1024),
    AUDIO_MAX_DURATION_SECONDS: IntFromString(300),
    AUDIO_MAX_OUTPUT_BYTES: IntFromString(3 * 1024 * 1024),
    AUDIO_CONTEXT_MAX_BYTES: IntFromString(6 * 1024 * 1024),
    AUDIO_PROCESS_TIMEOUT_MS: IntFromString(60000),
    AUDIO_ANALYSIS_TIMEOUT_MS: IntFromString(180000),
    AUDIO_TTL_MS: IntFromString(60 * 60 * 1000),
    AUDIO_MAX_CONCURRENT: IntFromString(2),
    AUDIO_MAX_STORED: IntFromString(50),
    // Optional overrides; otherwise use the project-local npm binaries.
    FFMPEG_PATH: z.string().optional(),
    FFPROBE_PATH: z.string().optional(),

    // --- Mini App (Telegram WebApp) ---
    // Public HTTPS URL where the Mini App frontend is hosted
    // (e.g. https://abcd1234.ngrok-free.app). Empty = local-only / not configured yet.
    // The bot's /start button uses this URL for the web_app button.
    WEBAPP_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal(''))
      .default('')
      .transform((v) => (v === '' ? undefined : v)),
    // Local directory with the Mini App static files (served by the built-in HTTP server).
    WEBAPP_DIR: z.string().min(1).default('webapp'),
    // Port for the built-in HTTP server (serves Mini App + /api/*).
    PORT: IntFromString(3000),
    // Interface the HTTP server binds to. Keep 127.0.0.1: public traffic should
    // arrive only through the HTTPS tunnel (ngrok / Cloudflare), never directly.
    BIND_HOST: z.string().min(1).default('127.0.0.1'),
    // SECURITY: anonymous, unauthenticated /api access (plain browser dev mode).
    // 'off' (default) => a valid Telegram initData is REQUIRED for every /api call.
    // 'on'  => exposes an UNAUTHENTICATED endpoint that uses your OpenRouter key.
    //          Enable only for local development; never with a public WEBAPP_URL.
    ANON_MODE: z.enum(['on', 'off']).default('off'),
  })
  .superRefine((env, ctx) => {
    if (env.AUDIO_CONTEXT_MAX_BYTES < env.AUDIO_MAX_OUTPUT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUDIO_CONTEXT_MAX_BYTES'],
        message: 'Must fit at least one AUDIO_MAX_OUTPUT_BYTES recording',
      });
    }
    if (env.AI_TYPING_MIN_DELAY_MS > env.AI_TYPING_MAX_DELAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_TYPING_MIN_DELAY_MS'],
        message: 'Must not exceed AI_TYPING_MAX_DELAY_MS',
      });
    }
    if (env.ANON_MODE === 'on' && env.WEBAPP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANON_MODE'],
        message: 'ANON_MODE=on must not be combined with a public WEBAPP_URL (unauthenticated OpenRouter billing).',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Never print secret values, only field-level errors.
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`[config] Invalid environment:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;

// Helper for OpenRouter attribution headers (improves rate limits).
export function getRefererHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Title': config.APP_NAME };
  if (config.APP_URL) headers['HTTP-Referer'] = config.APP_URL;
  return headers;
}
