/**
 * Shared Mini App ↔ API contract (frontend mirror of the backend shapes).
 *
 * These typedefs duplicate, by design, the runtime contracts owned by:
 * - `src/services/openrouter.ts` (`ChatTextPart`, `ChatImagePart`,
 *   `ChatVideoPart`, `ChatAudioPart`, `ChatContentPart`, `ChatMessage`)
 * - `src/server/routes/chatRoutes.ts` (`POST /api/chat` request/response)
 *
 * The Mini App is bundler-free plain JS with no typechecker, so this file is
 * documentation + editor assistance (JSDoc). If the backend shapes change,
 * update this file in the same commit (see AGENTS.md rule 1).
 *
 * @typedef {object} ChatTextPart
 * @property {'text'} type
 * @property {string} text
 *
 * @typedef {object} ChatImagePart
 * @property {'image_url'} type
 * @property {{ url: string }} image_url — data-URL JPEG (see `media/image.js`)
 *
 * @typedef {object} ChatVideoRef
 * @property {'video_ref'} type — private-history reference, resolved server-side
 * @property {string} videoId
 *
 * @typedef {object} ChatAudioRef
 * @property {'audio_ref'} type — private-history reference, resolved server-side
 * @property {string} audioId
 *
 * @typedef {ChatTextPart|ChatImagePart|ChatVideoRef|ChatAudioRef} ChatContentPart
 *
 * @typedef {object} ChatPayload — `POST /api/chat` body (see `core/api.js` `chatPayload`)
 * @property {string} [message]
 * @property {number} [chatId] — 1..5, default 1 (see `chat/chatState.js`)
 * @property {string} [initData] — Telegram WebApp init data (auth)
 * @property {string} [clientId]
 * @property {string} [image] — image data URL
 * @property {string} [file] — text-file data URL
 * @property {string} [fileName]
 * @property {string} [videoId] — requires `requestId`
 * @property {string} [audioId] — requires `requestId`
 * @property {string} [requestId] — `[a-zA-Z0-9-]{8,80}`, idempotency/cancellation key
 *
 * @typedef {object} ChatReplyPart — one assistant bubble with its typing pause
 * @property {string} text — visible text (hidden tags already stripped)
 * @property {number} delayMs — typing pause before this bubble
 *
 * @typedef {object} ChatResult — `POST /api/chat` success body
 * @property {true} ok
 * @property {number} chatId
 * @property {string} reply — full tag-free reply (history commit)
 * @property {ChatReplyPart[]} messages — bubbles to render in order
 * @property {string} [userReaction] — emoji for the triggering user bubble
 * @property {string} [model]
 * @property {boolean} [truncated]
 * @property {boolean} [hasImage]
 * @property {boolean} [hasFile]
 * @property {boolean} [hasVideo]
 * @property {boolean} [hasAudio]
 * @property {string} [jobId] — async media job; poll via `video/video.js` `waitForReply`
 */

export {};
