import * as fs from 'node:fs';
import path from 'node:path';
import { Markup, Telegraf, type Context } from 'telegraf';
import type { MenuButtonWebApp } from '@telegraf/types';
import { config } from '../config/config.js';
import { log } from '../utils/logger.js';
import { isRateLimited } from '../services/session.js';
import { isAllowedUser } from '../utils/security.js';

// ---------------------------------------------------------------------------
// Mini App only: classic bot-chat AI is fully disabled.
// /start sends the Russian welcome (photo + Mini App button); every other
// message outside the Mini App gets the same short Russian redirect reply.
// ---------------------------------------------------------------------------

const WELCOME_CAPTION_RU =
  'Привет! Это GorCOgramm 💖\n\n' +
  'Здесь живёт Горепочка — собеседница для дружеского общения. ' +
  'Ей 17, она любит видеоигры, музыку и пение, мемы, кино и прогулки.\n\n' +
  'Всё общение проходит внутри мини-приложения: отдельные чаты, ' +
  'голосовые и видео, фото и файлы.\n\n' +
  'Нажми кнопку ниже, чтобы открыть приложение 👇';

const SHORT_REDIRECT_RU =
  '💖 Открой мини-приложение, чтобы продолжить общение 💙\n\n' +
  'Весь чат живёт внутри мини-приложения.\n' +
  'Нажми ✨ Открыть мини-приложение ниже (или отправь /start) 👇';

const OPEN_BUTTON_TEXT = '✨ Открыть мини-приложение';

// Welcome image supplied by the developer in assets/ (not committed:
// place welcome.jpg/.jpeg/.png/.webp there). Sent as a photo with /start;
// when the file is missing the bot falls back to a text-only reply.
const WELCOME_IMAGE_NAMES = ['welcome.jpg', 'welcome.jpeg', 'welcome.png', 'welcome.webp'];

function resolveWelcomeImagePath(): string | undefined {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const name of WELCOME_IMAGE_NAMES) {
    candidates.push(path.resolve(process.cwd(), 'assets', name));
    // __dirname is src/bot in dev (tsx) and dist/bot when compiled —
    // ../../assets resolves to the project-root assets/ in both cases.
    candidates.push(path.resolve(__dirname, '../../assets', name));
  }
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function miniAppKeyboard(): ReturnType<typeof Markup.inlineKeyboard> | undefined {
  if (!config.WEBAPP_URL) return undefined;
  return Markup.inlineKeyboard([[Markup.button.webApp(OPEN_BUTTON_TEXT, config.WEBAPP_URL)]]);
}

function unconfiguredText(): string {
  return (
    `💖 Открой мини-приложение, чтобы продолжить общение 💙\n\n` +
    `Мини-приложение пока не настроено (разработчик: задай WEBAPP_URL в .env).\n` +
    `Когда всё будет готово, общение будет жить внутри мини-приложения.`
  );
}

type ReplyTarget = Pick<Context, 'reply'> & Partial<Pick<Context, 'replyWithPhoto'>>;

async function sendOpenPrompt(ctx: ReplyTarget): Promise<void> {
  const kb = miniAppKeyboard();
  if (kb) {
    await ctx.reply(SHORT_REDIRECT_RU, kb);
  } else {
    await ctx.reply(unconfiguredText());
  }
}

// /start only: Russian welcome caption + developer-supplied photo from
// assets/ + Mini App button. Falls back to text when the image is missing
// or the photo upload fails.
async function sendWelcome(ctx: ReplyTarget): Promise<void> {
  const kb = miniAppKeyboard();
  const imagePath = resolveWelcomeImagePath();
  if (imagePath && ctx.replyWithPhoto) {
    try {
      if (kb) {
        await ctx.replyWithPhoto({ source: imagePath }, { caption: WELCOME_CAPTION_RU, ...kb });
      } else {
        await ctx.replyWithPhoto({ source: imagePath }, { caption: unconfiguredText() });
      }
      return;
    } catch (err) {
      log.warn({ err }, 'Welcome photo failed, falling back to text');
    }
  }
  if (kb) {
    await ctx.reply(WELCOME_CAPTION_RU, kb);
  } else {
    await ctx.reply(unconfiguredText());
  }
}

const HELP_TEXT =
  '🤖 <b>Помощь</b>\n\n' +
  'Всё общение — <b>только</b> в <b>мини-приложении</b>: нажми <b>✨ Открыть мини-приложение</b> из /start.\n\n' +
  'Сообщения сюда не получают ответы от ИИ — бот лишь напомнит открыть мини-приложение.\n\n' +
  '<b>Команды:</b>\n' +
  '/start — открыть мини-приложение\n' +
  '/open — открыть мини-приложение\n' +
  '/help — эта справка';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

  // 1. Access control (runs first — no info leak to blocked users).
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId === undefined || !isAllowedUser(userId)) {
      log.warn({ userId }, 'Blocked unauthorized access');
      return;
    }
    await next();
  });

  // 2. Rate limiting.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== undefined && isRateLimited(String(userId))) {
      await ctx.reply('⏳ Слишком много запросов. Подожди немного.');
      return;
    }
    await next();
  });

  // --- Mini App entry: /start sends the Russian welcome (photo + button) ---
  bot.start(async (ctx) => {
    await sendWelcome(ctx);
  });

  bot.command('open', async (ctx) => {
    await sendOpenPrompt(ctx);
  });

  bot.command('app', async (ctx) => {
    await sendOpenPrompt(ctx);
  });

  bot.help(async (ctx) => {
    const kb = miniAppKeyboard();
    if (kb) {
      await ctx.replyWithHTML(HELP_TEXT, kb);
    } else {
      await ctx.replyWithHTML(HELP_TEXT);
    }
  });

  // Main handler: ANY text message -> SAME redirect, never calls AI.
  bot.on('text', async (ctx) => {
    await sendOpenPrompt(ctx);
  });

  // Image/file attachments in classic chat are redirected too — uploads and
  // vision answers live in the Mini App.
  bot.on(['photo', 'document'], async (ctx) => {
    await sendOpenPrompt(ctx);
  });

  // Global error handler — never expose internals to the chat.
  bot.catch((err, ctx) => {
    log.error({ err }, 'Telegraf error');
    void ctx.reply?.('⚠️ Что-то пошло не так. Попробуй ещё раз.').catch(() => undefined);
  });

  return bot;
}

/**
 * Point Telegram's default Menu Button at the Mini App (the button left of
 * the message field). Best-effort: logs a warning if it fails (e.g. URL not
 * reachable / not HTTPS yet). Call once after launch when WEBAPP_URL is set.
 */
export async function setupMiniAppMenu(bot: Telegraf): Promise<void> {
  if (!config.WEBAPP_URL) return;
  try {
    const menuButton: MenuButtonWebApp = {
      type: 'web_app',
      text: 'Открыть приложение',
      web_app: { url: config.WEBAPP_URL },
    };
    await bot.telegram.setChatMenuButton({ menuButton });
    log.info('📌 Menu button points to the Mini App');
  } catch (err) {
    log.warn({ err }, 'Could not set Menu Button (is WEBAPP_URL public HTTPS?)');
  }
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Открыть мини-приложение 💖' },
      { command: 'open', description: 'Открыть мини-приложение' },
      { command: 'help', description: 'Показать помощь' },
    ]);
  } catch (err) {
    log.warn({ err }, 'Could not set bot commands');
  }
}
