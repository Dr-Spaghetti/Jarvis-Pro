# Jarvis

Personal OS for running AI on your own machine: ask questions against your notes, analyze content (including email links), and deploy real Claude Code agents when you actually need a worker.

The runtime underneath is [Octogent](https://github.com/hesamsheikh/octogent) (PTY terminals, tentacles, local API). This repo is **Jarvis** — the HUD and the assistant layer on top of that engine. Credits: [CREDITS.md](CREDITS.md).

## What works today

| Tab | What it does |
|-----|----------------|
| **Jarvis HQ** | Ask Jarvis (text + optional voice) plus a Today stack: capture notes/tasks/memory, open vault tasks, and live tiles. |
| **Agent Arsenal** | Deploy a real Claude Code session. “Brainstorm” is an in-API loop — it does **not** spawn a terminal. |
| **Surveillance** | Live view of running terminals. |
| **Workflows** | Multi-step Ask Jarvis checklists, not Zapier. |
| **Recent Convos** | Session history. |
| **Content Analyzer** | Files, URLs, and AgentMail **links and images**. |
| **Ideas** | Scratchpad into the vault. |
| **Settings** | Assistant health, voice, Gmail, email ingest, morning brief, remote token. Arsenal / Surveillance / Terminal sit under Engine in the nav. |
| **Terminal** | Launch Claude or Codex. Close **stops** the process. |

Start with **Ask**, **Analyze**, or **Deploy**. Everything else is supporting.

Skills under `skills-catalog/` are instruction packs for a spawned Claude Code session (often needing MCP connectors). They are **not** one-click product buttons.

## Run it

Windows: double-click `Start Jarvis.bat`.

Or:

```bash
corepack pnpm install
corepack pnpm build
node bin/octogent
```

Dev (API + Vite):

```bash
corepack pnpm dev
```

Then open `http://127.0.0.1:8787`. Use Chrome or Edge for voice. Full setup: [GETTING-STARTED.md](GETTING-STARTED.md).

Copy `.env.example` to `.env`. Do not put a space after `=`. Recommended keys: `ANTHROPIC_API_KEY`, `OBSIDIAN_VAULT_PATH`, `DEEPGRAM_API_KEY` (voice), `AGENTMAIL_API_KEY` + `AGENTMAIL_INBOX` (email ingest).

If you expose Jarvis beyond this machine, set a long random `OCTOGENT_AUTH_TOKEN` and read [docs/remote-access.md](docs/remote-access.md). Loopback-only is the default.

## Docs

- [Getting started](GETTING-STARTED.md)
- [Mental model](docs/concepts/mental-model.md)
- [Runtime and API](docs/concepts/runtime-and-api.md)
- [CLI](docs/reference/cli.md)

## License

MIT. Upstream Octogent and rm-skills are also MIT — see [CREDITS.md](CREDITS.md).
