# 🎵 Music Folder

Place your music files here — they will automatically stream to the client when hosted on a web server.

## Quick Start (Hosted Server)

1. Drop audio files in this `music/` folder
2. Run from the `weatherclient/` directory:
   ```bash
   node generate-playlist.js
   ```
3. Commit & deploy — music streams automatically on page load ✅

## Quick Start (Local / File://)

When opening the page as a local file (`file://`), the folder picker is needed instead:

1. Open the **Settings** panel (☰)
2. Click **📁 Load Music Folder**
3. Select the `music/` folder

> **Note:** Both modes work simultaneously — server tracks load automatically, then local picker tracks are merged in.

## Supported Formats

| Format | Extension |
|--------|-----------|
| MP3    | `.mp3` ✅ recommended |
| OGG Vorbis | `.ogg` |
| WAV    | `.wav` |
| FLAC   | `.flac` |
| AAC / M4A | `.m4a` |
| Opus   | `.opus` |

## generate-playlist.js

Auto-scans this folder and writes `playlist.json`. Run it **after adding or removing files**.

```bash
# Run from weatherclient/ directory
node generate-playlist.js
```

## Files in This Folder

| File | Purpose |
|------|---------|
| `playlist.json` | Auto-generated track list (commit this) |
| `generate-playlist.js` | ← Run this when adding new tracks (in parent dir) |
| `*.mp3` / etc. | Your audio files |
