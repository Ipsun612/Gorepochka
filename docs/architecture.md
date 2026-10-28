# Architecture

The bot is deliberately thin: **all AI chat happens in the Mini App.** The Telegram
side only redirects users; the Express server owns authentication, history, media
handling and OpenRouter calls. `src/bot/bot.ts` never calls OpenRouter.

## Request flow

- `/start` sends the Russian welcome: developer-supplied photo from `assets/`
  (`welcome.jpg`/`.jpeg`/`.png`/`.webp`, first match; text-only fallback when missing)
  with a short caption introducing Горепочка, plus
  `Markup.button.webApp('✨ Открыть мини-приложение', WEBAPP_URL)` (or setup instructions when
  `WEBAPP_URL` is empty).
- `/open`, `/app`, any text message, any photo/file, and any unknown command
  all receive the SAME short Russian redirect reply (text only, no photo).
  The redirect text is in Russian; the Mini App UI itself is
  in Russian.
- The Mini App (`webapp/app/`) reads `Telegram.WebApp.initData` and POSTs
  `{ message, chatId, image?, file?, fileName? }` to `/api/chat` with the auth
  in headers (`X-Telegram-Init-Data`, or `X-Miniapp-Client-Id` in anonymous dev
  mode) — never in the body.
- `src/server/server.ts` validates `initData` (`webappAuth.ts`), enforces allowlist +
  rate limit + input sanitizing, keeps a private history per chat slot
  (`services/session.ts`), calls OpenRouter, and processes hidden assistant tags. It
  returns `{ reply, messages: [{ text, delayMs }], userReaction }`; the Mini App displays each part
  as a separate bubble with character-based pauses (see
  [AI behavior](./ai-behavior.md)).
- `src/config/config.ts` validates the environment with `zod` and exits on startup if
  invalid. No secret value is ever logged.
- The optional `userReaction` emoji attaches to the triggering user bubble after reply
  delivery, including voice/video jobs. User selections attach only to bot bubbles.
  Both are device-local display metadata, not model history or Telegram Bot API calls.
  See [Reactions](./reactions.md).
- `src/index.ts` is the entrypoint: it loads the prompts and primary lorebook, opens the profile store,
  starts the Mini App server, launches the bot (long polling), then best-effort sets
  the Telegram menu button and command list.

## Multi-chat (max 5)

The Mini App has a compact chat tab bar under the header. Each chat has its own
durable dialog history in SQLite (`chat_messages`, keyed by `(user_id, slot)`,
35 pairs per slot) plus a light local display cache per slot (last 30 bubbles).
Tab names and the active slot persist cross-device in `chat_tabs`/`chat_meta`
with revision checks (`CHATS_CONFLICT`). Tap a tab to switch; **＋** creates a chat. The header **⋮** menu (also
available by tapping the active tab) provides **Переименовать**, **Очистить
историю**, **О модели**, **Настройки**, and **Удалить диалог**. The book/globe icon immediately left
of the user's avatar opens the lorebook. Clear/delete require confirmation;
the last live chat can be cleared rather than deleted. Free slots are reused within
1–5 only after successful server cleanup. Failed cleanup leaves existing chat metadata
and messages intact. Saved chat IDs above 5 are preserved as local-only read-only archives rather
than silently remapped or sent to the server (see [Frontend](./frontend.md)).

## Attachments

The same 📎 composer button accepts images (any format → re-encoded to JPEG), text
files (decoded as UTF-8, injected into the prompt) and video (streamed upload,
normalized to H.264/AAC MP4). See [Attachments](./attachments.md).
The microphone/camera switches recording mode on double-tap; single-tap starts/stops recording. Private audio uploads are normalized
to MP3 and resolved to native `input_audio` for the same model; voice turns and their
follow-ups use cancellable chat jobs. See [Voice messages](./voice-messages.md).
Circular video notes use the same video service/jobs with `kind: "video-note"`, a
60-second cap, square MP4 normalization and a dedicated circular player. Capture uses
a stable canvas track for mobile camera switching. See [Video notes](./video-notes.md).

## HTTP API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | health check |
| `GET` | `/api/meta` | model name, image/file limits, bot avatar URL |
| `GET` | `/api/bot-avatar` | public, proxied bot avatar |
| `GET` | `/api/prompts` | list prompt filenames (authenticated) |
| `POST` | `/api/chat` | send a message (text / image / file / video / voice); returns `userMessageId`/`assistantMessageId` turn ids |
| `POST` | `/api/new` | clear one chat slot (`chatId: 1..5`) or all slots (history + media, names kept) |
| `GET` | `/api/chat/history?chatId=1..5&limit=` | durable per-slot turns with `userReaction`/`botReaction`, inline JPEG `image`, `file` descriptor, playable `video`/`voice` descriptors |
| `POST` | `/api/chat/reaction` | set/clear a display-only reaction on an assistant turn (`userReaction`) |
| `GET`/`PUT` | `/api/chats` | cross-device tab names + active slot with revision checks (`CHATS_CONFLICT`) |
| `GET`/`POST` | `/api/profile`, `/api/profile/sync`, `/api/profile/avatar` | user profiles — see [Profiles](./profiles.md) |
| `GET`/`POST` | `/api/character-profile` | Горепочка's read-only identity + 15 per-user trait choices — see [Character profile](./character-profile.md) |
| `GET`/`POST` | `/api/lorebook` | one read-only primary book + three private entries per user — see [Lorebook](./lorebook.md) |
| `GET`/`POST` | `/api/settings` | per-user theme with revision checks — see [Settings](./settings.md) |
| `POST`/`GET`/`DELETE` | `/api/videos…`, `/api/chat-jobs…` | video upload, status, media and jobs — see [Attachments](./attachments.md) |
| `POST`/`GET`/`DELETE` | `/api/audio…` | voice upload, preparation, private playback and deletion |

## Services (`src/services/`)

- `openrouter.ts` — OpenRouter API client (timeout, sanitized errors).
- `images.ts` — image uploads: any format → JPEG (`sharp`).
- `textfiles.ts` — text-file uploads: base64 → validated, capped text.
- `ffmpeg.ts` — shared FFmpeg/FFprobe binary paths (project-local packages unless overridden).
- `videos.ts` — private video uploads (lazy tmpdir) + FFmpeg/FFprobe normalization; committed clips persist via `media/`.
- `audio.ts` — private audio uploads (tmpdir), MP3 normalization, waveforms and bounded native context; committed voice persists via `media/`.
- `media/` — durable `chat_media` + `MEDIA_DIR` files per `(user_id, slot, id)`; orphan prune on trim/clear; fallback for model resolve + private playback.
- `history/display.ts` — content → display (message/file split, inline images).
- `chatJobs.ts` — cancellable media analysis jobs + retry idempotency.
- `prompts.ts` — file-based system prompts (`NN_name.txt`/`.md` in prefix order).
- `tags/` — exact Russian tag registry, tokenizer + modular handlers.
- `typingDelay.ts` — Unicode character-based pauses between reply parts.
- `session.ts` — per-user history LRU cache over SQLite + per-user rate limiter (anon stays memory-only).
- `history/` — durable `chat_messages` per `(user_id, slot)` (35 pairs), display-only `userReaction`/`botReaction` columns, `GET history` / `POST reaction` shapes.
- `chatMeta/` — cross-device `chat_tabs` + `chat_meta` (names/activeSlot/revision) with `CHATS_CONFLICT`.
- `profile/` — persistent user profiles, Telegram sync + AI context; shared SQLite connection also stores character settings, history, tabs, reactions and media index.
- `character/` — 15-trait catalog, strict numeric validation, per-user settings + protected prompt guidance.
- `lorebook/` — strict four-field entries (including optional title `comment`, max 40 characters), primary JSON loader, literal keyword selection, private settings and reference context.
- `settings/` — validated, independently revisioned theme preferences in the shared profile database.
- `botProfile.ts` — bot name + avatar sync.

The profile, lorebook and settings screens share `webapp/app/profile/profileNavigation.js` for chat visibility, focus,
native Back/Settings and closing confirmation. Character settings have their own revisions
and table in `PROFILE_DB_PATH`, independent of user biography/birthday. Every `/api/chat`
snapshots both profile contexts and selected lore before starting work; storage failure stops generation. Numeric
trait choices map to trusted guidance outside the capped file prompt; the model never
receives arbitrary user-authored personality instructions as system text.

`lorebooks/gorepochka.json` is the single developer-owned primary reference book.
Private additions live in `lorebook_entries` in the same SQLite database, with independent
revisions. They are shared across five slots, but keyword selection scans only the
active slot's current text and last four history messages. Canonical reference contents
are separate from personal user-role background; neither is stored as history. All
text and media paths share the same snapshot. See [Lorebook](./lorebook.md).

`buildMessages` attaches selected personal facts as a JSON reference prefix to the
current user turn, rather than adding a standalone user message before the question.
It preserves text/media without mutating the original content committed to history.
