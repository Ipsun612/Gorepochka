/**
 * Shared Mini App ↔ API contract (frontend mirror of the backend shapes).
 *
 * These typedefs duplicate, by design, the runtime contracts owned by:
 * - `src/services/openrouter.ts` (`ChatTextPart`, `ChatImagePart`,
 *   `ChatVideoPart`, `ChatAudioPart`, `ChatContentPart`, `ChatMessage`)
 * - `src/server/routes/chatRoutes.ts` (`POST /api/chat` request/response)
 * - `src/server/routes/historyRoutes.ts` (`GET /api/chat/history`, `POST /api/chat/reaction`)
 * - `src/server/routes/chatMetaRoutes.ts` (`GET/PUT /api/chats`)
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
 * @property {string} [userReaction] — emoji for the triggering user bubble (display-only)
 * @property {string|null} [userMessageId] — durable turn id for the user message
 * @property {string|null} [assistantMessageId] — durable turn id for the assistant reply
 * @property {string} [model]
 * @property {boolean} [truncated]
 * @property {boolean} [hasImage]
 * @property {boolean} [hasFile]
 * @property {boolean} [hasVideo]
 * @property {boolean} [hasAudio]
 * @property {string} [jobId] — async media job; poll via `video/video.js` `waitForReply`
 *
 * @typedef {object} HistoryEntry — `GET /api/chat/history` item (cross-device, playable media)
 * @property {string} id — durable turn id (use for `POST /api/chat/reaction`)
 * @property {'user'|'bot'} role
 * @property {string} text — message text without the file block (tags stripped for bot)
 * @property {string} createdAt — ISO timestamp
 * @property {string|null} userReaction — user pick on bot bubbles (display-only)
 * @property {string|null} botReaction — Горепочка auto reaction on user bubbles (display-only)
 * @property {string|null} image — full JPEG dataURL when the turn had an image (cross-device)
 * @property {{name:string,snippet:string}|null} file — text-file descriptor (name + 240-char snippet)
 * @property {{id:string,name:string,size:number,duration:number,poster:string|null,kind?:string,delivery:string}|null} video — playable via `GET /api/videos/:id/media`
 * @property {{id:string,duration:number,size:number,waveform:number[],delivery:string}|null} voice — playable via `GET /api/audio/:id/media`
 * @property {boolean} hasImage — original turn had an image
 * @property {boolean} hasVideo — original turn referenced a video
 * @property {boolean} hasAudio — original turn referenced audio
 *
 * @typedef {object} ChatsMeta — `GET/PUT /api/chats` (cross-device tab names + active slot)
 * @property {{slot:number,name:string}[]} tabs — 1..5 slots
 * @property {number} activeSlot
 * @property {number} revision — optimistic concurrency (`CHATS_CONFLICT` on stale PUT)
 */

export {};
