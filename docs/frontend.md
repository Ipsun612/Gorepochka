# Frontend (GorCOgramm Mini App)

The Mini App in `webapp/` is bundler-free: plain `index.html`, CSS and ES modules
under `webapp/app/`, grouped by feature (`core/`, `chat/`, `voice/`, `video/`,
`media/`, `profile/`, `character/`, `lorebook/`, `reactions/`; `main.js` stays at
`app/` as the entry point). Chat, render and voice logic live in focused modules
behind small barrel entries (`chat/chatActions.js`, `chat/render.js`,
`voice/voiceActions.js`); the shared API shapes are documented in
`core/apiContract.js` (a JSDoc mirror of `src/services/openrouter.ts`). No
framework, build pipeline, external font, or icon CDN is required.
`webapp/package.json` exists only to mark `app/**/*.js` as ES modules.

## Visual design

- **Visual layout:** one responsive conversation column, a rounded white header and
  composer, a static local wallpaper, pale-blue outgoing bubbles, and lightly
  pink-tinted incoming bubbles. Strong glass effects, floating blobs, decorative emoji
  buttons, the permanent model pill, and the footer have been removed.
- **Identity:** the document title and app branding use `GorCOgramm`; the header and
  message announcements always use **Горепочка**. Telegram can still supply the proxied
  avatar; its absence or failure leaves a **Г** fallback. Telegram profile names and the
   configurable backend `APP_NAME` do not override the Mini App persona.

## Profile screens

The left bot avatar is a labelled button opening **Профиль Горепочки**. Its read-only
biography shows her character name/handle, age and interests from the system persona.
The editable **Характер** section has 15 trait blocks, split into **Общение**,
**Настроение**, **Манера** tabs (five each), with three descriptive radio choices per
trait, draft summary, changed-count badges, Save and reset-to-defaults. No free-text
personality editor exists. Tabs support arrow/Home/End navigation; radio controls retain
native keyboard behavior and visible focus, with at least 48px-high choice targets.

The right **Я** button and Telegram Settings still open My profile. Shared navigation
protects unsaved drafts when switching profiles and preserves chat drafts/attachments,
scroll and background replies. Settings remain per-user across all five chats/devices,
not localStorage. See [Character profile](./character-profile.md) and [Profiles](./profiles.md).

## Lorebook screen

The **book/globe icon immediately left of the user's avatar** opens one **Лорбук Горепочки** screen with the same sticky Back/Save
header and pink/blue profile cards. Primary entries are expandable read-only cards with
keyword chips and permanent/keyword labels; there are no edit/delete/disable controls.
The private section has three-entry, 300-content-character and ten-keyword counters,
title/content/key inputs, permanent mode and confirmed deletion. The optional title
(`comment` in JSON) has a 40-character counter and may be empty. Primary headings show
the title, falling back to content previews when empty. The icon is an inline SVG
using the same stroke, button size and interaction states as the Mini App's other
header controls, with a pink-to-blue gradient stroke matching the messenger palette; the old lorebook menu item is removed. Save commits a draft;
failures/conflicts retain edits. Closing returns focus to the header lorebook button.
Shared profile navigation protects drafts and live recordings and preserves conversation
state/background delivery. All private draft data stays in memory. See [Lorebook](./lorebook.md).

**Мои записи** shows only compact limits, activation/save guidance, keyword hint and
one privacy notice. Technical matching/retention rules stay in documentation.

## Compatibility

- Telegram chrome colors/haptics are version-gated and skipped outside authenticated
  Telegram launches.
- Anonymous local-development requests omit empty `initData` rather than presenting it
  as invalid credentials; development still requires explicit `ANON_MODE=on`, and
  production authentication is unchanged.
- Asynchronous file-picker reads are discarded after switching chats, sending, removing,
  or replacing that attachment, so an old selection cannot reappear in another
  conversation.

## Controls

Only functional controls exist: attachment picker, send, add chat, overflow actions,
attachment removal, private video/voice playback/retry/cancel, microphone recording,
tap-to-record voice/video notes, interruption preview, mobile camera flipping and a
latest-message button when scrolled away, and a working message-reaction picker. There are no unsupported calls, search, composer emoji-picker, or
fabricated read-receipt controls. Status text reflects connection/request activity, not
real Telegram presence or last-seen information.

Voice input uses a separate state-driven composer, preserves typed text, confirms
discarding on navigation and stops capture on background/interruption. See
[Voice messages](./voice-messages.md) for controls, compatibility and retention.
The shared recording button switches microphone/camera on double-tap, starts/stops recording on single-tap and
sends from preview. Circular video notes match the existing pink/blue
palette and include seeking plus mute/unmute. Recording has no lock, flash or pause.
Camera flip is mobile-only, not based on window width. See [Video notes](./video-notes.md).

## History display

New messages cache their actual local `createdAt` ISO timestamp; bubble times and date
separators survive reload. Old cache entries without valid timestamps remain undated
rather than receiving invented dates. Captionless images that cannot be decoded locally
retain an honest attachment note after reload. Existing storage keys and custom chat
names remain compatible. As before, the cache is display-only, limited to the last 30
messages; server history remains process-local, not a durable synchronized inbox.
Validated `botReaction` (on user messages) and `userReaction` (on bot messages) survive
the same cache round-trip. They do not sync across devices or become AI context.

## Message reactions

Click/tap a bot bubble (or focus it and press Enter/Space) to open a rounded white
picker with **❤️ 👍 👎 🔥 😂 🥺 😮 😢 👏 🙏**. It floats near the bubble, flips below
when needed, stays within the chat viewport and wraps on narrow screens while
retaining 44px targets. Reaction pills sit inside the bubble beside the timestamp;
clicking your existing pill reopens the picker. Selecting the same emoji removes it;
a different emoji replaces it. User bubbles cannot open the picker, but can show
Горепочка's automatically applied reaction to that turn.

Buttons have Russian labels and selected states; Left/Right/Home/End and Tab navigate,
Escape closes and returns focus. Outside clicks, scrolling, resize, chat clear/switch,
send and profile navigation close the panel. Links, media controls and text selection
keep their existing gestures. Recording, management, profile and archived states
cannot open the picker. Reduced-motion preferences are respected. No expanded emoji
catalog, counts or real Telegram reaction animations are claimed. See [Reactions](./reactions.md).

## Legacy slot safety

Saved chat IDs above 5 are preserved as explicitly labelled read-only archives, not
silently remapped to another server conversation. Their cached messages can be read,
renamed, or deliberately deleted. Archives count toward the five-item selector limit;
delete one to make room if necessary. They cannot send messages or clear a different
chat. The last archive is replaced with a cleared live slot only after successful server
cleanup.

## Viewport and scrolling

The conversation scrolls independently while the header and composer remain visible.
Telegram viewport/safe-area events and browser visual-viewport resizing are supported.
New replies do not pull readers away from older messages; the down-arrow button returns
to the latest. Replies do not automatically reopen the mobile keyboard.

## Keyboard and accessibility

- Desktop **Enter** sends and **Shift+Enter** inserts a newline; touch devices retain
  Enter for newlines and use the send button. IME composition does not accidentally send.
- Menus support arrow keys/Home/End/Escape; dialogs contain keyboard focus, restore it
  on close, and require confirmation for destructive actions.
- Visible focus rings, labelled controls, message announcements, zoom support, and
  reduced-motion styling are included.

## Verification

`npm run smoke:webapp` reads the real HTML shell and checks fixed identity, timestamp
restoration/undated legacy caches, scroll controls, menu/dialog keyboard behavior, safe
reaction picking/toggle/replacement, cache validation and slot isolation,
repeated slot reuse, cleanup failures, read-only archives, attachments, and sequential
replies, plus character-profile tabs, 15 trait blocks, save/reset/conflicts and navigation
guards. See [Development](./development.md). Final keyboard and safe-area behavior should
also be checked in Telegram on iOS/Android before deployment.

The same smoke test exercises lorebook locked cards, Unicode/keyword limits, add/delete,
save/reload failures/conflicts, draft navigation and recording guards.
