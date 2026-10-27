# Message reactions

GorCOgramm reproduces Telegram's message-level reaction concept inside its own
Mini App, not in the classic bot chat. Reference: Telegram's [reaction UI introduction](https://telegram.org/blog/reactions-spoilers-translations#reactions)
and the Bot API's [setMessageReaction](https://core.telegram.org/bots/api/methods/setmessagereaction.md).
Native Telegram reactions use real chat/message IDs; these web bubbles do not have
those IDs, so no Bot API reaction call is made.

## User reactions

Tap/click **Горепочка's bubble** to open the picker:

**❤️ 👍 👎 🔥 😂 🥺 😮 😢 👏 🙏**

Choose one emoji. The reaction appears as a small rounded pill under the text,
beside the timestamp. The pill shows the emoji plus a 20px circular avatar of
the reactor on its right: your Telegram photo on Горепочка's bubbles, her
Telegram photo on your bubbles. Photos resolve live from the header avatars
(`#profileButtonAvatar`, `#botAvatar`, backed by `/api/profile/avatar` and
`/api/bot-avatar`); missing or private photos fall back to the initials circle.
Existing pills refresh when either avatar loads. Avatars are never stored in the
cache. Choosing the same emoji again removes it; another replaces
it. Each bubble has at most one reaction. There are no counts, expanded catalog,
premium/custom emoji or double-tap shortcuts. The layout uses the existing
pink/blue palette, white floating panel, 44px emoji targets and wrapping on mobile.

You cannot react to your own message or modify Горепочка's reaction. Read-only
archives cannot be changed. Links, playback controls and text selection do not
open the panel. Outside click, Escape, scroll and navigation dismiss it; keyboard
users can focus a bot bubble and use Enter/Space, then Left/Right/Home/End or Tab.

## Горепочка's reactions

Her raw model reply can contain:

```text
молодец <Поставить реакцию: 👏>
```

The server hides the command and returns `userReaction: "👏"` alongside the clean
reply and normal split-message delivery plan. The reaction attaches only to the
user bubble that initiated this request, even for captionless attachments, voice,
video notes, media jobs and completed-job retry recovery. It is applied after
delivery, not as a new message. She cannot target older messages or herself.

The exact prefix is `Поставить реакцию: `, case-sensitive. A bare emoji is canonical;
one surrounding `[emoji]` pair is tolerated. Emoji must be one grapheme, up to 64
UTF-16 units, containing only emoji components; skin tones, ZWJ sequences, flags
and keycaps are supported. Empty/text/multi-emoji/nested/malformed tags do nothing
and remain hidden. Last **valid** tag wins; invalid later tags do not clear it.
No tag means `userReaction: null` and no change to an existing pill. A tag-only
reply remains an error, not an empty bubble; prompt `04_gorepochka_reaction.md`
requires ordinary text. User-written tag strings are never interpreted.

## Storage and privacy

Reactions are **localStorage-only** in the existing per-slot, last-30-message cache.
User messages save `botReaction`; bot messages save `userReaction`. Cache/API
metadata is validated before rendering using text nodes, not HTML. Reload and slot
switch retain reactions; clear/delete removes them with messages. Clearing browser
data, losing the cache or switching devices loses them. No new database table,
endpoint, synchronization or AI call is introduced. Reactions are not included
in model conversation history; raw model commands are removed before history commits.

## Implementation and tests

- `src/services/tags/reaction.ts`: validation and parameterized tag handler.
- `src/services/tags/index.ts`: generic parameterized dispatch + reply metadata.
- `webapp/app/reactions/reactions.js`: rendering, picker, keyboard and precise user-wrap targeting.
- `webapp/app/chat/render.js`, `profile/profileRender.js`: refresh visible reaction avatars when
  bot/user avatars load.
- `webapp/styles.css`: pill layout with `.reaction-emoji` + 20px `.reaction-avatar`.
- `webapp/app/core/reactionValue.js`: cache/API validation, with an emoji-sequence fallback
  when older WebViews lack `Intl.Segmenter`.
- `webapp/app/chat/chatState.js`, `chat/render.js`: compatible cache persistence/restoration.
- `chat/chatActions.js`, `voice/voiceActions.js`: apply the reaction after successful delivery.

Run `npm run smoke` for parser, frontend, HTTP and media-job regression tests.
On Windows with PowerShell script execution disabled, use `npm.cmd run smoke`.
Final keyboard, safe-area and touch placement checks should also run inside real
Telegram iOS/Android/Desktop clients; system emoji artwork differs by platform.
