// Dev tunnel launcher: `npm run dev:tunnel` (used by `npm run dev:all`).
//
// Prefers cloudflared (no abuse interstitial — Mini Apps open directly on any
// device), falls back to ngrok. Both binaries resolve the same way: local exe
// next to package.json first, then PATH.
//
// ngrok caveat: the FREE tier injects a "You are about to visit…" interstitial
// page for every browser-looking request (page, scripts, CSS, and even the
// app's fetch()es). It cannot be disabled server-side; visitors only get
// through after clicking "Visit Site" once (cookie, valid for 7 days in that
// browser). This is what silently breaks the Mini App with a stuck
// "connecting…" screen. cloudflared has no such page; ngrok removes it on any
// paid plan.
import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolvePort() {
  const flag = process.argv.find((a) => a.startsWith('--port='));
  const raw = flag
    ? flag.split('=')[1]
    : (process.argv.find((a) => !a.startsWith('--') && /\d+/.test(a)) ?? process.env.PORT ?? '3000');
  const port = Number(String(raw).trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[tunnel] Invalid port: ${JSON.stringify(raw)} (expected 1-65535)`);
    process.exit(1);
  }
  return port;
}

function findLocalExe(name) {
  const local = path.join(rootDir, process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(local) ? local : null;
}

function findOnPath(name) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    stdio: 'ignore',
  });
  return probe.status === 0 ? name : null;
}

function resolveBinary(name) {
  return findLocalExe(name) ?? findOnPath(name) ?? null;
}

// Explicit provider selection wins; otherwise auto: cloudflared preferred.
const argvProvider = process.argv.find((a) => a.startsWith('--provider='));
const requested = argvProvider ? argvProvider.split('=')[1] : null;
if (requested && !['cloudflared', 'ngrok'].includes(requested)) {
  console.error(`[tunnel] Unknown --provider "${requested}" (use "cloudflared" or "ngrok")`);
  process.exit(1);
}

const port = resolvePort();

let provider = requested;
if (!provider) {
  const cloudflared = resolveBinary('cloudflared');
  provider = cloudflared ? 'cloudflared' : 'ngrok';
}
const bin = resolveBinary(provider);
if (!bin) {
  console.error(
    `[tunnel] ${provider} not found. Put ${provider}${process.platform === 'win32' ? '.exe' : ''} next to package.json or install it.`,
  );
  if (provider === 'cloudflared') {
    console.error(
      '[tunnel] cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    );
  } else {
    console.error('[tunnel] ngrok: https://ngrok.com/download');
  }
  process.exit(1);
}

let cmd, args;
if (provider === 'cloudflared') {
  // Quick tunnel: no Cloudflare account needed; a random trycloudflare.com URL
  // is printed on startup. Copy it into .env as WEBAPP_URL and restart the bot.
  console.log(`[tunnel] cloudflared tunnel --url http://127.0.0.1:${port} (${bin})`);
  console.log(
    '[tunnel] Copy the https://…trycloudflare.com URL into .env as WEBAPP_URL, then restart if you changed it.',
  );
  cmd = bin;
  args = ['tunnel', '--url', `http://127.0.0.1:${port}`];
} else {
  console.log(`[tunnel] ngrok http ${port} (${bin})`);
  console.log('[tunnel] Copy the https URL into .env as WEBAPP_URL, then restart if you changed it.');
  console.log('[tunnel] ngrok inspect UI: http://127.0.0.1:4040');
  console.warn(
    '[tunnel] WARNING: ngrok FREE injects a "You are about to visit…" interstitial for every\n' +
      '         browser request (Mini App page, scripts and API calls). Devices are blocked\n' +
      '         until they click "Visit Site" once (7-day cookie) — and Telegram webviews\n' +
      '         often fail to persist that cookie, so the Mini App keeps "connecting…".\n' +
      '         Prefer cloudflared (no interstitial) or any paid ngrok plan.',
  );
  cmd = bin;
  args = ['http', String(port)];
}

const child = spawn(cmd, args, { stdio: 'inherit' });

const forward = (signal) => {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill(signal);
    } catch {
      // ignore: child already exiting
    }
  }
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[tunnel] ${provider} exited via ${signal}`);
    return;
  }
  console.log(`[tunnel] ${provider} exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
