# Горепочка's character profile

Tap the **bot avatar on the left of the Mini App header** to open **Профиль Горепочки**.
This is an in-app screen, not a modification of Telegram's native bot profile. The **Я**
button opens the user's separate **Мой профиль** screen; Telegram Settings opens
[app settings](./settings.md).

The profile reuses the user-profile cards, large avatar, pink/blue palette, sticky Save
header and independent scrolling. The avatar uses the existing public bot-photo proxy,
with **Г** on failure. Public facts come from the character definition: **Горепочка
Гаспарян**, **@GORepochka**, **17 лет**, games, singing, music, memes, films/series,
walks and friends. The character handle is not the actual Telegram bot username.
No birth date, address or other unspecified facts are invented. Identity is read-only.

## Fifteen traits, no text editor

The **Характер** biography section has three keyboard-accessible tabs, five traits each.
Only one group is visible at a time. Each block has a hint and **three labelled radio
choices**, not a free-text personality prompt. Native radio keyboard navigation works;
Left/Right/Home/End select tabs. Tab badges count differences from the defaults, and
the compact summary shows the original character or up to four changed traits and the
remaining change count. All 15 values remain available in their blocks.

| Tab | Traits |
| --- | --- |
| **Общение** | Общительность, Инициативность, Любознательность, Открытость, Прямолинейность |
| **Настроение** | Энергичность, Оптимизм, Эмоциональность, Чуткость, Терпеливость |
| **Манера** | Чувство юмора, Игривость, Самоирония, Спонтанность, Подробность |

**Сохранить** commits all 15 choices together and is enabled only for a changed, valid
draft. **Вернуть исходный характер** restores defaults in the draft; Save commits the
reset. Failures preserve edits. A stale revision produces a conflict with a reload
action; reloading or leaving asks before discarding edits. Save blocks navigation until
the result is known. Escape and supported Telegram Back work; native Settings also
respects unsaved character edits before switching to app settings.

Opening either profile preserves the active chat, message draft, attachments and scroll.
Recording navigation uses the existing discard confirmation. Background replies continue
without scrolling/focusing the hidden conversation or reopening the keyboard.

## Scope, storage and privacy

- Settings belong to the **authenticated user**, shared across all five chats/devices.
  One user cannot read or change another user's character settings.
- `character_profiles` is a separate table in the existing `PROFILE_DB_PATH` SQLite file.
  Opening an existing database adds the table without rewriting user profiles. Character
  revisions are independent of user-biography/birthday revisions.
- Defaults require no stored row. Saves, including reset, advance revision transactionally.
  Clearing/deleting a chat does not clear either profile. Back up the database as described
  in [Profiles](./profiles.md#persistence-and-deployment).
- Anonymous local-development settings are isolated by client ID, bounded to 100 entries,
  and memory-only. Never expose anonymous mode publicly.
- Browser settings/drafts stay in memory, not localStorage or chat caches. Saved settings
  are sent to the configured model through OpenRouter as character guidance, not credentials
  or owner IDs. No new environment variables or dependencies are required.

## Prompt contract

`src/services/character/definition.ts` owns the catalog, original values, public facts and
developer-authored guidance for each level. The API accepts only integer choices **0, 1, 2**
for the exact 15 keys. No arbitrary text, prompt, identity fields or unknown traits are accepted.

The backend maps validated choices to developer-owned system guidance, appended outside
the ordered-file budget, including for defaults. The base prompt treats these traits as
mutable instead of unconditionally requiring cheerful/jokey behavior. Current settings
replace previous temperament, even when older chat messages reflect a different character.

**Core rules always take priority:** identity/age/interests, Russian messenger style,
short messages, split-command protocol, respectful behavior, privacy, no flirting/roleplay,
and all existing safety boundaries. For example, low sensitivity means less emotional
analysis, not ignoring distress; high openness never reveals private data; high detail
still uses short messages. Trait interpretation is model-dependent, not a guarantee of
identical behavior on every model.

Every generation snapshots settings before text or asynchronous media work. Saved changes
affect the **next generation**, not an already-running reply. The same path handles images,
files, voice, video notes, videos and follow-ups. Character guidance is not stored in history,
and the model cannot write settings. Storage failure stops the request rather than silently
using defaults. User biography remains separate untrusted background, never a character editor.

## API and verification

Both routes require the existing Telegram auth header (or explicitly enabled local-dev
client ID), honor the allowlist, return `private, no-store`, and share a separate character
profile budget of 60 requests per identity/minute. Ownership is never accepted from the body.

- `GET /api/character-profile`: `{ ok, character, profile, groups, traits, defaults }`.
  `profile` contains `traits`, `revision`, `updatedAt`, `verified`. The public trait catalog
  includes labels, groups, hints, three level labels and defaults, but **not model instructions**.
- `POST /api/character-profile`: exactly `{ traits, revision }`, with all 15 numeric keys.
  Returns the same envelope. Unknown/missing fields, strings, fractions and out-of-range
  values return `400`; stale revisions return `409 / CHARACTER_CONFLICT`; storage failure
  returns `503`, never a false successful save.

`npm run smoke:profile` covers signed auth, SQLite restart/concurrency, strict trait validation,
per-user/five-slot isolation, defaults/reset, generation snapshots and prompt-budget boundaries.
`smoke:webapp` covers tabs/radios, drafts, conflicts, reset, navigation and recording guards;
audio/video tests verify current personality in native media and follow-up payloads.
Manual Telegram iOS/Android/Desktop checks are still needed for native chrome and keyboards.
