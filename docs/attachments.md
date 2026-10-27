# Attachments

The Mini App composer's single 📎 button accepts **images**, **text files** and
**video** (paste and drag-and-drop work too). One attachment per message is sent
alongside an optional caption.

Voice messages use the separate microphone control, not the paperclip. They support
tap-to-record/tap-to-stop, interruption preview, native model audio input and private playback. See
[Voice messages](./voice-messages.md).
Double-tap the microphone/camera to switch to [circular video notes](./video-notes.md), with a
separate 60-second recording cap. Ordinary paperclip videos remain rectangular attachments.

## Images

The composer accepts an image in **any of the usual formats** — JPEG, PNG, WebP, GIF,
TIFF, AVIF, HEIC/HEIF, SVG, JXL (whatever the bundled
[`sharp`](https://sharp.pixelplumbing.com)/libvips build can decode).

1. Tap 📎 (or paste / drag-and-drop a file). The app previews it and stages it.
2. On send, the raw file is POSTed to `/api/chat` as a base64 data URL (with your
   caption text, if any — a captionless image is allowed).
3. The server decodes and re-encodes it to **JPEG**: EXIF orientation applied,
   metadata stripped, longest side capped, transparency flattened onto white
   (`src/services/images.ts`, powered by [`sharp`](https://sharp.pixelplumbing.com)).
4. The JPEG goes to OpenRouter as an `image_url` part next to your text, so the
   model's answer takes the picture into account. Follow-up questions keep the image
   in the chat's context.

This needs a **vision-capable model**. A model without image support returns a
provider error, surfaced as a normal chat error. Limits are listed in
[Configuration](./configuration.md#image-attachments). The Mini App pre-checks the
picked file against `MAX_IMAGE_BYTES` (exposed by `/api/meta`) so oversized files are
rejected with a friendly message before upload.

Uploaded images live in the durable per-slot history (`chat_messages`, 35 pairs).
`GET /api/chat/history` returns the full JPEG dataURL inline, so a second device
displays the same picture. See [Configuration](./configuration.md#image-attachments). The Mini App pre-checks the
picked file against `MAX_IMAGE_BYTES` (exposed by `/api/meta`) so oversized files are
rejected with a friendly message before upload.

## Text files

The same 📎 button accepts **any file that contains text** — `.txt`, `.md`, `.json`,
`.cs`, `.js`, `.py`, `.yml`, `.log`, config files, and more:

1. Tap 📎, or paste / drag-and-drop a file. The app reads it, stages it and shows a
   preview with the name, size and character count.
2. On send, the raw file is POSTed to `/api/chat` as a `data:text/plain;base64,…` URL
   plus its `fileName` (a caption is optional; a captionless file is allowed).
3. The server caps the size, decodes the bytes as UTF-8 and rejects anything that
   looks binary (NUL bytes / mostly non-text). It then strips control characters,
   normalizes line endings and caps the text at `FILE_MAX_CHARS`
   (`src/services/textfiles.ts`).
4. The cleaned text is injected into the prompt inside an `[Attached file: …]` block,
   so the model can summarize, review or explain the file. Follow-up questions keep
   the file in the chat's context.

Text files work with **any** chat model (no vision needed, unlike images).
`GET /api/chat/history` returns the message text plus a `file: { name, snippet }`
descriptor, so a second device shows the same file bubble. The full file text stays
in the durable history for model context (capped at `FILE_MAX_CHARS`). There is no
separate file download — the bubble shows name + 240-char snippet, matching the
sending device. Limits are listed
in [Configuration](./configuration.md#text-file-attachments).

## Video

### User experience

1. Tap **📎** and choose a video, or drop/paste a file where the platform supports it.
   The file picker deliberately has no extension filter, so uncommon video formats are
   not hidden. A video is staged with its name, size and (when the browser can read it)
   duration and playback preview. Remove/replace it before sending, and optionally add
   a caption. One video per message is supported, alongside the existing image/text-file
   attachments.
2. Send it. **Загрузка N% → Подготовка видео → Анализ видео и звука** are separate
   states. Uploads are binary multipart data. Browser preview failure does not prevent
   upload: conversion happens on the server. Unsupported/corrupt/encrypted files are
   rejected with a readable error; nothing is silently trimmed to fit limits.
3. The server converts the complete clip into MP4 (H.264, up to 1280px / 30fps,
   primary audio track as AAC), then sends it as a native `video_url` content part to
   **the same `OPENROUTER_MODEL` you selected**. A captionless video receives a neutral
   request to analyze its visual and audio content. There is no automatic model switch,
   frame-only fallback, or external transcription service.
4. The answer uses the normal assistant bubbles and hidden split-tag handling.
   Cancellation stops the active upload/conversion or AI request; retry reuses a
   prepared clip and an idempotent request ID, avoiding duplicate paid requests after a
   lost response. Provider failures commit neither chat turn.
5. Tap **Открыть видео** on the message bubble to fetch its private normalized MP4
   with your credentials and play it inline. Captions and small video descriptors
   survive reload; full files/object URLs are never placed in localStorage.

**Model requirement:** configure an OpenRouter model/provider supporting native video
input and audio-in-video understanding. The app does not change your model or validate
its capabilities for you. A model lacking video support returns a normal provider
error. Model/provider payload and context limits still apply.

### API and lifecycle

- `POST /api/videos?chatId=1..5`: multipart form with exactly one `video` file;
  returns `202 { ok, video }` once bytes have uploaded. Conversion runs separately.
  Optional `kind=video-note` selects square normalization and the separate one-minute
  cap; omitted/`attachment` preserves regular videos. Unknown kinds are rejected.
- `GET /api/videos/:id`: private preparation status, thumbnail and metadata.
- `GET /api/videos/:id/media`: private converted MP4 (no-store; supports ranges).
- `DELETE /api/videos/:id`: cancel/remove an uncommitted upload. Clear the owning chat
  instead to delete media already used in conversation.
- `POST /api/chat`: add `videoId` and a unique `requestId` to the existing JSON
  request. Video turns and follow-ups in video conversations return
  `202 { ok, jobId, state }`; poll `GET /api/chat-jobs/:id` for `result`, which has the
  existing `reply/messages/model` response shape. Non-video chats retain their
  synchronous response. Send `requestId` on follow-ups too.
- `DELETE /api/chat-jobs/:id`: cancel analysis. The client also uses
  `DELETE /api/chat-jobs/request/:requestId` when a submission response was lost.
- All endpoints require the existing `X-Telegram-Init-Data` header. Opt-in local
  anonymous development uses `X-Miniapp-Client-Id`. Upload/media/job IDs are
  ownership-checked; a video cannot be submitted into another chat slot.

Source files are discarded after conversion. Converted media persists durably in
`MEDIA_DIR` + the `chat_media` table per `(user_id, slot, media_id)`, referenced from
history as `video_ref`. `GET /api/chat/history` returns a playable `video` descriptor
(id, poster, duration); private playback (`GET /api/videos/:id` + `/media`) falls back
to durable files when the in-flight upload is gone, so a second device or a restarted
server plays the same clip. Unreferenced media is pruned on history trim, and slot/user
media is removed on chat clear/delete. In-flight (uncommitted) uploads stay in the
process-local tmpdir with the 1h TTL (`VIDEO_TTL_MS`); anonymous dev uploads are never
persisted. For multiple server instances, share `MEDIA_DIR` (or object storage) alongside
the SQLite file.

Durationless browser WebM is accepted: a bounded decode measures its duration before
conversion; the normalized output is checked again. Over-limit clips are rejected,
not silently shortened. This applies to recorded notes and regular video uploads.

Recent videos are reattached to follow-up requests. Outgoing video context is bounded
to twice `VIDEO_MAX_OUTPUT_BYTES`; older clips outside that budget, or expired clips,
are replaced with an explicit note asking the model to request a reattachment instead
of pretending it can still inspect them.

### FFmpeg setup

`npm install` already installs the project-local binaries (`ffmpeg-static`,
`ffprobe-static`); no PATH change, administrator rights, or separate FFmpeg install is
needed. Startup logs report whether FFmpeg and FFprobe are available. If your platform
is unsupported, binary downloads are blocked, or you prefer maintained system binaries,
install them yourself and set **both** `FFMPEG_PATH` and `FFPROBE_PATH` to their
absolute paths. The supported formats depend on that build's demuxers/codecs;
playlist/manifest formats are intentionally disallowed. "Any format" does not mean
unlimited file size or guaranteed support for encrypted, corrupt or unknown codecs.
Limits are listed in [Configuration](./configuration.md#video-attachments).

Upload and analysis progress use short requests/polling instead of keeping a single
browser request open throughout conversion and generation.
