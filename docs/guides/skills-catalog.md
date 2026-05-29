# Skills Catalog

Octogent ships with a **bundled skills catalog** — a library of ready-to-use
[Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills) that
every tentacle agent can use. The catalog lives in
[`skills-catalog/`](../../skills-catalog) and is sourced from
[reymerekar7/rm-skills](https://github.com/reymerekar7/rm-skills).

## How it works

There are two ways a skill becomes available to agents:

1. **Bundled (always on, zero footprint).** Catalog skills are read directly
   from where Octogent ships them. They appear in the dashboard's skill picker
   tagged `bundled` and can be attached to any tentacle as a *suggested skill* —
   **without copying anything into your repository**. This is the default and
   needs no setup.

2. **Installed (opt-in, per project).** Running `octogent skills install` copies
   a skill into the project's `.claude/skills/` directory. Do this when you want
   plain Claude Code (outside Octogent) to discover the skill too. Installed
   skills are tagged `project` and take precedence over the bundled copy of the
   same name.

Because the bundled catalog is read in place, running Octogent in any repository
never litters that repository with skill files unless you explicitly ask.

## Bundled skills

| Skill | What it does | Needs |
|-------|--------------|-------|
| `gmail-triage` | Read-only Gmail inbox triage | Google Workspace CLI |
| `infographic-generator` | Build infographic PNGs from a topic | Node + Playwright |
| `linkedin-asset-analyzer` | Analyze LinkedIn carousels/infographics | — |
| `twitter-reader` | Fetch tweet content by URL | `JINA_API_KEY` |
| `video-performance-analyzer` | Transcript + performance analysis of short-form video | `GEMINI_API_KEY` |
| `x-scanner` | Scan X/Twitter for AI news | `XAI_API_KEY` |

The machine-readable manifest (required env vars, runtimes, setup hints) lives in
[`skills-catalog/catalog.json`](../../skills-catalog/catalog.json).

## CLI

```bash
# List bundled + installed skills (and which API keys are missing)
octogent skills list

# Copy one bundled skill into this project's .claude/skills/
octogent skills install --skill video-performance-analyzer

# Copy all bundled skills
octogent skills install --all

# Overwrite an already-installed skill
octogent skills install --skill video-performance-analyzer --force

# Show which bundled skills have their API keys set
octogent skills status

# Diagnose prerequisites (keys, runtimes, per-skill setup commands)
octogent skills doctor
```

## API keys

Bundled skills that call external APIs read their keys from the process
environment. Put them in a `.env` file at your project root (see
[`.env.example`](../../.env.example)); Octogent loads it at startup and forwards
every variable to the agents it spawns through the PTY environment. A single
keystore therefore powers every tentacle.

Existing environment variables are never overwritten by `.env`.

## Attaching skills to a tentacle

In the dashboard, the **New Tentacle** form and each tentacle's skill editor list
all available skills. Bundled skills show a `bundled` badge; skills whose required
API key is unset show a "Needs `KEY` in .env" warning. Selected skills are written
into the tentacle's `CONTEXT.md` under a managed *Suggested Skills* block, so the
agent working that tentacle knows it can use them.
