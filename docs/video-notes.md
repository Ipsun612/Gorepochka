# Circular video messages

Video notes (кружочки) are recorded and played inside the Mini App. The classic Telegram
bot still only redirects. The existing configured model receives native `video_url`
input containing the full video and its recorded audio: no transcription service,
frame-only substitute or model switch is used.

## Recording

- **Double-tap** the microphone/camera button to switch voice ↔ video. Mode taps never
  request capture permission. The icon transition respects reduced-motion preferences.
- **Single-tap** the camera button to start recording (one tap = one camera/microphone
  request); **single-tap again** to stop to preview, then Send. Delete or Escape discards.
- A circular live preview appears over a dimmed conversation, with elapsed time and a
  progress ring. There is no lock, flash, pause/resume or slide-to-cancel control. Text drafts are preserved
  and never silently become captions. Staged attachments must be removed first.
- Notes last up to **60 seconds**, or a lower `VIDEO_MAX_DURATION_SECONDS` if configured.
  Reaching a limit stops for review, not automatic sending. The existing video source
  byte limit also applies. Regular attachment videos keep their own configured duration.
- The front camera is preferred. On mobile, a flip button appears after permission when
  multiple video inputs are reported. Tap it with the other thumb while recording to switch
  front/rear cameras.
- Mobile detection uses Telegram `ios`/`android`, or mobile browser/iPad indicators for web
  clients. Narrow windows and touchscreen PCs are not treated as mobile. Desktop can record
  with its default webcam, but the flip button and underlying flip operation are disabled.
- A failed camera change attempts to restore the previous camera while keeping audio and
  the recording output alive. Failure to restore stops for review. A brief last-frame hold
  during hardware switching is possible; seamless hardware switching is not guaranteed.

Tapping again while a permission request is pending cancels that attempt, including late granted
streams. Tap again once permission is granted. Backgrounding, window blur,
camera/microphone interruption stop for review, never
auto-send. Chat/profile/model navigation uses the same discard confirmation as voice.
Available recovery drafts have play/pause, seeking, Send and Delete; capture is not resumed.

## Capture and playback

`videoNoteRecorder.js` uses a 480 × 480 canvas at 24 fps to center-crop the camera, with
the original microphone track. The output stream stays stable while the source camera
changes, avoiding unreliable `MediaRecorder` track replacement. Front-camera live preview
is mirrored locally; the recorded file is not mirrored. WebM/VP9, WebM/VP8 or MP4 is selected
at runtime, falling back to the browser default. A client without canvas-stream recording
gets an explicit unsupported message and can still use voice or attach a video file.

Sent notes render through `videoNoteRender.js` as circles, not ordinary rectangular
attachments. **Tap to play** (initially muted); use the labelled sound control to
mute/unmute. Sound controls affect local playback only, not the audio sent to the model.
Drag the progress ring clockwise from the top or use the keyboard-accessible seek slider.
Only the active voice/video-note player owns playback; starting another or recording
pauses it. There is no autoplay or media download on render.

Pending/failed notes support progress and Retry. Small descriptors (`kind`, ID, duration,
poster, delivery state) survive reload; file bytes and object URLs never enter localStorage.
Reloaded unsent notes honestly request a new recording. Authenticated media is fetched on
demand, and players/URLs are released when leaving or clearing a chat.

## Backend and AI

- `POST /api/videos?chatId=1..5&kind=video-note` uploads exactly one multipart `video`.
  Omitted `kind` means a normal attachment; unknown kinds are rejected.
- The existing status and private media routes return `kind: "video-note"` in metadata.
  Submission still uses `{ chatId, videoId, requestId, message: "" }` at `/api/chat`.
- FFmpeg verifies the actual bytes and produces a metadata-stripped square H.264/AAC MP4
  (up to 480 × 480), which is circularly masked by the player. Notes are ordinary playable
  MP4 files, not a new codec/container or Telegram Bot API `sendVideoNote` message.
- Browser WebM without duration metadata is measured with a time-bounded decoding pass,
  then normalized and validated. Size/time/duration/pixel/concurrency caps still apply;
  exceeding a limit fails instead of silently sending a shortened clip.
- Video-note model context asks for a natural conversational response to what the user
  communicates. Follow-ups retain native video context under the existing video budget.
- Existing ownership/chat checks, retry idempotency, cancellable jobs and commit-on-success
  behavior are reused. See [Attachments](./attachments.md#video) for API details.

The security header permits same-origin camera and microphone only. HTTPS/localhost,
`MediaRecorder`, camera/microphone access and canvas `captureStream` are required.
Telegram Web's parent iframe may need to delegate permissions, which this server cannot
override. All camera, microphone and canvas tracks stop on finish/discard/interruption;
late permission/camera-switch results are stopped too.

Retention is unchanged: `VIDEO_TTL_MS` defaults to one hour; chat/history cleanup and
shutdown delete private media. A server restart invalidates IDs. Durable or cross-device
playback requires separate persistent storage and is not provided by these notes.

## Verification

`npm run smoke:video-notes` exercises synthetic capture/tap races, camera switching and
rollback, desktop exclusion, late streams, limits and cleanup. `smoke:webapp` covers actual
module integration, tap-to-start/stop, retry, seeking/muting and private descriptor restoration.
`smoke:videos` uses real FFmpeg including durationless WebM, square output, native video/audio
payloads and independent 60-second validation. No real devices or paid model calls are used.

Before deployment, test Telegram iOS/Android/Desktop/Web on real devices: first permission
grant/denial, single/double-tap, flip with the other thumb while recording, single-camera phones, busy cameras,
background/lock/interruption, MP4/WebM playback, seeking, audio, screen readers and safe areas.
