import { createBot, setupMiniAppMenu } from './bot/bot.js';
import { log } from './utils/logger.js';
import { loadSystemPrompt } from './services/prompts.js';
import { startServer } from './server/server.js';
import { shutdownVideos } from './services/videos.js';
import { shutdownAudio } from './services/audio.js';
import { profileStore, closeProfileStore } from './services/profile/store.js';
import { loadPrimaryLorebook } from './services/lorebook/primary.js';

async function main(): Promise<void> {
  loadSystemPrompt(); // fail-soft: falls back to built-in prompt if dir is empty
  loadPrimaryLorebook(); // Required, developer-owned canonical reference data.
  profileStore(); // Fail startup rather than silently losing saved profiles.

  // Serve the Telegram Mini App (pink-and-blue web chat) + /api/* on PORT.
  startServer();

  const bot = createBot();

  // Graceful shutdown (Ctrl+C, Docker/K8s SIGTERM).
  const stop = async (signal: string) => {
    log.info({ signal }, 'Shutting down…');
    bot.stop(signal);
    await shutdownVideos();
    await shutdownAudio();
    closeProfileStore();
    process.exit(0);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  // Fail fast on unhandled errors (but keep user messages generic in bot.ts).
  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled rejection');
  });

  await bot.launch(() => log.info('✅ Telegram AI bot started (long polling)'));
  // Best-effort: point the Telegram Menu Button at the Mini App.
  await setupMiniAppMenu(bot);
}

void main().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
