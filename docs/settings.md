# App settings and changelog

Open **Настройки** from the conversation's **⋮** menu or Telegram's native Mini App
Settings button (Telegram 7.0+). The user and character profiles remain available via
their own avatars. The grouped rows, back navigation and controls are inspired by
Telegram, with GorCOgramm's pink/blue accents. The screen shows the application display
version and **Что нового**, a Russian-language changelog. The display version is
independent of the Node package version.

## Theme

The default is **light**, regardless of the Telegram/system theme. The accessible
**Тёмная тема** switch changes the entire Mini App and supported Telegram chrome.
It applies immediately, respects reduced-motion preferences, and does not reset the
conversation, drafts, attachments or media. The switch is disabled while loading or
saving. If a save fails, the last confirmed theme is restored and **Повторить** reloads
the server before another attempt. A conflict never silently overwrites another device.

For authenticated users, the choice is stored by Telegram ID in the `app_settings`
table of `PROFILE_DB_PATH`. A new installation adds that table without rewriting
existing profiles. Each launch, reopening Settings, and returning the app to the
foreground reloads the server's value. There is no real-time push to devices already
open. A user-scoped browser cache of the last confirmed theme is only a first-paint hint:
the server is authoritative. If the server is unavailable, the cached theme remains
visible, but the switch requires a successful reload. Local storage may be unavailable;
then the app starts light and applies the server value when it arrives.

In `ANON_MODE=on`, theme settings are isolated by browser client ID and held in bounded
process memory, not synchronized across devices or durable across server restarts.
Anonymous mode is for local testing only. SQLite backups and multi-instance deployment
have the same requirements as [Profiles](./profiles.md#persistence-and-deployment).
Theme preferences are not included in AI prompts or chat history.

## Updating the changelog

Edit `webapp/app/settings/releases.js` and put the newest release first. Each entry has
a unique `version` in `major.minor.patch` form and a nonempty `changes` array of plain
Russian text. The first entry supplies the Settings version automatically. Add only
actual shipped changes; do not invent past releases or dates. The UI uses text nodes,
not HTML. Run `npm run smoke:settings` after `npm run build` to validate the data, then
deploy the file with the rest of the Mini App. Static assets can be cached for up to
five minutes. The initial list contains only the settings/theme/changelog update.

## API

`GET /api/settings` returns `{ ok: true, settings: { theme, revision, updatedAt } }`.
`POST /api/settings` accepts exactly `{ theme: "light" | "dark", revision }` and returns
the updated settings. A stale revision returns `409` / `SETTINGS_CONFLICT`; invalid or
extra fields return `400`; storage failures return `503`. Both routes derive the owner
from signed Telegram launch data (or the explicitly enabled development client ID),
apply the allowlist, use private `no-store` responses and have a separate 60-per-minute
identity limit. No client-supplied user ID is accepted.
