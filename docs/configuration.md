# Configuration

Copy `.env.example` to `.env` and fill it in. Secrets live **only** in `.env`
(git-ignored); `.env.example` holds placeholders. `src/config/config.ts` validates
every value with `zod` and exits on startup if anything is invalid, printing
field-level errors only (never secret values).

Restart the backend after changing `.env`.

## Required secrets

| Variable | Notes |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather). |
| `OPENROUTER_API_KEY` | From https://openrouter.ai/keys. |

## Model and OpenRouter

Any [OpenRouter model ID](https://openrouter.ai/models) works. Check the active model
in the Mini App's **⋮ → О модели** dialog.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | The model used for every request. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base. |
| `APP_NAME` | `telegram-ai-bot` | Attribution title (`X-Title` header). |
| `APP_URL` | _(unset)_ | Optional `HTTP-Referer` attribution URL. |
| `OPENROUTER_TEMPERATURE` | `0.7` | Sampling temperature (0–2). |
| `OPENROUTER_MAX_TOKENS` | `1024` | Max output tokens. |
| `OPENROUTER_TIMEOUT_MS` | `60000` | Abort timeout for each OpenRouter call. |

Images need a **vision-capable** model (e.g. `openai/gpt-4o-mini`,
`anthropic/claude-3.5-sonnet`, `google/gemini-flash-1.5`). Video needs a model that
supports native video (and audio-in-video) input. Voice messages require native
`input_audio` with MP3. See [Attachments](./attachments.md) and [Voice messages](./voice-messages.md).

## System prompts

Behavior lives in ordered files, not an env-var string. See
[AI behavior](./ai-behavior.md) and [`prompts/README.md`](../prompts/README.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROMPTS_DIR` | `prompts` | Directory of ordered `NN_name.txt`/`.md` files (relative or absolute). |
| `PROMPT_MAX_TOTAL_CHARS` | `32000` | Ordered-file budget: whole chunks only; oversized core fails startup, later non-fitting chunks are skipped. |

Runtime character guidance and profile trust boundaries are appended outside this file
budget. The bundled prompt files fit the default budget without partial instructions.

## Access and limits

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_USER_IDS` | _(empty = public)_ | Comma-separated Telegram user IDs allowed to use the bot + Mini App. Entries must be numeric IDs — a typo fails startup instead of silently opening the bot. |
| `MAX_HISTORY_MESSAGES` | `35` | Per-chat history depth kept for the model (70 entries per slot, durable in SQLite and shared across devices). |
| `MAX_MESSAGE_LENGTH` | `4000` | Maximum input length (characters). |
| `RATE_LIMIT_WINDOW_MS` | `10000` | Sliding-window size for the per-user rate limiter. |
| `RATE_LIMIT_MAX_REQUESTS` | `3` | Requests allowed per window (shared by bot chat and Mini App). |

## Mini App server

| Variable | Default | Meaning |
| --- | --- | --- |
| `WEBAPP_URL` | _(empty)_ | Public **HTTPS** URL of the Mini App. The `/start` button and menu button use it. Empty shows setup instructions. |
| `WEBAPP_DIR` | `webapp` | Static directory served at `/`. |
| `PORT` | `3000` | Port for the Mini App + API server. |
| `BIND_HOST` | `127.0.0.1` | Interface the server binds to. Keep loopback; public traffic should arrive only via the HTTPS tunnel. |
| `ANON_MODE` | `off` | `on` allows unauthenticated `/api` access for local browser development, using your OpenRouter key. Dev tool only — startup fails when combined with a public `WEBAPP_URL`. |

## Reply delivery (typing pauses)

Only the exact Russian tag `<Разделить сообщение>` creates a separate message. The
first part appears immediately; later parts wait for their own typing time. See
[AI behavior](./ai-behavior.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_TYPING_CHARS_PER_SECOND` | `20` | Simulated typing speed. |
| `AI_TYPING_MIN_DELAY_MS` | `800` | Minimum pause between messages. |
| `AI_TYPING_MAX_DELAY_MS` | `8000` | Maximum pause per message. |

All three are positive integers and the minimum must not exceed the maximum.

## Image attachments

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_IMAGE_BYTES` | `10485760` | Max source file size accepted (bytes). |
| `IMAGE_MAX_DIMENSION` | `1568` | Longest side (px) of the converted JPEG. |
| `IMAGE_JPEG_QUALITY` | `80` | JPEG quality of the converted image (1–100). |
| `IMAGE_MAX_PIXELS` | `40000000` | Reject larger pixel counts (decompression-bomb guard). |

## Text-file attachments

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_FILE_BYTES` | `2097152` | Max source text-file size accepted (bytes). |
| `FILE_MAX_CHARS` | `20000` | Max characters injected into the prompt (rest truncated). |

## Video attachments

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_VIDEO_BYTES` | `104857600` | Maximum source file: 100 MiB. |
| `VIDEO_MAX_DURATION_SECONDS` | `300` | Maximum duration: five minutes. |
| `VIDEO_MAX_OUTPUT_BYTES` | `20971520` | Maximum normalized AI payload: 20 MiB. |
| `VIDEO_MAX_DIMENSION` | `1280` | Maximum converted width/height. |
| `VIDEO_MAX_PIXELS` | `33177600` | Maximum source frame pixel count. |
| `VIDEO_PROCESS_TIMEOUT_MS` | `180000` | Per-process and upload timeout. |
| `VIDEO_ANALYSIS_TIMEOUT_MS` | `180000` | Provider timeout for video conversations. |
| `VIDEO_TTL_MS` | `3600000` | Private media/job retention. |
| `VIDEO_MAX_CONCURRENT` | `2` | Maximum uploads/conversions at once. |
| `VIDEO_MAX_STORED` | `20` | Maximum retained upload records. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | npm binaries | Optional absolute paths to decoder binaries. |

The Mini App reads size/duration limits from `/api/meta`.
Circular video notes reuse these byte/output/storage limits but have a fixed maximum
of 60 seconds (or `VIDEO_MAX_DURATION_SECONDS` when lower), exposed as
`maxVideoNoteDurationSeconds`. Their normalized square frame is capped at 480 px or a
lower `VIDEO_MAX_DIMENSION`. No additional provider/model or environment variable is
needed. See [Video notes](./video-notes.md).

## Voice messages

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_AUDIO_BYTES` | `20971520` | Maximum source recording: 20 MiB. |
| `AUDIO_MAX_DURATION_SECONDS` | `300` | Maximum recorded voice duration. |
| `AUDIO_MAX_OUTPUT_BYTES` | `3145728` | Maximum complete normalized MP3: 3 MiB. |
| `AUDIO_CONTEXT_MAX_BYTES` | `6291456` | Recent audio attached to each model request; must fit one max-size output. |
| `AUDIO_PROCESS_TIMEOUT_MS` | `60000` | Upload and per-decoder-process timeout. |
| `AUDIO_ANALYSIS_TIMEOUT_MS` | `180000` | Model timeout for audio-only media context; video context uses its timeout. |
| `AUDIO_TTL_MS` | `3600000` | Private audio retention. Completed jobs use the larger audio/video TTL. |
| `AUDIO_MAX_CONCURRENT` | `2` | Maximum simultaneous audio uploads/conversions. |
| `AUDIO_MAX_STORED` | `50` | Maximum retained audio records. |

Audio uses the existing FFmpeg/FFprobe binaries and `OPENROUTER_MODEL` unchanged.
`/api/meta` exposes source byte/duration limits and retention. Browser recording and
server validation both enforce limits; model/provider limits still apply.

## User profiles

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROFILE_DB_PATH` | `data/profiles.sqlite` | Private SQLite file; relative to the working directory, or absolute. |
| `PROFILE_BIO_MAX_CHARS` | `2000` | Biography Unicode-character limit, configurable up to 8000. |
| `MEDIA_DIR` | `data/media` | Durable video/voice files per `(user_id, slot, media_id)`; back up alongside the database. |

`PROFILE_DB_PATH` also stores per-user Горепочка trait settings in the separate
`character_profiles` table. There is no free-text personality field or additional
personality environment variable; the 15 traits, three levels and defaults are defined
in `src/services/character/definition.ts`. See [Character profile](./character-profile.md).

It also stores private lore additions in the independent `lorebook_entries` table.
Lorebooks require no new environment variables: the single primary file is
`lorebooks/gorepochka.json` (relative to the project working directory). Entry/keyword,
primary-source and scan bounds are fixed in `src/services/lorebook/`; runtime lore is
outside the ordered prompt-file character budget. See [Lorebook](./lorebook.md).
