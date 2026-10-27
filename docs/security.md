# Security

- Secrets live **only** in `.env` (git-ignored). `.env.example` contains placeholders.
- `src/config/config.ts` validates env with `zod` and exits on startup if invalid,
  printing field-level errors only (never secret values).
- No token/key is ever logged or sent to the user (`logger.ts` redacts,
  `openrouter.ts` omits provider error bodies that could echo private messages/profile
  facts, `bot.ts`/`server.ts` reply with generic messages).
- Mini App auth: `initData.hash` must be a 64-char hex HMAC-SHA256, timing-safe
  compared; `auth_date` must be within one hour (up to 60 seconds of future clock
  skew); forged data → `401`. Reopen the Mini App when credentials expire.
- Optional allowlist: set `ALLOWED_USER_IDS=123,456` to make the bot + Mini App private.
  In allowlist mode, all anonymous API access (including metadata) is blocked.
- Input is trimmed, length-capped (`MAX_MESSAGE_LENGTH`), control chars stripped.
- Per-user sliding-window rate limiter (`RATE_LIMIT_WINDOW_MS` /
  `RATE_LIMIT_MAX_REQUESTS`) shared by bot chat and Mini App.
- `AbortController` timeout on every OpenRouter call (`OPENROUTER_TIMEOUT_MS`).
- Long classic-chat AI replies are split to respect Telegram's 4096-char limit (the
  Mini App returns the full reply).
- Graceful shutdown on `SIGINT`/`SIGTERM`.
- Microphone and camera permissions are same-origin only (`microphone=(self)`,
  `camera=(self)`), requested only on explicit single-tap recording starts, not mode taps or page load.
  Geolocation remains blocked. Recording releases camera/microphone/canvas tracks
  on finish/discard/interruption; late permission/camera-switch results cannot restart capture.

## Upload hardening

Image and text-file uploads are treated as untrusted:

- Images: the client's MIME type is **not** trusted (`sharp` sniffs the real format from
  the bytes), the size is capped (`MAX_IMAGE_BYTES`) *before* decoding, a pixel-count
  guard (`IMAGE_MAX_PIXELS`) blocks decompression bombs, and pixels are re-encoded to
  JPEG so EXIF/metadata and anything hidden in the container are stripped. Only
  `/api/chat` uses the larger request-body limit (sized for a max image **and** a max
  text file).
- Text files: the client MIME type is only a hint, the size is capped
  (`MAX_FILE_BYTES`) *before* decoding, the bytes must decode as UTF-8 text (NUL bytes /
  mostly-binary content is rejected), control characters are stripped and the injected
  text is capped at `FILE_MAX_CHARS`. The filename is sanitized to a basename. File
  content is only ever placed in the model prompt — never executed or written to disk.
- Video uploads authenticate **before** streaming, have byte/duration/pixel/time and
  concurrency/storage caps, and use random private temporary directories. FFmpeg runs
  without a shell and cannot fetch network inputs or ingest playlist manifests. Videos
  are never served publicly or stored in localStorage; playback fetches them with
  Telegram credentials. Expiry, deletion and graceful shutdown clean up media. Keep
  decoder binaries patched and use OS/container resource isolation for public production
  deployments; third-party bundled versions are a convenience, not a substitute for
  decoder security updates.
- Circular video notes reuse the private video boundary, with validated kind metadata,
  a maximum 60-second decoded duration and square normalization. Durationless recordings
  get a bounded measurement pass; decoder size caps exceed acceptance caps so truncated
  output cannot masquerade as a successful upload. Local playback mute never removes
  audio from the model input. See [Video notes](./video-notes.md).
- Voice uploads authenticate before streaming, enforce source/output bytes, decoded
  duration, process time, concurrency and storage limits, and normalize actual bytes to
  metadata-stripped MP3. Only safe recording demuxers and local protocols are enabled.
  Playback requires credentials and is no-store. Raw audio never enters localStorage
  or logs; only small waveform/duration/ID descriptors are cached. Audio references
  expire and are removed on chat/history cleanup and shutdown. See [Voice messages](./voice-messages.md).

## Character profile boundary

`/api/character-profile` uses the same signed Telegram auth/allowlist and derives ownership
from credentials, never a user ID in the body. Responses are private/no-store and requests
have a separate 60/minute per-identity budget. Only the exact 15 integer trait levels
(0–2) plus revision are accepted: no arbitrary text, identity edits, unknown fields or
client-authored system prompt. Choices map to developer-owned guidance; core identity,
safety/privacy boundaries and message formatting remain non-editable. That contract is
outside capped file prompts, which are never sliced through core rules.

Character revisions are independent of user profiles, saves are transactional, stale
updates conflict, and storage failures stop generation rather than silently dropping
settings. Settings/drafts are not logged or placed in browser chat caches/localStorage.
See [Character profile](./character-profile.md) for persistence and privacy details.

## Lorebook boundary

`/api/lorebook` authenticates with the existing Telegram/allowlist boundary, derives
ownership from credentials, is private/no-store and has a separate 60/minute budget.
Only `{ entries, revision }` is writable; entries allow exactly `key`, `content`,
`constant`, up to three per user, 300 content code points and ten 60-character keys.
Unknown fields, owner IDs, slot IDs and primary-book writes are rejected. SQLite
transactions enforce independent revisions/conflicts; storage failure stops generation.

The primary JSON is developer-maintained outside the static frontend, validated at
startup and bounded in source size/total content. Users can read it but cannot disable
or modify it. Personal content is a JSON reference prefix in the current user turn,
never system instructions, and never mutates the original message stored as history.
Fixed guidance explicitly uses custom character/setting facts while preserving core
identity, canonical precedence, safety and personality settings; literal
keyword matching cannot execute regex or recursively scan injected lore. Contents are
not logged, executed, placed in browser storage or appended to history. Prompt-boundary
tests do not guarantee model adherence. Active lore is sent to OpenRouter; deleting
entries does not erase older messages/provider retention. See [Lorebook](./lorebook.md).

## Production hardening

For production at scale: put history/rate-limit state in Redis, run behind a process
manager (PM2/systemd/Docker), use Telegram webhooks + a secret token instead of long
polling, and follow the deployment notes in [Deployment](./deployment.md).
