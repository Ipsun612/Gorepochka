# Development

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | hot-reload dev via `tsx watch` (bot + Mini App server) |
| `npm run dev:tunnel` | expose `PORT` publicly — prefers cloudflared (no interstitial), falls back to ngrok (`scripts/tunnel.mjs`, local exe next to `package.json` or PATH; `--provider=ngrok\|cloudflared` overrides) |
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
| `npm run smoke:server` | `/api/chat` files + reply tags against a stub OpenRouter (build first) |
| `npm run smoke:tags` | tag parsing, hidden-tag handling, typing delays + delivery (build first) |
| `npm run smoke:videos` | real FFmpeg conversions + uploads, preserved audio, native video payloads, private playback, retry/cancel + history (build first) |
| `npm run smoke:audio` | real WebM/MP4/Ogg/WAV conversion, native MP3 input, waveform, private/range playback, retry/cancel + limits (build first) |
| `npm run smoke:recorder` | recorder permission races, runtime formats, pause timing, limits, interruption + microphone cleanup |
| `npm run smoke:video-notes` | single/double-tap gestures, camera switching/rollback, desktop exclusion, late streams, limits + cleanup |
| `npm run smoke:profile` | signed auth, SQLite user/character settings, 15-trait validation/conflicts, avatars, AI snapshots and prompt budgets (build first) |
| `npm run smoke:lorebook` | strict schemas/Unicode, literal keywords, SQLite persistence, auth/isolation/conflicts and lore context snapshots (build first) |
| `npm run smoke:settings` | signed theme API, SQLite migration/isolation/conflicts, theme UI and changelog data (build first) |
| `npm run smoke` | build + run every smoke test |

## What the smoke tests cover

`npm run smoke` is the pre-deploy check: it builds, then loads the real Mini App module
graph (including delayed delivery and cache restoration), exercises the text-file service,
tag parser and timing, and drives `/api/chat` against a local stub OpenRouter (no external
API calls or real keys needed). It also generates small fixtures and converts MP4, MOV,
WebM, MKV, AVI, WMV, and MPEG-TS videos with the actual installed binaries. The Mini App
smoke test covers binary transport, failed browser previews, video bubbles and cache
restoration.

Voice tests use synthetic recordings and stub provider responses, not live microphones
or paid requests. Frontend smoke tests also cover voice mode, typed-draft preservation,
discard confirmations, preview, send/retry, voice-bubble cache restoration and absence
of audio bytes/object URLs in localStorage.
Video-note tests likewise use synthetic camera/canvas tracks, not a real webcam. The
webapp integration covers tap-to-start/stop, late permissions, circular playback, sound,
seeking and reload descriptors. Video API tests verify real durationless WebM decoding,
square output, native video/audio AI context and an independent 60-second note cap.

`npm run smoke:profile` uses signed test credentials, a temporary real SQLite database,
and stub Telegram/OpenRouter responses. It checks persistence across processes, isolation,
validation, conflicts, private avatar proxying, sync fallbacks, context boundaries and
storage failures. No real keys or paid AI requests are used. Frontend smoke tests cover
navigation/drafts, Unicode, optional-year dates, conflicts and failed saves. They also
exercise the bot-avatar entry, three accessible trait tabs, exactly 15 three-choice
blocks, no text editor, reset-as-draft, profile switching/recording guards and unchanged
chat state. Character API tests check exact numeric keys, spoofed fields, independent
revisions, reset conflicts, restart persistence, user isolation across five slots,
in-flight snapshots, storage failure and whole-chunk prompt budgeting. Audio/video
tests assert current character guidance in native media and follow-up payloads.

`smoke:lorebook` also checks the primary-file schema and isolated fixtures, source/context budgets,
read-only primary entries, three private additions, 300-character content limits, ten
keywords, Cyrillic word/phrase matching, history expiry, no recursion, per-slot activation,
per-user sharing/isolation, generation snapshots and separation from system/history.
It uses a temporary real SQLite file and a local provider stub, not paid requests.
The frontend smoke test covers lore cards, private counters/drafts/deletion, save/reload
conflicts/failures, focus restoration and recording guards. Audio/video tests assert
permanent lore on captionless media and keyword lore on typed follow-ups.

`smoke:settings` checks signed ownership, existing-database migration, default light,
strict validation, persistence, concurrent revisions, anonymous isolation, theme cache,
failed saves, foreground refresh, Telegram chrome and release data. `smoke:webapp`
also covers settings/changelog navigation, draft preservation and recording guards.

Lore regressions validate the developer's primary JSON but use isolated keyword/content
fixtures, so replacing the original placeholder text does not break activation tests.
They also require active permanent/keyword facts in the actual final user
turn alongside the question/caption or native media, not just somewhere in the request.
They verify explicit fact-use guidance, preservation of all media parts, unchanged
history content and compact frontend help. No live-model behavior is asserted.

These tests verify prompt construction, not deterministic model personality. Before
deployment, manually compare default versus quiet/low-humor settings on the configured
model and verify that core safety, privacy and short-message rules still hold. No live
or paid AI requests are made by smoke tests.

Final native keyboard/safe-area and Back/Settings behavior still require Telegram
iOS/Android/Desktop checks.

## Adding a tag

Reaction regressions are included in `smoke:tags`, `smoke:webapp`, `smoke:server`,
`smoke:audio` and `smoke:videos`. They cover bare/bracketed emoji, grapheme validation,
malformed/nested commands, last-valid-wins, unchanged split timing and clean history,
default prompt budgeting, the ten-button bot-only picker, keyboard, toggle/replace,
cache validation/restoration, slot isolation, archives and direct/media-job responses.
The frontend job test verifies targeting the original video bubble. Final touch
placement and system emoji appearance still require native Telegram checks.

See [AI behavior → Adding a tag](./ai-behavior.md#adding-a-tag).
