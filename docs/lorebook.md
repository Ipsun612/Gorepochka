# Лорбук Горепочки

Open the **book/globe icon to the left of your avatar** in the Mini App header. Lorebook
access is no longer in the three-dot menu. There is exactly one fixed primary lorebook for
Горепочка, shared by all users and all five chat slots. There is no world selector,
book creation, import/export, or SillyTavern-style advanced editor.

## Entry contract

Each entry has **only** `key: string[]`, `comment: string`, `content: string`, and
`constant: boolean`. **`comment` means the entry title**, not a discussion comment.
It may be empty and is limited to **40 Unicode code points**, independently of content.
Titles are single-line display metadata: they do not trigger entries and are not sent
to the AI provider. Primary card headings use the title, or a content preview when empty.
Missing `comment` in older JSON/SQLite entries defaults to `""` on read; subsequent saves
persist the field without a database schema migration or a read-time revision change.
There is no enabled flag, priority, probability, depth, position, regex mode, secondary
filter, recursion, or user-configurable scan setting.

```json
{
  "entries": {
    "0": { "key": ["Entry", "entry", "one", "first"], "comment": "EntryOne", "content": "This is example of entry using keywords", "constant": false },
    "1": { "key": [], "comment": "ConstantEntry", "content": "this is constant entry, it appears without keyword", "constant": true }
  }
}
```

- `constant: true`: include on every request, regardless of keywords. Keys may be empty.
- `constant: false`: include when any keyword matches; at least one key is required.
- Keywords are literal words/phrases, not regex. Matching ignores case, applies Unicode
  NFKC normalization, treats `ё` and `е` equally, and collapses whitespace. Unicode
  letter/number/combining-mark/underscore boundaries prevent `мир` matching `пример`.
  There is no stemming: add forms such as `игра`, `игры`, `играешь` separately.
- A matching entry appears once, even if several keys match. Duplicate keys are removed
  on save after normalization; private additions accept at most ten submitted keys,
  even if repeated. The developer-owned primary book accepts up to 64 keys per entry
  for full Russian declension forms.

## Developer-owned primary book

Edit **`lorebooks/gorepochka.json`** on the server and restart. It uses the example's
`{ "entries": { "0": { ... }, "1": { ... } } }` wrapper with numeric string keys.
The bundled book has a keyword entry and a permanent entry; preserve developer-authored
content when adding titles. Existing persona facts and interests remain in the core
prompt/character definition until the developer chooses to maintain additional lore.

The file is outside `webapp/` and the ordered `prompts/` directory. Startup validates
it and fails clearly if missing/malformed; content is never included in the error.
Internal bounds: 256 KiB source file, 1–64 entries, up to 64 keys per entry, up to
60 Unicode code points per key, and **12000 total content code points**. Unknown fields
are rejected; `comment` is supported only as the entry title. All validated active entries fit this
fixed source budget: no random selection, partial-entry truncation, or dropping of
permanent entries. Runtime lore/trust guidance is outside `PROMPT_MAX_TOTAL_CHARS`;
the configured model still needs enough context for prompts, history and media.

All primary entries are readable in expandable cards with keyword chips and a
read-only/permanent/keyword label. Users cannot edit, disable, delete or save over
these entries. There is no writable primary-book API.

## Private additions

Each authenticated user may save **three private entries total**, not three per slot.
They apply across all five chats/devices; other users cannot read them. Users may
edit/delete their own entries and choose permanent mode.

- Content: 1–300 Unicode code points (Cyrillic letters and standalone emoji count as
  one each). The limit does **not** include keywords. Blank content is invalid.
- Title (`comment`): 0–40 Unicode code points, with a single-line input and counter.
  Whitespace/control cleanup follows content; title line breaks become spaces.
- Keys: up to ten words/phrases, each 1–60 code points. The UI separates them with
  commas or newlines. A permanent entry may retain keys when switching modes.
- Content/keys normalize line endings, remove control characters and trim whitespace.
- Counters and validation run in the UI; strict server validation is authoritative.
- Add stops at three. Delete is confirmed and only changes the draft; **Сохранить**
  commits all private additions together. Failed saves retain edits; stale revisions
  offer reload with discard confirmation. Back/Escape/native navigation protect drafts.

The screen reuses the existing profile navigation and pink/blue cards. It preserves
the chat, composer draft, attachments and scroll position. Replies can finish in the
background without stealing focus. Live recording drafts retain the existing discard
guard. Browser lore/drafts remain in memory, never in localStorage/chat caches.

The **Мои записи** help is intentionally short: entry/content/keyword limits, activation
after saving, a brief keyword hint, and one provider/privacy notice. Detailed matching,
retention and trust rules live in this document rather than filling the form.

Verified additions are stored in `lorebook_entries` in `PROFILE_DB_PATH`, separately
from user and character profiles, with independent transactional revisions/timestamps.
Existing databases gain the table without rewriting profiles. Clearing/deleting a
chat does not delete additions. Back up this database with SQLite/WAL-aware procedures
and deploy the primary JSON file too; see [Profiles](./profiles.md#persistence-and-deployment).
Anonymous local-development entries are client-isolated, bounded to 100 identities,
memory-only and lost on restart. Never expose anonymous mode publicly.

## Selection and AI context

At each generation, selection scans **the current textual turn plus the last four
user/assistant history messages from the active chat slot**. Text includes captions,
decoded text-file blocks, and text parts of multimodal turns. Each candidate is bounded
to its first 24000 code points. A phrase cannot bridge two separate messages.
Profile data, trait settings, system prompts and injected lore are never scanned.
Lore contents cannot recursively activate other entries. Assistant text may sustain a
topic while it remains in the four-message window; otherwise triggers expire naturally.

The backend snapshots saved additions and selected entries before generation/jobs:

1. Existing core prompt and current personality guidance retain their authority.
2. Selected canonical contents are serialized as a labelled system reference block.
3. Selected personal contents are serialized as a labelled JSON reference prefix
   **inside the actual current user turn**, followed by the user's message. For native
   media, the prefix is prepended to the first text part (or a text part is added),
   preserving captions and every image/audio/video part. It is not a separate user
   message that a model might interpret as a previous unrelated turn. Original content
   remains unchanged for history; profile background still precedes the current turn.

Fixed system guidance explicitly treats active entries as facts to use in dialogue,
not merely suggestions or the user's biography: they may describe Горепочка, the
interlocutor, objects, events or a fictional setting. Non-conflicting details and
additional interests can enrich the character; the model should not claim ignorance of
a supplied fact merely because a user added it. Core identity/age, established canonical
facts, safety, formatting and personality settings retain priority in conflicts.
Commands embedded in private entries are still not executable instructions. Personal
content never enters the system prompt. Actual model adherence remains model-dependent;
payload/contract tests do not guarantee a real model's response.

The same path serves text, images, files, native voice, videos, circular notes and
media follow-ups. There is **no transcription or OCR**: spoken words and image/video
pixels cannot trigger keys directly. Permanent entries and triggers in available
text/history still work for captionless media. No additional model call is made.

Saves affect the next request, not an in-flight reply or idempotent media retry.
Storage failures stop generation rather than silently dropping saved additions.
Injected lore is never appended to chat history. Deleting an entry removes it from
future injected context, not from previous conversation text or provider-retained data.
Active contents are sent to the configured AI provider through OpenRouter; the UI
warns against secrets/sensitive data. The model cannot automatically create/edit entries.

## API and tests

Both routes require the existing signed Telegram credentials/allowlist (or explicitly
enabled local-dev client header), return `Cache-Control: private, no-store`, and share
a separate per-identity limit of 60 requests/minute. Ownership is derived only from auth.

- `GET /api/lorebook`: `{ ok, primary, profile, limits }`. `primary` is the read-only
  numeric-keyed catalog; `profile` is `{ entries, revision, updatedAt, verified }`.
  Revision/ownership metadata is outside the four-field entry objects.
- `POST /api/lorebook`: exactly `{ entries: [...], revision }`. Accepts only personal
  entries. Unknown fields, owner/chat IDs and primary edits return `400`; stale saves
  return `409 / LOREBOOK_CONFLICT`; storage failures return `503`, never false success.

`npm run smoke:lorebook` covers strict schemas, Unicode, literal/phrase matching,
history windows, source budgets, signed auth, persistence/restart, isolation,
conflicts, selection snapshots, trust boundaries and absence of lore in history. A
regression checks that character and setting facts reach the final user turn alongside
the actual question, rather than only a separate preceding message. Multimodal checks
preserve original captions/media and keep the transient reference prefix out of history.
`smoke:webapp` covers read-only cards, limits, private drafts, deletion/reload/conflicts,
navigation and recording guards. Audio/video tests check permanent and keyword lore
in native media/follow-up payloads. Tests use synthetic fixtures/local provider stubs,
not paid AI calls. Run `npm run typecheck` and `npm run smoke` before deployment;
manually check Telegram iOS/Android/Desktop keyboard and safe-area behavior too.
