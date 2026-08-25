# Jarvis Browser Extension

Ask Jarvis about any webpage without switching tabs.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select `apps/extension/`

## Requirements

Jarvis must be running at `http://localhost:8787`. Use **START JARVIS FINAL** on your desktop.

## Usage

| Action | Result |
|--------|--------|
| `Ctrl+Shift+J` | Open / close the Jarvis panel |
| `Escape` | Close the panel |
| Edit context box | Control what Jarvis sees about the page |
| Click 🔊 | Hear the answer spoken aloud |
| Open in Jarvis → | Open full Jarvis in a new tab |

## Notes

- Works on most websites. A small number of sites (e.g. some Google apps) block browser extensions via CSP — this is a browser limitation.
- Context is capped at 800 characters to keep API calls fast.
- If Jarvis requires an unlock token, open Jarvis in the browser once so the
  extension can copy it. Reload the extension after changing `OCTOGENT_AUTH_TOKEN`.
- Voice defaults to Deepgram Odysseus (deep male). Change in Jarvis Settings → Voice.
