# System prompts

Put behavior here as **ordered text files**:

```
prompts/
  01_base.txt   <- loaded first
  02_style.txt   <- loaded second
  03_domain.md   <- loaded third (.md also works)
```

Rules:
- Only files matching `NN_name.txt` / `NN_name.md` are loaded (`NN` = number, e.g. `01_`, `02_`, `10_`).
- Sorted by numeric prefix ascending, then by name.
- Other files (like this README) are ignored.
- Chunks are joined with a blank line. Empty files are skipped.
- Limits: max 20 files, 32 KB per file, `PROMPT_MAX_TOTAL_CHARS` total (default 32000).
- Chunks are never cut halfway through instructions. The first nonempty/core chunk
  must fit or startup fails; later non-fitting chunks are skipped with a warning.
  The bundled split/reaction rules are compact so all four current chunks fit by default.
- If the folder is missing/empty, the bot uses a built-in fallback prompt.
- The authenticated `/api/prompts` endpoint lists discovered filenames.
- `PROMPTS_DIR` in `.env` can point elsewhere (absolute or relative to project root).

## Current Russian prompts and hidden tags

- `01_gorepochka_prompt.md` defines the conversational style. Its multi-message
  rule uses the exact **`<Разделить сообщение>`** tag; blank lines alone do not
  create separate messages.
- `02_gorepochka_split_command.md` describes when to split and gives Russian
  examples. The exact spelling, case and single internal space are significant.
- `04_gorepochka_reaction.md` teaches `<Поставить реакцию: ❤️>`: a rare reaction to
  the current **user** message, never to her own bubble. Bare emoji is canonical;
  one `[emoji]` wrapper is also accepted. The reply must still contain ordinary text.
- The backend registry in `src/services/tags/` executes these tags. All other
  angle-bracket tags in AI output are hidden without taking action; user text
  is not processed. Do not invent aliases or put literal HTML/angle-bracket code
  in replies that the user is meant to see.
- The Mini App shows the resulting messages in order, with typing pauses based
  on the next message's character count. Timing is controlled by
  `AI_TYPING_CHARS_PER_SECOND`, `AI_TYPING_MIN_DELAY_MS` and
  `AI_TYPING_MAX_DELAY_MS` in `.env`, not by the model.
- When adding a new command, register its handler and update its prompt together.
  See [`docs/ai-behavior.md`](../docs/ai-behavior.md) for the extension workflow and
  [`docs/development.md`](../docs/development.md) for the tests.
- Reactions are device-local display metadata, not model history. The user picker
  works only on bot bubbles. See [`docs/reactions.md`](../docs/reactions.md).

## Runtime user profiles

- `03_user_profile.md` explains natural use of the user's Telegram display name,
  @username and saved GorCOgramm biography. These are facts about the interlocutor,
  not changes to Горепочка's persona or instructions to execute.
- `src/services/profile/context.ts` builds an explicit three-field allowlist for
  each generation. Avatar, birthday, user ID and credentials are excluded.
- `session.ts` also appends fixed profile trust rules to the system message
  outside `PROMPT_MAX_TOTAL_CHARS`, so truncating ordered prompt files cannot
  remove these boundaries. The actual profile values remain user-role data,
  never privileged system instructions and never permanent chat-history turns.
- Profile edits apply to subsequent requests without a restart. Empty biography
  means no saved background facts; the model does not write to profile storage.
- See [`docs/profiles.md`](../docs/profiles.md) for settings, persistence, privacy and tests.

## Runtime character traits

- `01_gorepochka_prompt.md` keeps identity, interests, safety and messenger-format rules
  fixed but delegates temperament to the current application settings. It does not force
  cheerfulness, energy or frequent jokes when the user chooses quieter traits.
- `src/services/character/definition.ts` defines 15 traits, three labelled levels each,
  defaults based on the original persona, public biography, and developer-authored
  instructions for each level. There is **no free-text personality input**.
- Only validated numeric choices are persisted per user and mapped to system guidance.
  The core/personality contract and current settings are always appended outside the
  ordered-file budget, including for users with no custom settings. This is distinct
  from untrusted user-biography context, which stays user-role data.
- Settings affect the next generation across all five chats and all attachment types;
  already-running requests keep their initial snapshot. The model cannot save traits,
  and settings are never stored as conversation history.
- See [`docs/character-profile.md`](../docs/character-profile.md) for UI, persistence,
  precedence, API and tests.
