# GorCOgramm — Telegram Mini App (TypeScript + OpenRouter)

A Telegram bot that does **one thing**: it hands every user off to a pink-and-blue
**Mini App** where all AI chat happens. The Mini App — branded **GorCOgramm** — talks
to any model through [OpenRouter](https://openrouter.ai), with image, text-file and
video attachments, circular video notes, playable voice messages, five parallel chats, per-user profiles, and a Russian-speaking
persona named **Горепочка**. The classic Telegram chat is intentionally a no-op: every
message just points the user to the Mini App.

- **Frontend:** Telegram-inspired pink-and-blue messenger (`webapp/`, no build step)
  opened via an **✨ Открыть мини-приложение** button. The app brand is **GorCOgramm**; the
  chatbot is always displayed as **Горепочка**, independently of its Telegram profile
  name. The Mini App UI and the classic-chat replies are in Russian.
- **Bot chat:** `/start` sends a Russian welcome (photo from `assets/` + Mini App button)
  with a brief overview of Горепочка. `/open`, `/app` and any other text, photo/file,
  or unknown command get the same short Russian "open the Mini App" reply (text only, no photo).
  Classic chat AI is fully disabled. All AI chat lives only in the Mini App.
- **Backend:** Node.js + TypeScript + [Telegraf](https://telegraf.js.org) + Express
  talks to [OpenRouter](https://openrouter.ai) (`/chat/completions`). The developer
  picks the model via `OPENROUTER_MODEL` and core behavior via `prompts/` files;
  users can adjust 15 character traits without changing those core rules.

## What you get

- **Mini App only** — the bot redirects; all conversation, history and media handling
  live in the secured web app. See [Architecture](./docs/architecture.md).
- **Five parallel chats** — tab bar with rename/clear/delete and per-chat history.
- **Image attachments** — any common format, previewed then re-encoded to JPEG
  server-side for vision models. See [Attachments](./docs/attachments.md).
- **Text-file attachments** — `.txt`, `.md`, `.json`, code and config files injected
  into the prompt as context.
- **Video attachments** — streamed uploads, FFmpeg-normalized MP4, native `video_url`
  input, cancellation/retry and private playback.
- **Voice messages** — tap-to-record microphone input, second tap stops to preview,
  Send confirms, Delete/Escape discards,
  interruption preview and seeking,
  playable private bubbles, and native audio input to the same configured model.
  See [Voice messages](./docs/voice-messages.md).
- **Circular video messages** — double-tap the microphone/camera to switch modes, single tap
  to start/stop recording up to 60 seconds, then Send. Mobile-only camera flipping during capture;
  private circular playback with seeking and mute/unmute. The same model receives the
  actual video with audio. See [Video notes](./docs/video-notes.md).
- **Multi-message replies** — the hidden `<Разделить сообщение>` tag plus
  character-based typing pauses. See [AI behavior](./docs/ai-behavior.md).
- **Message reactions** — tap Горепочка's bubbles to choose from ten emojis;
  she can react to your current message using `<Поставить реакцию: ❤️>`.
  Each pill shows the reactor's Telegram avatar (initials fallback) beside the emoji.
  Reactions survive reload in the device-local chat cache, not across devices.
  See [Reactions](./docs/reactions.md).
- **Per-user profiles** — persisted name/username/biography context, private avatars,
  SQLite storage. See [Profiles](./docs/profiles.md).
- **App settings** — Telegram-inspired settings with light/dark themes synchronized
  across a user's devices, application version and a Russian changelog. See [Settings](./docs/settings.md).
- **Горепочка's profile** — tap her avatar for her biography and 15 personality traits,
  arranged in three groups of labelled choices; no free-text personality editor. Settings
  are private to each user, persist across devices and apply to all five chats without
  changing her identity or core rules. See [Character profile](./docs/character-profile.md).
- **One lorebook** — the book/globe icon to the left of your avatar shows locked primary entries and up to three private
  additions per user, shared across all five chats. Each addition allows 300 content
  characters and ten keywords, or permanent inclusion. Each entry has an optional
  title (`comment`, up to 40 characters). Edit the primary JSON on the server. See
  [Lorebook](./docs/lorebook.md).
  Active private facts accompany the current message (including media), so they can
  inform the dialogue without becoming system instructions or permanent history.
- **Hardened by default** — Telegram `initData` HMAC auth, optional allowlist, rate
  limiting and upload sanitizing. See [Security](./docs/security.md).

## Quick start

**Prerequisites**

- Node.js ≥ 18
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An OpenRouter API key from https://openrouter.ai/keys
- Video tools are installed automatically by `npm install` (`ffmpeg-static` and
  `ffprobe-static`); no separate FFmpeg install is required. The install needs access
  to the binary download host.
- A public **HTTPS** URL for the Mini App button (Telegram rejects plain HTTP). Use
  `cloudflared`, `ngrok`, or any HTTPS host.

**Setup**

```powershell
# in this folder
Copy-Item .env.example .env
# edit .env with your values (token, key, model)
npm install
npm run dev:all
# bot + tunnel together (concurrently) in one window.
# Mini App served at http://localhost:3000 (try it in a desktop browser for dev)
# Or run the bot alone: npm run dev
```

Production:

```powershell
npm run build
npm start
```

**Expose the Mini App** — Telegram WebApps require HTTPS, so the public URL must
tunnel to `http://localhost:3000`:

```powershell
npm run dev:tunnel          # cloudflared if available, else ngrok (recommended: cloudflared)
npm run dev:all             # bot + tunnel together in one window
```

Then set the public URL in `.env` and restart:

```env
WEBAPP_URL=https://abcd1234.ngrok-free.app
PORT=3000
```

Send `/start` in Telegram — you get a Russian welcome photo from `assets/` (see
`assets/README.md`) with a brief overview of Горепочка plus an **✨ Открыть мини-приложение**
button. The bot also sets
the default **Menu Button** and registers `/start /open /help` automatically.

> **⚠️ ngrok free-tier warning:** ngrok's free plan injects a *"You are about to
> visit…"* interstitial for browser-looking requests (the Mini App page, scripts and
> `fetch()` API calls), which can leave the Mini App stuck on "connecting…". Use
> **cloudflared** (no interstitial) or a paid ngrok plan. Full details and the
> production checklist are in [Deployment](./docs/deployment.md).

## Project structure

```
telegram bot/
├── src/
│   ├── index.ts            # entrypoint: prompts + Mini App server + bot launch
│   ├── bot/bot.ts          # Telegram handlers; /start sends welcome photo + web_app button + menu button
│   ├── server/             # Express: webapp/ + /api/* (auth, chat, profile, video/audio routes)
│   ├── config/config.ts    # env validation (zod, fail-fast, no secrets in logs)
│   ├── services/           # OpenRouter, prompts, sessions, tags, media, profiles, lorebook
│   └── utils/              # allowlist/sanitizing helpers + secret-redacting logger
├── webapp/                 # bundler-free Mini App (index.html, CSS, app/**/*.js ES modules)
│   │                       # app/ is grouped by feature: core/, chat/, voice/, video/,
│   │                       # media/, profile/, character/, lorebook/, reactions/, settings/
│   └── package.json        # only marks app/**/*.js as ES modules — no build step
├── prompts/                # ordered system prompt files (01_…, 02_…, 03_…) + README.md
├── assets/                   # /start welcome photo (welcome.jpg/.png, see assets/README.md)
├── lorebooks/gorepochka.json # single read-only primary book; edit on server + restart
├── scripts/                # dev tunnel + smoke tests (see docs/development.md)
├── data/profiles.sqlite    # user/character settings + private lore; persistent, git-ignored
├── .env.example            # copy to .env and fill in (never commit .env)
└── package.json, tsconfig.json, README.md
```

See [Architecture](./docs/architecture.md) for the request flow, the HTTP API and the
per-service breakdown.

## Configuration

Copy `.env.example` to `.env` and fill it in. Secrets live only in `.env`
(git-ignored). `src/config/config.ts` validates every value with `zod` and exits on
startup if something is invalid. Every variable and its default is documented in
[Configuration](./docs/configuration.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | hot-reload dev via `tsx watch` (bot + Mini App server) |
| `npm run dev:tunnel` | expose `PORT` publicly (cloudflared preferred, ngrok fallback) |
| `npm run dev:all` | bot + tunnel together via `concurrently` |
| `npm run build` | compile TypeScript to `dist/` |
| `npm start` | run compiled bot + Mini App server |
| `npm run typecheck` | type-check without emitting |
| `npm run lint` | eslint: `src/`, `webapp/`, `scripts/` |
| `npm run format` | prettier: rewrite code in place |
| `npm run format:check` | prettier: verify formatting without writing |
| `npm run docs:check` | env-key + script-table consistency check (configures AGENTS.md rule 1) |
| `npm run smoke:webapp` | Mini App module-graph smoke test (build first) |
| `npm run smoke:files` | text-file service smoke test (build first) |
| `npm run smoke:server` | `/api/chat` files + reply tags (stub OpenRouter, build first) |
| `npm run smoke:tags` | tag parsing, hidden tags, typing delays + delivery (build first) |
| `npm run smoke:videos` | real FFmpeg conversions + video API integration (build first) |
| `npm run smoke:audio` | audio conversions, native payloads, private playback + jobs (build first) |
| `npm run smoke:recorder` | voice capture permission races, formats, timing, limits + cleanup |
| `npm run smoke:video-notes` | single/double-tap gestures, camera switching/rollback, PC exclusion, limits + cleanup |
| `npm run smoke:profile` | signed auth, SQLite user/character settings, 15 traits + AI context (build first) |
| `npm run smoke:lorebook` | lore matching, strict limits, SQLite persistence, auth/isolation + AI context (build first) |
| `npm run smoke:settings` | theme sync, isolation, conflicts, early cache + changelog data (build first) |
| `npm run smoke` | build + run every smoke test |

`npm run smoke` is the pre-deploy check. See [Development](./docs/development.md).

## Documentation

- [Architecture](./docs/architecture.md) — request flow, multi-chat, HTTP API, services
- [Configuration](./docs/configuration.md) — every environment variable and default
- [Attachments](./docs/attachments.md) — images, text files and video
- [Voice messages](./docs/voice-messages.md) — recording UX, native audio, API and retention
- [Video notes](./docs/video-notes.md) — tap-to-record circles, mobile camera switching and playback
- [AI behavior](./docs/ai-behavior.md) — prompts, hidden tags and typing speed
- [Reactions](./docs/reactions.md) — emoji picker, AI reaction tag and local storage
- [Profiles](./docs/profiles.md) — settings, persistence, privacy and the profile API
- [Settings](./docs/settings.md) — synchronized themes, app version and changelog maintenance
- [Character profile](./docs/character-profile.md) — Горепочка's biography, 15 editable traits and immutable core rules
- [Lorebook](./docs/lorebook.md) — primary JSON template, private additions, keyword matching and context integration
- [Security](./docs/security.md) — auth, allowlist, rate limiting and upload hardening
- [Frontend](./docs/frontend.md) — GorCOgramm Mini App design and compatibility
- [Deployment](./docs/deployment.md) — tunnel setup, local testing and production
- [Development](./docs/development.md) — scripts and smoke tests
- [System prompts](./prompts/README.md) — prompt-file naming rules
