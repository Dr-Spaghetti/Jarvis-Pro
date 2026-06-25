# Getting Started with Jarvis

Welcome — this is **Jarvis**, a private personal-assistant / "operating system" app. It runs
on your own computer: a black-and-gold dashboard with an AI brain, voice control, an agent
workforce, and a library of work skills. This guide gets you from a zip file to a running app.

> Two docs, two audiences:
> - **This file (`GETTING-STARTED.md`)** — plain-English setup, start here.
> - **`HANDOFF.md`** — deeper technical reference (architecture, gotchas) for developers.

---

## What you need first (one-time installs)

1. **Node.js (version 20 or newer)** — the runtime the app is built on.
   Download: https://nodejs.org (get the "LTS" version, run the installer).
2. **pnpm** — the package manager. After Node is installed, open a terminal (PowerShell on
   Windows / Terminal on Mac) and run: `corepack enable` (this turns on pnpm; it ships with Node).
3. **(Optional) Ollama** — only if you want the free *local* AI models. Download from
   https://ollama.com . Skip it if you'll use cloud AI (Claude/Perplexity) instead.

---

## Step 1 — Unzip
Unzip the folder somewhere simple, e.g. your Desktop or Documents. You'll get a folder with
`apps/`, `package.json`, `bin/`, etc.

## Step 2 — Install the app's dependencies
Open a terminal **inside the unzipped folder**, then run:
```
corepack pnpm install
```
This downloads the libraries the app needs (creates a `node_modules` folder). Takes a couple
minutes the first time.

## Step 3 — Add your own keys (`.env`)
The app reads its secrets from a file called `.env`. The zip ships with a template named
**`.env.example`** — copy it to `.env` and fill in your own keys:
```
copy .env.example .env        (Windows)
cp .env.example .env          (Mac/Linux)
```
Then open `.env` in a text editor and paste in the keys you have. **No key here is shared from
the original owner — you supply your own.** What each does:

| Key | What it powers | Required? |
|-----|----------------|-----------|
| `OBSIDIAN_VAULT_PATH` | The "brain" — points to a folder of notes (an Obsidian vault) | Recommended |
| `ANTHROPIC_API_KEY` | Claude — the main answer engine (get one at console.anthropic.com) | Recommended |
| `PERPLEXITY_API_KEY` | Real-time web search with citations (perplexity.ai → API) | Optional |
| `DEEPGRAM_API_KEY` | Voice: speech-to-text + natural text-to-speech (deepgram.com) | Optional (voice) |
| `OPENAI_API_KEY` | Alternate transcription/voice | Optional |
| `GMAIL_*` | Email skills (set up via the in-app "Connect Gmail" button) | Optional |
| `OCTOGENT_API_PORT` | Which port it runs on (default `8787`) | Optional |
| `OCTOGENT_AUTH_TOKEN` | Password for remote/phone access (only if exposing it) | Optional |

Tip: avoid putting a space right after the `=` sign — that quietly breaks keys.

## Step 4 — Build it
```
corepack pnpm --filter @octogent/web build
corepack pnpm --filter @octogent/web exec vite build --config vite.api.bundle.config.mts
node scripts/build-package.mjs
```
(These compile the web UI + server and stage them so the app can serve them.)

## Step 5 — Run it
```
node bin/octogent
```
A browser tab opens automatically at `http://127.0.0.1:8787`. Use **Chrome or Edge** if you
want the voice features (they need the browser's speech engine).

On Windows you can also just double-click **`Start Jarvis.bat`** instead of Step 5.

---

## What you get
A 9-page dashboard (press keys 1–9 to navigate):
- **Jarvis** — ask questions, voice, quick-capture, live tiles
- **Agents / Deck** — deploy AI agents from an arsenal; run skills
- **Monitor** — live surveillance of running agents
- **Activity / Conversations / Prompts / Code Intel / Settings**

## If something doesn't work
- **A change/feature isn't showing** → fully quit and relaunch (`Ctrl+C` in the terminal,
  then `node bin/octogent` again). The server loads once at startup.
- **AI answers fail** → check the matching key in `.env` (and that the account has credit).
- **Voice doesn't work** → use Chrome/Edge, allow the microphone when prompted, and set a
  `DEEPGRAM_API_KEY`.
- Deeper troubleshooting + architecture: see **`HANDOFF.md`**.

That's it — install, add your keys, build, run.
