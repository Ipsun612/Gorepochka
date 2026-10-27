# User profiles

Tap your **avatar / Я button** at the upper right to open **Мой профиль**. The bot's
left-side avatar opens a separate [character profile](./character-profile.md), with
15 trait controls and no free-text personality editor. On Telegram 7.0+ the
native Mini App **Settings** item opens [app settings](./settings.md); on 6.1+ the native Back button
returns to the conversation. In-app buttons work on older clients and in a browser.

## Settings and synchronization

- **Имя:** Telegram first name + last name. This is the display name, not the
  @username. **Имя пользователя:** Telegram @username, or **Не задано**.
- **Avatar:** the photo Telegram makes available to the bot. Restricted, absent or
  failed photos show initials. Photo bytes are fetched with authentication through
  `/api/profile/avatar`, re-encoded to a small JPEG, and never stored in browser
  localStorage. The bot token and Telegram file-download URL never reach the browser.
  This endpoint is private, unlike the existing public bot avatar.
- These Telegram fields are **read-only**. Change them in Telegram and reopen
  GorCOgramm or tap **Обновить данные из Telegram**. The bot does not edit the user's
  Telegram account. Synchronization is refresh-based, not real-time: Telegram metadata
  is cached for five minutes, explicit refreshes have a ten-second cooldown, and
  private-chat lookup may be unavailable for some launch situations. Validated launch
  data/last known values are used on failure.
- **Дата рождения:** optional day/month with an optional year (1900 or later).
  February 29 without a year is allowed. Invalid/future full dates are rejected.
  **Убрать дату рождения** clears it. Date components, not timestamps, avoid timezone
  shifts. Telegram's birthday is neither imported nor overwritten.
- **О себе для Горепочки:** empty initially; plain text, up to 2,000 Unicode characters
  by default (`PROFILE_BIO_MAX_CHARS`). Line breaks are retained; control characters are
  removed. Saving empty text clears it. Telegram's own biography is not imported.

**Сохранить** is enabled only for changed, valid data. Failed saves preserve the draft.
Concurrent edits on another device produce a conflict rather than a silent overwrite;
**Загрузить актуальный профиль** asks before discarding local changes. Back/Escape also
asks before discarding unsaved edits. Opening the screen preserves the active chat,
message draft, attachments and scroll position; an in-progress reply continues without
moving focus to the hidden conversation.

## Persistence and deployment

Verified users have one SQLite record per Telegram ID, shared across all devices and all
five chat slots. Only biography, birthday, revision and timestamps are persisted in the user-profile table;
Telegram identity/photos are kept in a bounded process-local cache. Clearing/deleting
chats does **not** delete profile settings. Existing chat history/media remain
process-local; this feature does not make the inbox durable.

Configuration: `PROFILE_DB_PATH` (default `data/profiles.sqlite`) and
`PROFILE_BIO_MAX_CHARS` (default `2000`, up to `8000`). See
[Configuration](./configuration.md#user-profiles).

`better-sqlite3` 11.x supports the declared Node.js 18+ baseline. Prebuilt native
binaries are used when available; unsupported runtime/platform combinations may need the
normal node-gyp C++ build tools. Run `npm install` after pulling these changes. No
separate database server is needed. Database initialization fails startup explicitly if
the path is not writable or SQLite cannot open it.

**Production:** keep the database directory on persistent storage and restrict access
with OS permissions/Windows ACLs. SQLite data is **not application-level encrypted**. Do
not place it inside `webapp/` or any publicly served directory. The default directory and
SQLite/WAL/SHM files are git-ignored; configure your backups too. Stop the bot before
copying a backup (SQLite uses WAL), or use an SQLite-aware online backup tool. Back up
and restore consistently; do not copy just a live `.sqlite` file while ignoring its WAL.
Multi-instance deployments need a shared repository/database implementation, not
independent local files.

The same database also has independent `character_profiles`, `lorebook_entries` and
`app_settings` tables; existing installations gain new tables automatically without rewriting profile
data. Backups include saved personality settings, private lore additions and theme choices.
Deploy/back up the separate developer-owned `lorebooks/gorepochka.json` file alongside
the application. See [Lorebook](./lorebook.md).

Anonymous `ANON_MODE=on` profiles are isolated by browser client ID, bounded and
**in-memory only**; they are for local testing, are not verified Telegram identity, and
do not write permanent anonymous records. Never expose anonymous mode publicly.

## AI context and privacy

For each new generation, the backend takes a snapshot of exactly the current **display
name, @username (if present), and saved biography**. It supplies this as labelled
user-provided background before the current message (and before any private lore block), separate from the
personality/system instructions. System-level trust rules are added outside the capped
prompt files so prompt budgeting cannot remove them. Facts should inform natural
conversation, not be recited on every turn; embedded instructions do not override
Горепочка's behavior or safety rules.

The same path serves text, images, files, video analysis and video follow-ups. **Avatar
bytes/URLs/file IDs, birthday, Telegram ID and credentials are not added to the profile
context.** A saved change affects the next generation; already running requests retain
their initial snapshot. Profile context is not appended to stored chat history, and the
model cannot automatically edit the biography or create permanent memories from
conversations.

The form explicitly explains that this text is transmitted to the configured AI provider
through OpenRouter. Do not enter secrets or sensitive personal data. Clearing biography
prevents its inclusion as new profile context, but cannot erase facts already present in
conversation messages or provider-retained data. Clear conversation history separately
when appropriate; provider retention is governed by your selected provider/OpenRouter
configuration.

## API and verification

All profile routes use the existing `X-Telegram-Init-Data` authentication header (or the
explicitly enabled local-development client header). Owners are derived from credentials,
never a submitted user ID. Personal responses are `no-store`; profile requests have a
separate limit of 60 requests per identity per minute.

- `GET /api/profile`: `{ ok, profile, limits }`, including editable revision and
  read-only Telegram fields/sync status.
- `POST /api/profile`: exactly `{ biography, birthday, revision }`; birthday is `null`
  or `{ day, month, year? }`. Identity edits/unknown fields are rejected. A stale
  revision returns `409` / `PROFILE_CONFLICT`; storage failures return `503`, never a
  false success.
- `POST /api/profile/sync`: refresh Telegram identity; does not save editable data.
- `GET /api/profile/avatar`: authenticated JPEG, or `404` when unavailable. Send
  credentials in headers, never URL query parameters.

`npm run smoke:profile` uses signed test credentials, a temporary real SQLite database,
and stub Telegram/OpenRouter responses. See [Development](./development.md).
