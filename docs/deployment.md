# Deployment

## Exposing the Mini App (required for Telegram)

Telegram WebApps require HTTPS. The bot serves the frontend + API on `PORT` (default
3000), so the public HTTPS URL must tunnel to `http://localhost:3000`:

```powershell
# option A: cloudflared (recommended — no interstitial, Mini App opens on any device)
#   put cloudflared.exe next to package.json or install it on PATH, then:
npm run dev:tunnel
#   or directly: cloudflared tunnel --url http://localhost:3000

# option B: ngrok together with the bot in one window
npm run dev:all

# option C: ngrok alone (bot runs separately via `npm run dev`)
npm run dev:tunnel --provider=ngrok
# or directly: ngrok http 3000
```

> **⚠️ ngrok free-tier warning (the "stuck connecting" bug source):**
> ngrok's free plan injects a *"You are about to visit…"* interstitial for every
> request that looks like it comes from a browser — the Mini App page itself,
> `<script>`/CSS loads, and all `fetch()` API calls (every Telegram webview). It cannot
> be disabled server-side on the free plan; a device only gets through after clicking
> **Visit Site** once (a 7-day cookie), which Telegram webviews often fail to persist —
> leaving the Mini App permanently stuck on "connecting…". Use **cloudflared** (no
> interstitial) or any paid ngrok plan.

`npm run dev:all` runs `npm run dev` (bot + server) and `npm run dev:tunnel`
(`scripts/tunnel.mjs` → cloudflared if available, else `ngrok http $PORT`) side-by-side
via `concurrently`. `PORT` is read from the environment / `.env`.

Then set the public URL and restart:

```env
# .env
WEBAPP_URL=https://abcd1234.ngrok-free.app
PORT=3000
```

In Telegram send `/start` — you get a Russian welcome photo (from `assets/`, see
`assets/README.md`) plus an **✨ Открыть мини-приложение** button. Other messages get
the same short Russian redirect reply. The bot also tries
to set the default **Menu Button** (left of the message field) to the Mini App and
registers `/start /open /help` commands automatically.

Optional BotFather steps (in addition to the automatic setup):

- `/setmenubutton` → pick your bot → enter `WEBAPP_URL`
- `/setdomain` if Telegram asks for the WebApp domain

## Local browser testing

Local browser testing requires explicit `ANON_MODE=on` and uses isolated browser client
IDs, not a shared user. Development profiles are temporary and disappear after a server
restart. Inside Telegram, `initData` is HMAC-validated with your bot token; forged
`initData` gets `401`. In allowlist mode (`ALLOWED_USER_IDS` set), all anonymous API
access, including metadata, is blocked — open it from Telegram.

## Production checklist

- `npm run build` then `npm start` (run the compiled bot + Mini App server).
- Run behind a process manager (PM2/systemd/Docker) and use Telegram webhooks + a secret
  token instead of long polling.
- Put history/rate-limit state in Redis and use shared private storage + a durable job
  queue for video if you run multiple instances.
- Keep `BIND_HOST=127.0.0.1`; public traffic must arrive only through the HTTPS tunnel.
- Store the profile SQLite database on persistent storage, restricted with OS
   permissions/ACLs, and back it up carefully (SQLite WAL). See [Profiles](./profiles.md).
- Deploy `lorebooks/gorepochka.json` alongside `prompts/`, `webapp/`, `assets/`
  (welcome photo) and `dist/`.
  Fill in its two placeholders on the server and restart; malformed/missing primary
  lore fails startup. Private additions are included in the profile database backups.
  See [Lorebook](./lorebook.md).
- Keep FFmpeg/FFprobe decoder binaries patched and use OS/container resource isolation.
  See [Security](./security.md).
