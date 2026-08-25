# Jarvis Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome/Edge MV3 browser extension that opens a floating Jarvis panel on any webpage via Ctrl+Shift+J, with auto-captured page context, question input, inline answer, TTS playback, and a link to full Jarvis.

**Architecture:** Plain JS extension (no build step) in `apps/extension/`. Background service worker relays the keyboard shortcut to the active tab's content script. Content script injects a floating panel that POSTs to the existing Jarvis API at localhost:8787. One targeted CORS fix in the existing API security layer allows `chrome-extension://` origins.

**Tech Stack:** Chrome Extension MV3, plain JS/CSS, Node.js HTTP (existing Jarvis API)

## Global Constraints

- MV3 (Manifest Version 3) — no MV2 APIs (no persistent background pages, no `chrome.extension.getBackgroundPage`)
- No build step — plain JS loaded directly by Chrome
- Jarvis API base: `http://localhost:8787`
- Max context sent to API: 800 characters
- Default TTS: provider `"deepgram"`, model `"aura-2-odysseus-en"`
- Panel z-index: `2147483647`
- Panel position: fixed, bottom-right, 380px wide
- Colors: background `#0a0a0a`, accent `#00ff88`, muted text `#888`, font `'Courier New', monospace`

---

### Task 1: CORS fix — allow chrome-extension:// origins to reach the API

**Files:**
- Modify: `apps/api/src/createApiServer/security.ts`

**Interfaces:**
- Produces: `isAllowedOriginHeader` returns `true` for `chrome-extension://` scheme origins, allowing `getRequestCorsOrigin` to echo the origin back and set `Access-Control-Allow-Origin`

- [ ] **Step 1: Read the current `isAllowedOriginHeader` function**

Open `apps/api/src/createApiServer/security.ts` and find this function (around line 32):

```typescript
export const isAllowedOriginHeader = (origin: string | undefined, allowRemoteAccess: boolean) => {
  if (allowRemoteAccess || origin === undefined) {
    return true;
  }

  const hostname = parseHostname(origin, true);
  return hostname !== null && isLoopbackHostname(hostname);
};
```

- [ ] **Step 2: Add chrome-extension scheme check**

Replace the function body to also allow `chrome-extension://` origins:

```typescript
export const isAllowedOriginHeader = (origin: string | undefined, allowRemoteAccess: boolean) => {
  if (allowRemoteAccess || origin === undefined) {
    return true;
  }

  // Allow browser extension origins (chrome-extension://, moz-extension://)
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return true;
  }

  const hostname = parseHostname(origin, true);
  return hostname !== null && isLoopbackHostname(hostname);
};
```

- [ ] **Step 3: Verify the existing security tests still pass**

```
cd apps/api && pnpm test -- --testPathPattern=security 2>&1 | tail -20
```

If no security test file exists, skip. The logic change is additive — existing loopback checks are untouched.

- [ ] **Step 4: Rebuild the API**

```
pnpm --filter api build 2>&1 | tail -5
```

Expected: `✓ built` with no errors.

- [ ] **Step 5: Commit**

```
git add apps/api/src/createApiServer/security.ts
git commit -m "feat(api): allow chrome-extension origins through CORS"
```

---

### Task 2: Extension scaffold — manifest and icon

**Files:**
- Create: `apps/extension/manifest.json`
- Create: `apps/extension/icon.png`

**Interfaces:**
- Produces: `apps/extension/` directory loadable via chrome://extensions → Load unpacked, with `Ctrl+Shift+J` command registered

- [ ] **Step 1: Create the extension directory**

```
mkdir apps\extension
```

- [ ] **Step 2: Create the icon**

Run this Node.js one-liner to create a minimal 128×128 green Jarvis icon PNG (writes raw PNG bytes):

```
node -e "
const { createCanvas } = require('canvas');
" 2>&1
```

If `canvas` is not available, use this alternative — copy the existing SVG favicon and rename it. Chrome accepts SVG for icons in some contexts, but for `manifest.json` icons we need PNG. Instead, create a 1×1 pixel placeholder and replace it manually:

```
node -e "
const fs = require('fs');
// Minimal 1x1 green PNG (base64)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAALEwAACxMBAJqcGAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABSSURBVHja7cEBDQAAAMKg909tDjehAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgbQIMAAAB//Z', 'base64');
fs.writeFileSync('apps/extension/icon.png', png);
console.log('icon.png written');
"
```

- [ ] **Step 3: Create manifest.json**

Create `apps/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Jarvis",
  "version": "1.0.0",
  "description": "Ask Jarvis about any webpage without switching tabs.",
  "permissions": ["activeTab"],
  "host_permissions": ["http://localhost:8787/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "toggle-panel": {
      "suggested_key": {
        "default": "Ctrl+Shift+J",
        "mac": "Command+Shift+J"
      },
      "description": "Toggle Jarvis panel"
    }
  },
  "icons": {
    "128": "icon.png"
  }
}
```

- [ ] **Step 4: Create empty placeholder files so Chrome doesn't error on load**

```
echo "" > apps\extension\background.js
echo "" > apps\extension\content.js
echo "" > apps\extension\content.css
```

- [ ] **Step 5: Load in Chrome and verify**

1. Open `chrome://extensions`
2. Enable "Developer mode" toggle (top right)
3. Click "Load unpacked"
4. Select the `apps/extension/` folder
5. Expected: "Jarvis" extension card appears with no red error banners

- [ ] **Step 6: Commit**

```
git add apps/extension/
git commit -m "feat(extension): scaffold manifest, icon, and placeholder files"
```

---

### Task 3: Background service worker — hotkey relay

**Files:**
- Modify: `apps/extension/background.js`

**Interfaces:**
- Consumes: Chrome `commands` API — fires on `Ctrl+Shift+J`
- Produces: Sends `{ type: "toggle" }` message to the active tab via `chrome.tabs.sendMessage`

- [ ] **Step 1: Write background.js**

Overwrite `apps/extension/background.js` with:

```js
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "toggle" }, () => {
      // Suppress "no receiver" errors on chrome:// pages where content scripts can't inject
      void chrome.runtime.lastError;
    });
  });
});
```

- [ ] **Step 2: Reload extension in Chrome**

Go to `chrome://extensions` → click the circular refresh icon on the Jarvis card.

- [ ] **Step 3: Test hotkey fires**

1. Open any regular webpage (e.g. `https://example.com`)
2. Press `Ctrl+Shift+J`
3. Click "Service Worker" link on the Jarvis extension card to open its console
4. Expected: No errors. (Nothing visible yet — content.js is still empty.)

- [ ] **Step 4: Commit**

```
git add apps/extension/background.js
git commit -m "feat(extension): background service worker relays Ctrl+Shift+J to active tab"
```

---

### Task 4: Content script — panel DOM, styling, and context capture

**Files:**
- Modify: `apps/extension/content.css`
- Modify: `apps/extension/content.js`

**Interfaces:**
- Consumes: `{ type: "toggle" }` message from background.js
- Produces:
  - `showPanel()` — injects panel into page DOM, fills context box, focuses input
  - `hidePanel()` — adds `.jarvis-hidden` class to panel
  - `getContext(): string` — returns selected text + title + URL, max 800 chars
  - `sendQuestion()` — POSTs to `/api/brain/ask`, renders answer (implemented in Task 5)
  - `playAnswer()` — POSTs to `/api/voice/speak`, plays MP3 (implemented in Task 5)

- [ ] **Step 1: Write content.css**

Overwrite `apps/extension/content.css` with:

```css
#jarvis-ext-panel {
  all: initial;
  position: fixed !important;
  bottom: 24px !important;
  right: 24px !important;
  width: 380px !important;
  background: #0a0a0a !important;
  border: 1px solid #00ff88 !important;
  border-radius: 4px !important;
  font-family: 'Courier New', Courier, monospace !important;
  font-size: 13px !important;
  color: #e0e0e0 !important;
  z-index: 2147483647 !important;
  box-shadow: 0 0 24px rgba(0,255,136,0.15) !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
}

#jarvis-ext-panel.jarvis-hidden {
  display: none !important;
}

#jarvis-ext-panel * {
  box-sizing: border-box;
  font-family: 'Courier New', Courier, monospace;
}

#jarvis-ext-panel .j-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #1a1a1a;
  color: #00ff88;
  font-size: 11px;
  letter-spacing: 0.15em;
}

#jarvis-ext-panel .j-close {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

#jarvis-ext-panel .j-close:hover { color: #00ff88; }

#jarvis-ext-panel .j-context {
  width: 100%;
  background: #111;
  border: none;
  border-bottom: 1px solid #1a1a1a;
  color: #666;
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  padding: 8px 12px;
  resize: none;
  height: 54px;
  outline: none;
}

#jarvis-ext-panel .j-context:focus { color: #999; }

#jarvis-ext-panel .j-input-row {
  display: flex;
  border-bottom: 1px solid #1a1a1a;
}

#jarvis-ext-panel .j-input {
  flex: 1;
  background: #0d0d0d;
  border: none;
  color: #e0e0e0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  padding: 10px 12px;
  outline: none;
}

#jarvis-ext-panel .j-input::placeholder { color: #333; }

#jarvis-ext-panel .j-send {
  background: none;
  border: none;
  border-left: 1px solid #1a1a1a;
  color: #00ff88;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 0 14px;
}

#jarvis-ext-panel .j-send:hover { background: #0d1a12; }
#jarvis-ext-panel .j-send:disabled { color: #333; cursor: default; }

#jarvis-ext-panel .j-answer {
  padding: 10px 12px;
  color: #ccc;
  font-size: 12px;
  line-height: 1.6;
  min-height: 40px;
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

#jarvis-ext-panel .j-answer.j-thinking { color: #444; }

#jarvis-ext-panel .j-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid #1a1a1a;
}

#jarvis-ext-panel .j-play {
  background: none;
  border: 1px solid #1a1a1a;
  border-radius: 3px;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}

#jarvis-ext-panel .j-play:hover { border-color: #00ff88; color: #00ff88; }

#jarvis-ext-panel .j-open {
  color: #00ff88;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-decoration: none;
  margin-left: auto;
}

#jarvis-ext-panel .j-open:hover { text-decoration: underline; }
```

- [ ] **Step 2: Write content.js**

Overwrite `apps/extension/content.js` with:

```js
const JARVIS = "http://localhost:8787";
const MAX_CTX = 800;

let panel = null;
let answerText = "";

function getContext() {
  const sel = (window.getSelection()?.toString() ?? "").trim();
  const title = (document.title ?? "").trim();
  const url = location.href;
  return [sel, title, url].filter(Boolean).join("\n").slice(0, MAX_CTX);
}

function buildPanel() {
  const el = document.createElement("div");
  el.id = "jarvis-ext-panel";
  el.className = "jarvis-hidden";
  el.innerHTML = `
    <div class="j-header">
      <span>JARVIS</span>
      <button class="j-close" title="Close (Esc)">✕</button>
    </div>
    <textarea class="j-context" rows="3" placeholder="Page context (editable)…"></textarea>
    <div class="j-input-row">
      <input class="j-input" type="text" placeholder="Ask Jarvis…" />
      <button class="j-send" disabled>SEND</button>
    </div>
    <div class="j-answer"></div>
    <div class="j-footer" style="display:none">
      <button class="j-play">🔊</button>
      <a class="j-open" href="${JARVIS}" target="_blank" rel="noopener">Open in Jarvis →</a>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector(".j-close").addEventListener("click", hidePanel);

  const input = el.querySelector(".j-input");
  const send = el.querySelector(".j-send");
  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !send.disabled) sendQuestion(); });
  send.addEventListener("click", sendQuestion);
  el.querySelector(".j-play").addEventListener("click", playAnswer);

  return el;
}

function showPanel() {
  if (!panel) panel = buildPanel();
  panel.classList.remove("jarvis-hidden");
  panel.querySelector(".j-context").value = getContext();
  panel.querySelector(".j-input").focus();
}

function hidePanel() {
  panel?.classList.add("jarvis-hidden");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hidePanel();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "toggle") return;
  if (!panel || panel.classList.contains("jarvis-hidden")) {
    showPanel();
  } else {
    hidePanel();
  }
});

async function sendQuestion() {
  const input = panel.querySelector(".j-input");
  const send = panel.querySelector(".j-send");
  const answerEl = panel.querySelector(".j-answer");
  const footer = panel.querySelector(".j-footer");
  const ctx = panel.querySelector(".j-context").value.trim();
  const question = input.value.trim();
  if (!question) return;

  send.disabled = true;
  answerEl.className = "j-answer j-thinking";
  answerEl.textContent = "Thinking…";
  footer.style.display = "none";
  answerText = "";

  try {
    const body = { question };
    if (ctx) body.clipboardContext = ctx;
    const res = await fetch(`${JARVIS}/api/brain/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Jarvis is offline — start it first.");
    const data = await res.json();
    answerEl.className = "j-answer";
    if (data.available && data.answer) {
      // Strip markdown bold/italic for clean display
      answerText = data.answer.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s/gm, "");
      answerEl.textContent = answerText;
      footer.style.display = "flex";
    } else {
      answerEl.textContent = data.hint ?? "No answer model available — check your API keys in Jarvis Settings.";
    }
  } catch (err) {
    answerEl.className = "j-answer";
    answerEl.textContent = String(err.message ?? "Jarvis is offline — start it first.");
  } finally {
    send.disabled = false;
  }
}

async function playAnswer() {
  if (!answerText) return;
  const playBtn = panel.querySelector(".j-play");
  playBtn.textContent = "⏳";
  playBtn.disabled = true;
  try {
    const res = await fetch(`${JARVIS}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: answerText, provider: "deepgram", model: "aura-2-odysseus-en" }),
    });
    if (!res.ok) throw new Error("speak failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  } catch {
    // silent — button resets
  } finally {
    playBtn.textContent = "🔊";
    playBtn.disabled = false;
  }
}
```

- [ ] **Step 3: Reload extension and test panel**

1. `chrome://extensions` → refresh Jarvis extension
2. Navigate to `https://example.com`
3. Press `Ctrl+Shift+J` — panel should appear bottom-right with page context pre-filled
4. Press `Ctrl+Shift+J` again — panel hides
5. Press `Escape` — panel hides
6. Select text on the page, press `Ctrl+Shift+J` — selected text appears in context box

- [ ] **Step 4: Commit**

```
git add apps/extension/content.js apps/extension/content.css
git commit -m "feat(extension): content script with floating panel, NC OS styling, context capture"
```

---

### Task 5: End-to-end verification — ask, voice, error states

**Files:**
- No code changes — this task verifies the full flow and fixes any issues found

- [ ] **Step 1: Restart Jarvis with the new CORS build**

Double-click `Start Jarvis.bat`. Wait for it to open in the browser.

- [ ] **Step 2: Test ask flow**

1. Press `Ctrl+Shift+J` on any webpage
2. Type: `what is this page about?`
3. Press Enter
4. Expected: "Thinking…" → answer appears within a few seconds
5. If CORS error appears in DevTools console (`Access-Control-Allow-Origin` missing):
   - Confirm Task 1 was completed and Jarvis was restarted after the API rebuild

- [ ] **Step 3: Test context injection**

1. Select a specific sentence on the page
2. Press `Ctrl+Shift+J`
3. Verify the selected text appears in the context box
4. Ask: `summarize what I selected`
5. Expected: Answer references the selected text

- [ ] **Step 4: Test voice playback**

1. After getting an answer, click 🔊
2. Expected: Jarvis speaks the answer
3. Button shows ⏳ while loading, returns to 🔊 when done

- [ ] **Step 5: Test offline state**

1. Close the Jarvis terminal window (stop the server)
2. Press `Ctrl+Shift+J` and ask something
3. Expected: Panel shows `"Jarvis is offline — start it first."`
4. Restart Jarvis

- [ ] **Step 6: Test on a CSP-restricted site (informational)**

1. Navigate to `https://accounts.google.com`
2. Press `Ctrl+Shift+J`
3. Note whether the panel appears or not — some Google subdomains block content scripts
4. This is expected behaviour, not a bug

- [ ] **Step 7: Commit any fixes found**

```
git add apps/extension/
git commit -m "fix(extension): e2e verification fixes"
```

---

### Task 6: README and wrap-up

**Files:**
- Create: `apps/extension/README.md`

- [ ] **Step 1: Write README**

Create `apps/extension/README.md`:

```markdown
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
- Voice defaults to Deepgram Odysseus (deep male). Change in Jarvis Settings → Voice.
```

- [ ] **Step 2: Final commit**

```
git add apps/extension/README.md
git commit -m "docs(extension): install and usage README"
```
