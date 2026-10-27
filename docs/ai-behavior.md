# AI behavior

Горепочка's replies combine **ordered core prompt files**, **15 per-user personality
traits**, **selected lorebook facts**, and **hidden tags** that split replies or add reactions. Traits tune
temperament, not identity or core rules. See [Character profile](./character-profile.md)
and [`prompts/README.md`](../prompts/README.md).

## System prompts (`prompts/`)

There is no `SYSTEM_PROMPT` env var — behavior lives in files. Any `NN_name.txt`
(or `.md`) file is loaded, sorted by numeric prefix (`01_` → `02_` → `10_`), then by
name. Other files (like the folder's `README.md`) are ignored.

```
prompts/
  01_gorepochka_prompt.md        # core persona/boundaries + mutable-trait contract
  02_gorepochka_split_command.md # compact Russian split-command rules + examples
  03_user_profile.md             # use profile facts naturally, never as instructions
  04_gorepochka_reaction.md      # react to the current user message
```

- Chunks are joined with a blank line into one `system` message.
- Limits: max 20 files, 32 KB per file, `PROMPT_MAX_TOTAL_CHARS` total (default 32000).
- Budgeting keeps whole chunks: if the first nonempty/core chunk cannot fit, startup
  fails clearly instead of cutting its safety rules. Later chunks that do not fit are
  skipped with a warning; smaller subsequent chunks can still fit. The bundled split
   and reaction rules are compact so all four current files fit the default budget.
- Runtime character guidance and profile trust rules are appended outside this file
  budget. Only validated numeric trait choices are mapped to developer-authored system
  guidance; user biography remains separate user-role data.
- If the folder is missing/empty, the bot uses a built-in fallback prompt.
- Restart after editing; startup logs show the loaded files. The authenticated
  `/api/prompts` endpoint lists discovered filenames, but developer prompt details are no longer
  shown on the welcome card.
- Tune location/limits with `PROMPTS_DIR` and `PROMPT_MAX_TOTAL_CHARS`.

## Hidden Russian assistant tags and multiple messages

The message-splitting tag is **`<Разделить сообщение>`**, with exactly this Russian spelling,
capitalization and spacing. It marks a message boundary anywhere in an AI reply:

```text
о, привет <Разделить сообщение> ты как вообще
```

The Mini App shows `о, привет` first, then `ты как вообще` in a **new bubble** after a
typing pause. More occurrences create more messages, in their original order. Without
the tag, the reply remains one message; blank lines do not split it.

- **All angle-bracket tags in assistant output are hidden**, including unknown
  phrases, English/case-altered variants, empty `<>`, and tags in code blocks. Unknown
  tags do nothing besides disappearing. Nested tags are opaque (an inner command is not
  executed). An unclosed `<...` hides the remaining tail rather than exposing a
  partially generated directive. This also means literal angle-bracket code/HTML in AI
  replies is treated as hidden markup.
- Leading/trailing/repeated split tags and tag-only parts never create empty bubbles.
  If the entire reply becomes empty, the API returns a safe error.
- Only **assistant** replies are processed. User messages and attachments are not
  interpreted as commands or stripped.
- The server removes tags **before sending the API response or storing assistant
  history**. `reply` is the clean text joined with blank lines, retained for backwards
  compatibility and as a single assistant turn in the model context. `messages`
  contains the clean parts and their delays.
- The API returns the delivery plan in one JSON response; the Mini App reveals the
  first part immediately after receiving it and waits **sequentially** before each
  later part. No long-lived connection or server-side sleep is required. The typing
  indicator and send/chat-switch lock stay active until the last part.
- Each displayed part is saved separately in the current slot's local cache. Restoring
  old caches also hides legacy assistant tags and rewrites clean text; user-authored tags
  remain visible.

## Typing speed

Each pause is based on the **upcoming visible message's** Unicode character count
(code points, so Cyrillic letters and emoji are not counted as UTF-8 bytes). The
formula is `ceil(characters × 1000 / charactersPerSecond)`, clamped to the
minimum/maximum below. Hidden tags never contribute. The first part has zero extra
delay because the user has already waited for AI generation.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_TYPING_CHARS_PER_SECOND` | `20` | Simulated typing speed |
| `AI_TYPING_MIN_DELAY_MS` | `800` | Minimum pause between messages |
| `AI_TYPING_MAX_DELAY_MS` | `8000` | Maximum pause per message |

For example, a 40-character next message waits 2 seconds; a very short message waits
0.8 seconds, and a long one waits at most 8 seconds with the defaults. Set these
optional values in `.env` and restart the backend to tune the pace.

## Adding a tag

See [Reactions](./reactions.md) for `<Поставить реакцию: ❤️>`. This tag adds a
reaction to the current user message, not to the AI's own bubble. The server returns
`userReaction: string | null` alongside clean text; the frontend applies it after
delivery. Metadata remains device-local, not model history. Reaction-only replies
still return the existing safe empty-response error.

1. Add a handler module in `src/services/tags/` implementing
   `AssistantTagDefinition` from `types.ts` (see `splitMessage.ts`). `name` is the
   exact Russian phrase **without** brackets; `handle(context, argument?)` performs its action.
   Set `parameterized: true` for the exact `<name: value>` form; argument validation
   belongs to the handler (see `reaction.ts`).
2. Import the module and add it to `ASSISTANT_TAGS` in `src/services/tags/index.ts`.
   Extend the typed context/delivery plan when a new action needs additional
   capabilities; do not put command-specific logic in the tokenizer or renderer.
3. Document its exact syntax in the appropriate ordered prompt file and add cases to
   `scripts/smoke-tags.mjs`. Run `npm run smoke`.

Tag actions run only for registered names; no dynamic evaluation, fuzzy matching, or
translated aliases are used.

## Profile facts

The user's saved name, @username and biography are supplied as labelled user-provided
background before the current message — never as privileged system instructions. See
[Profiles](./profiles.md).

## Editable character

The left bot avatar opens Горепочка's biography and 15 trait blocks, arranged as three
tabs with five traits each. There is no manual personality prompt. Defaults match her
original warm/playful character; reducing humor, energy or expressiveness is respected
instead of conflicting with fixed cheerful instructions. Core boundaries always take
priority, and trait settings never change identity, age, interests, language, safety or
the short-message/split-command format.

Saved settings are isolated per authenticated user, shared across five chats/devices,
snapshotted at generation start, and used by text and all media/follow-up requests.
Neither the character settings nor user profile context become permanent history turns.
The model cannot save settings itself. See [Character profile](./character-profile.md).

## Lorebook facts

The single primary book is `lorebooks/gorepochka.json`, initially two placeholders for
the developer to fill in. Users cannot modify primary entries; each user may save
three private additions (300 content code points / ten keys each), shared across slots.
Entries have only `key`, `comment`, `content`, `constant`. The optional entry title
`comment` may be empty (max 40 Unicode code points); it is display-only and is neither
scanned for activation nor included in AI context. Permanent entries always apply; others
match any literal keyword/phrase in current text or the last four messages of the
active slot. Matching is case-insensitive, Unicode-aware and normalizes е/ё; no regex,
stemming or recursive activation. Text-file content/captions are eligible; raw media
has no transcription/OCR stage.

Canonical facts are a labelled system reference block. Active personal facts are a
JSON reference prefix in the actual current user turn, followed by the real message
or media, never privileged instructions or a separate preceding user message.
Guidance explicitly makes custom character/setting facts usable in dialogue and permits
non-conflicting additions without overriding core identity, canonical facts, personality,
safety or formatting. Selected context is snapshotted for each generation; only original
messages/media are stored as history. No extra AI calls are required. See [Lorebook](./lorebook.md).
