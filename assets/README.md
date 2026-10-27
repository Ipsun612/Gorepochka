# Welcome image (`/start` photo)

Place the `/start` welcome photo here as one of:

- `welcome.jpg` (preferred)
- `welcome.jpeg`
- `welcome.png`
- `welcome.webp`

The bot (`src/bot/bot.ts`) picks the first file that exists and sends it
with the Russian welcome caption plus the Mini App button. No code or
config change is needed — just drop the file in and restart the bot.

Recommendations:

- JPEG ~1280 px on the long side, under 2 MB.
- Pink-and-blue artwork matching GorCOgramm; avoid text baked into the
  image (the caption already carries the text and is easy to edit).
- Optional: keep the Telegram caption limit in mind (1024 characters) —
  the current caption is well under it.

When no file is present (or the photo upload fails), `/start` falls back
to the same Russian text without a photo. This folder intentionally holds
only the image: nothing here is served over HTTP or committed by default
beyond `.gitkeep`.
