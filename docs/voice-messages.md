# Voice messages

Voice messages stay inside the Mini App. The Telegram bot still only redirects to it.
The existing `OPENROUTER_MODEL` receives native audio and answers normally as Горепочка;
there is no separate speech-recognition service, automatic model switch, mandatory
transcript review, or generated audio reply. The configured model/provider must support
OpenRouter `input_audio` with `format: "mp3"` (vision support alone is not sufficient).

## Recording and playback

1. **Double-tap** the microphone/camera to switch between voice and
   [circular video](./video-notes.md), with an animated icon (no animation under reduced
   motion). **Single-tap** in microphone mode to start recording; **single-tap again**
   to stop to preview. This avoids repeated permission prompts: one tap equals one
   permission request. HTTPS (or localhost development), `getUserMedia`, and `MediaRecorder`
   are required. Permission is never requested by a mode-switch tap or on page load.
2. Recording shows Delete, the actual microphone waveform, elapsed time and a
   “press again to finish” hint. Press the record button again, or use Send/Delete/Escape:
   there is no slide-to-cancel, recording lock or pause/resume while recording.
   Space/Enter on the focused recording button also supports single/double-tap.
3. Interruptions and recording limits stop for review, with play/pause, seeking,
   Send and Delete. Capture is fully released. Existing typed text is preserved and is
   never secretly included as an audio caption. Remove staged attachments before recording.
   Tapping again while permission is pending cancels that attempt;
   even a late granted stream is stopped. Tap again to record after permission is granted.
4. Send inserts one voice bubble: **Загрузка N% → Подготовка аудио → Горепочка слушает**.
   Reply delivery retains the existing hidden-tag handling and typing pauses. The text
   composer returns without automatically opening the keyboard.
5. Voice bubbles support play/pause and a keyboard-accessible seek slider. Playback is
   authenticated and private. Starting another voice/video note or a new recording stops
   previous voice/video-note playback. A waveform unavailable in the client is flat, not fabricated;
   prepared bubbles use waveform peaks calculated from the real normalized recording.

Switching chats, clearing/deleting/renaming a chat or opening profile/model UI asks before
discarding an unsent voice draft. Recording stops for this confirmation; Stay retains
the preview. Pending permission requests are cancelled safely, including late streams.
Telegram closing confirmation and browser unload protection are enabled while drafting.
Navigation confirmations contain focus and make the chat background inert.

Minimizing/backgrounding the app or a microphone interruption finalizes the available
recording for review and stops capture. It never auto-resumes or auto-sends. Reaching a
recording limit also stops for review. A too-short, oversized, empty or corrupt recording
shows an explicit error. Duration/size limits default to five minutes / 20 MiB.

## Transport and AI context

`MediaRecorder.isTypeSupported` selects WebM/Opus, MP4/AAC, Ogg/Opus, or the browser's
default container at runtime. Browser preview support does not determine whether the
server can decode it. The server probes bytes rather than trusting extensions/MIME,
then normalizes the whole recording to mono, 24 kHz, 64 kbit/s MP3, stripping metadata.
Durationless live WebM recordings are bounded during decoding and checked afterwards.
Over-limit recordings are rejected, not silently shortened.

The client uploads binary multipart data, not JSON/base64. History stores `audio_ref`
IDs; immediately before model generation the server resolves recent recordings to
`{ type: "input_audio", input_audio: { data: "<base64>", format: "mp3" } }` parts.
The configured prompts/persona and restricted profile context remain unchanged.
No separately displayed transcript is generated. If speech is absent/unclear, the
model is instructed to say so rather than inventing words.

Audio context has its own `AUDIO_CONTEXT_MAX_BYTES` budget (6 MiB by default), in
addition to the existing video budget (40 MiB by default). Recent audio is preferred;
expired/older omitted audio is replaced with an explicit unavailable-media note.
Provider context/payload limits still apply, including base64 overhead.

## API

All routes require existing Telegram credentials (`X-Telegram-Init-Data`), or explicitly
enabled local anonymous development identity (`X-Miniapp-Client-Id`).

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/audio?chatId=1..5` | Exactly one multipart `audio` file; `202 { ok, audio }` |
| GET | `/api/audio/:id` | Private uploading/preparing/ready/failed status + metadata |
| GET | `/api/audio/:id/media` | Private normalized MP3, no-store, range support |
| DELETE | `/api/audio/:id` | Cancel/delete an uncommitted upload; in-use/committed returns 409 |
| POST | `/api/chat` | `{ chatId, audioId, requestId, message?: "" }`; returns 202 job |
| GET | `/api/chat-jobs/:id` | Analysis state and existing reply result shape |
| GET | `/api/chat-jobs/request/:requestId` | Recover a lost submission result without resubmitting |
| DELETE | `/api/chat-jobs/:id` or `/api/chat-jobs/request/:requestId` | Cancel analysis |

IDs are owner-checked and audio submission is also chat-slot-checked. One audio cannot
be combined with image/video/file parts in the same turn. Audio-context follow-ups use
the same job API and require request IDs, including text/image/file follow-ups.

Retry reuses prepared audio and the request ID after a lost response. A failed or
cancelled terminal job gets a new ID only on explicit retry. Both chat turns commit
only after generation succeeds. Cancellation signals the server as well as aborting
the browser request; it cannot undo provider charges already incurred. Idempotency
lasts only while the process-local job record is retained. Failed recordings are kept
in browser memory for Retry until chat navigation/reload; raw bytes are never cached
in localStorage. Reloaded pending/failed bubbles honestly say to record again.

## Privacy, lifecycle and deployment

Source files are removed after preparation. Private normalized MP3 expires after one
hour by default, and is deleted on history eviction, chat cleanup and graceful shutdown.
Registries/history are process-local: a restart invalidates IDs and old bubbles show
an unavailable message. Durable playback, multi-server jobs and cross-device history
require shared persistent storage/queues and are not part of this feature.

FFmpeg execution has byte/time/duration/output/concurrency/storage caps, bounded output,
no shell and no network inputs or playlists. The server permits `microphone=(self)` and
`camera=(self)` for explicit recording; geolocation remains blocked. Telegram Web iframe embedding may additionally
require permission delegation from its parent, which this server cannot override.

Verify in Telegram iOS/Android/Desktop/Web: permission grant/denial, single/double-tap/preview,
send/retry/cancel, background/lock/interruption, text-draft restoration, seeking, safe
areas and screen readers. Automated tests use synthetic audio, not your microphone or
paid provider. See [Configuration](./configuration.md#voice-messages) for limits.
