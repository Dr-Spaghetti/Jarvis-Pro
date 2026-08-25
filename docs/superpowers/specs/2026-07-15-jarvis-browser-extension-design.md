# Jarvis Browser Extension — Design Spec
**Date:** 2026-07-15  
**Status:** Approved

## Overview

A Chrome/Edge MV3 browser extension that lets the user ask Jarvis questions about any webpage without switching tabs. Triggered by `Ctrl+Shift+J`, a floating panel appears with auto-captured page context (selected text, title, URL), a question input, and an inline answer with TTS playback and a link to open full Jarvis.

## Architecture

Plain JS (no build step). Lives at `apps/extension/` in the monorepo.

```
apps/extension/
  manifest.json    — hotkey, host permissions, content script declaration
  background.js    — MV3 service worker; receives hotkey, relays toggle to active tab
  content.js       — floating panel logic: show/hide, context capture, API calls, audio
  content.css      — NC OS styling (dark background, neon green accents, monospace)
  icon.png         — Jarvis icon (128×128)
```

## Data Flow

1. User presses `Ctrl+Shift+J`
2. Background service worker receives command → sends `{ type: "toggle" }` to active tab
3. Content script receives message → shows/hides the floating panel
4. On open: captures `window.getSelection().toString()` + `document.title` + `location.href` → fills editable context box (truncated to 800 chars)
5. User edits context if needed, types question, presses Enter or clicks SEND
6. Content script POSTs to `http://localhost:8787/api/brain/ask` with `{ question, clipboardContext }`
7. Answer renders in panel
8. Play button POSTs to `http://localhost:8787/api/voice/speak` with `{ text, provider: "deepgram", model: "aura-2-odysseus-en" }` → plays returned MP3 blob
9. "Open in Jarvis →" opens `http://localhost:8787` in a new tab (v1: homepage only, no pre-fill)

## Panel UI

Floating panel, bottom-right corner, `z-index: 2147483647`.

```
┌─────────────────────────────────┐
│ JARVIS                      ✕  │
├─────────────────────────────────┤
│ CONTEXT (editable textarea)     │
│ "Selected text here..."         │
│ Page Title · site.com/path      │
├─────────────────────────────────┤
│ Ask Jarvis...              SEND │
├─────────────────────────────────┤
│ JARVIS: Answer text here...     │
│                                 │
│ 🔊  Open in Jarvis →            │
└─────────────────────────────────┘
```

- `Escape` closes the panel
- Panel is not draggable (v1 — keep it simple)
- Loading state shows "Thinking..." in the answer area
- Play button only appears after an answer is received

## API Integration

### Ask
```
POST http://localhost:8787/api/brain/ask
{ question: string, clipboardContext?: string }
```

### Speak
```
POST http://localhost:8787/api/voice/speak
{ text: string, provider: "deepgram", model: "aura-2-odysseus-en" }
→ returns MP3 blob
```

## CORS Fix Required

The Jarvis API must return `Access-Control-Allow-Origin: *` (or the extension origin) for requests from `chrome-extension://...`. This needs to be added to the API's response headers middleware before the extension can function.

## Error Handling

| Scenario | Panel shows |
|---|---|
| Jarvis not running | "Jarvis is offline — start it first." |
| No answer model | Hint text from API response |
| Audio playback fails | Silent fail — play button disappears |
| Site blocks content script | Extension icon shows; panel cannot inject (rare) |

## Permissions (manifest.json)

```json
"permissions": ["activeTab"],
"host_permissions": ["http://localhost:8787/*"]
```

`activeTab` grants temporary access to the current tab on hotkey press. `host_permissions` allows fetch to localhost.

## Installation

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select `apps/extension/`

## Out of Scope (v1)

- Draggable panel
- Screenshot capture (v2)
- Works on `chrome://` pages (browser restriction, unfixable)
- Invisible to screen recording (requires Electron — separate project)
