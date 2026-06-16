# Jarvis (octogent-skills) — Project Handoff

> Handoff doc for a new agent (Codex) taking over development. Read this top-to-bottom first, then `REVIEW_LOG.md`, then the roadmap plan file (path below). Verify every claim against the live code before acting — this doc is a point-in-time snapshot (2026-06-16).

---

## 1. What this project is

**"Jarvis"** — Nick's private personal-OS / assistant, built on top of the **Octogent** agent console + the **rm-skills** library, merged into one tool. It runs locally on Nick's Windows machine.

Core pieces:
- **The Brain** — Nick's Obsidian vault (`OBSIDIAN_VAULT_PATH`), searchable by keyword + semantic (Ollama embeddings), with an "Ask Jarvis" Q&A layer.
- **Voice** — wake word → transcribe → answer/act → speak, hands-free. STT + TTS via Deepgram; answers via Claude Haiku (CLI) + OpenAI web search, with local Ollama fallback.
- **Agents/Deck** — spawn Claude Code agents (PTY terminals) that run the ~30 bundled skills.
- **9-page black/gold HUD UI**: `[9] JARVIS [1] AGENTS [2] DECK [3] ACTIVITY [4] CODE INTEL [5] MONITOR [6] CONVERSATIONS [7] PROMPTS [8] SETTINGS`.
- Telemetry/analytics, monitor alerting, morning-brief scheduler, live home tiles, remote access (bearer-token + Cloudflare Tunnel).

**Owner profile:** Nick (nick@justifylocal.com), runs a local-SEO/business agency. Non-technical — **give him simple, click-by-click GUI steps, never assume terminal fluency.** He wants the tool to "just work" and do general + specific + task work accurately.

---

## 2. Architecture & the rules that bite

Monorepo (pnpm, Node + TypeScript): `apps/api` (HTTP/WS server + PTY), `apps/web` (Vite/React), `packages/core` (shared types). Biome lint, Vitest tests.

### ⚠️ Build/serve model — THE #1 source of "my change didn't show up"
- `node bin/octogent` runs **`dist/api/cli.js`** and serves the web UI from **`dist/web`** (static files).
- A plain `pnpm --filter @octogent/web build` only updates `apps/web/dist` — **NOT** `dist/web`. You MUST run `node scripts/build-package.mjs` to copy `apps/web/dist → dist/web`.
- API/server changes need the API bundle rebuilt: `corepack pnpm --filter @octogent/web exec vite build --config vite.api.bundle.config.mts` (writes `dist/api`).
- The root `pnpm build` chains these but calls **bare `pnpm`** which often isn't on PATH → use `corepack pnpm` for each step instead.
- **Web is served per-request** (page reload picks up new `dist/web`). **The API loads `dist/api/cli.js` into memory once at process start** — so after a server change you must **kill & relaunch the octogent process**, not just refresh the tab. Classic trap: new button visible (web reloaded) but feature dead (API still old). The Voice panel shows a live **"Brain:"** readout to confirm the API build.

### ⚠️ MCP connector isolation (shapes the whole roadmap)
The Node API server **cannot reach Nick's MCP connectors** (QuickBooks/Apollo/Local Falcon/Airtable/etc.) — those live only inside the `claude` CLI runtime. The API can reach a vendor only via a **direct REST API key in `.env`** (Gmail OAuth in `apps/api/src/gmail/gmailAuth.ts` is the working template) **or** by shelling out to the `claude` CLI (which has the connectors, but headless connector auth is unproven — see roadmap Wave 11).

### Other gotchas
- **`.env` paste bug:** keys pasted via Notepad often get a leading space after `=`, causing silent auth failures. Always verify (`Select-String ... -Pattern "^KEY=\s"`).
- **Port:** API runs on **8787** (`OCTOGENT_API_PORT=8787` pinned in `.env`). Gmail OAuth redirect uses `http://127.0.0.1:8787/api/gmail/callback`.
- **Windows path guards** need `\\` as well as `/` and `..`.

---

## 3. The verification gate (run after EVERY change)
```
corepack pnpm -r --workspace-concurrency=1 test     # all suites (api ~275, web ~189, core)
corepack pnpm lint                                   # biome, must be clean
corepack pnpm --filter @octogent/web build           # web typecheck + build
corepack pnpm --filter @octogent/web exec vite build --config vite.api.bundle.config.mts   # api bundle (if server changed)
node scripts/build-package.mjs                        # deploy to dist/web (REQUIRED for UI changes to show)
```
Biome is strict: it rejects bare `role="dialog|status|group"` (use `<dialog>`/`<output>`/`<fieldset>`), enforces import order (run `biome check --write <file>` to auto-fix), and bans raw `fetch(` in `apps/web/src` outside `apiClient.ts` (all web calls go through `apiFetch`).

**Discipline used so far:** small increments, full gate per increment, commit per green increment, then an adversarial self-review appended to `REVIEW_LOG.md`. Keep it.

---

## 4. Current state (git `main`, snapshot 2026-06-16)

**Shipped (recent commits, newest first):**
- `57ecea3` voice: hard timeouts on every brain call + visible "Brain" readiness readout
- `6fdfd6e` voice: teach-and-it-sticks learning loop (spoken corrections obeyed)
- `51dd2fa` voice: OpenAI web-search answer path
- `b374a5a` voice: never-silent answers, hands-free re-arm, conversation transcript
- `377cf0b` voice: push-to-talk button + reliability hardening
- `35eb8c7` replace Ollama ask with **Claude Haiku + web search**; instant voice ack
- `21f49d2`,`1340283`,`8424c5c` **Wave 9** — voice `run-skill` intent + `POST /api/skills/run` + Deck "Run" button + server-side sensitive-skill approval gate
- `8f789be` model picker; `69ab251` general-question answers; `7f8031e`/`2ba4455`/`60e3971`/`5c34e3d` voice fixes
- Waves 1–8 + hardening + Gmail OAuth all shipped earlier (see `REVIEW_LOG.md` and the plan file).

**⚠️ Uncommitted working-tree changes right now** (decide whether to keep/commit/discard before building on top): `apps/api/src/createApiServer/brainRoutes.ts`, `apps/web/src/components/JarvisHomePrimaryView.tsx`, and `.env` (untracked/local — never commit `.env`). Run `git diff` to assess; they appear to be in-progress voice/brain tweaks.

**Environment / credentials (in `.env`, do NOT print values):**
- ✅ `OBSIDIAN_VAULT_PATH`, `OCTOGENT_API_PORT=8787`
- ✅ Gmail OAuth live (`GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/USER_EMAIL`)
- ✅ `DEEPGRAM_API_KEY` (STT + TTS, ~$200 credit, WORKS) ; `PIPER_BIN`/`PIPER_MODEL` (free local TTS)
- ✅ `OLLAMA_CHAT_MODEL=qwen3.6:latest` (default). Installed chat models: qwen3.6, gemma3:12b, phi4, deepseek-r1, llama3.1, qwen2.5-coder, hermes3, openchat, qwen2.5 (+ nomic-embed-text for embeddings).
- ⚠️ `OPENAI_API_KEY` set but **out of quota (429)** — used only for web-search path; expect failures.
- ⚠️ `ELEVENLABS_API_KEY` set but **free plan blocks library voices (402)**.
- ❌ No `APOLLO_API_KEY` / `LOCALFALCON_API_KEY` (Nick uses those as MCP connectors, not REST keys) → their dashboard tiles correctly show "not configured".
- **Claude** is used via the `claude` CLI (Nick's `claude login` plan), not an API key.

---

## 5. Roadmap (approved, not yet built) — Waves 10–12
Full detail in **`C:\Users\nicks\.claude\plans\wdym-by-that-crystalline-pine.md`** (the plan of record). Summary:
- **Wave 10 — Claude answer model** in the Answer-model dropdown via `claude -p` print mode (uses Nick's plan, no API key). *Note: much of the brain may already route to Claude Haiku per commit `35eb8c7` — verify what's done vs. remaining.*
- **Wave 11 — Agentic Ask Jarvis** (live data + reasoning). **Start with a spike:** can headless `claude -p` reach Nick's MCP connectors? If yes → route data/hard questions through it. If no → direct vendor REST keys for services Nick can get keys for. Never fabricate data.
- **Wave 12 — Tiles + money engine.** Apollo/Local Falcon tiles need direct API keys (or deliver via Wave 11 on-demand). Operational: run `review-repair-outreach` against the Tampa/USF list — **approval-gated, email-only** (Nick's standing rule).

Quality bar (verbatim): no fake buttons/data, empty+loading+error states everywhere, black/gold HUD + 1–9 nav preserved, UI text says "Agents" but code identifiers stay `tentacle*`.

---

## 6. Key files map
- Voice intent classifier: `apps/api/src/voiceIntent.ts` (+ tests `apps/api/tests/voiceIntent.test.ts`)
- Voice routes (STT/TTS/intent): `apps/api/src/createApiServer/voiceRoutes.ts`
- Brain (RAG/ask/journal/memory/digest/tiles models): `apps/api/src/createApiServer/brainRoutes.ts`
- Local model calls: `apps/api/src/createApiServer/ollamaChat.ts`, `ollamaEmbed.ts`
- Skill run: `apps/api/src/createApiServer/` skills-run route + `claudeSkills.ts`, `skillsCatalog.ts`
- Agent/PTY runtime: `apps/api/src/terminalRuntime.ts`, `terminalRuntime/sessionRuntime.ts`
- Auth/CORS: `apps/api/src/createApiServer/security.ts`, `requestHandler.ts`, `upgradeHandler.ts`, `authRoutes.ts`
- Web home (voice + ask UI): `apps/web/src/components/JarvisHomePrimaryView.tsx`
- Web API client (token + apiFetch): `apps/web/src/runtime/apiClient.ts`, endpoint builders `runtime/runtimeEndpoints.ts`
- Skills catalog: `skills-catalog/*/SKILL.md` + `skills-catalog/catalog.json`
- Launchers: `Start Jarvis.bat`, `Start Jarvis (Remote).bat`; remote guide `docs/remote-access.md`

---

## 7. How to run it
1. Set `.env` (already populated). 2. Build per §2/§3. 3. Double-click `Start Jarvis.bat` (or `node bin/octogent`) — opens browser on `127.0.0.1:8787`. 4. Use Chrome/Edge for voice (needs the browser speech engine; Edge confirmed working).
