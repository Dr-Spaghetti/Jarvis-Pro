---
name: skill-creator
description: >
  Create a new, high-quality bundled skill for this tool from a plain-English
  description — scaffolding the SKILL.md and catalog entry to the house standard
  and verifying it before commit. Trigger whenever the user says: create a skill,
  make a new skill, add a capability, "I want a skill that …", build me a skill,
  or scaffold a skill.
compatibility: >
  Works on this repo's skills catalog at `skills-catalog/`. Uses the repo's
  scripts (normalize-eol, build-package) and the test/lint gate. No API key.
---

# Skill Creator

The meta-skill: turn an idea into a real, effective bundled skill that can't break
the tool. Hold the quality bar — a skill is only worth adding if it's genuinely
capable.

## 1. Interview (gather before writing)

Ask only what you can't infer:
- **Name** — kebab-case, lowercase (e.g. `meeting-notes`). The **folder name MUST
  equal this name** (the integrity test enforces it).
- **Purpose** — one sentence: what it does and the outcome.
- **Triggers** — the concrete phrases a user would say. Be generous and specific;
  triggering is everything.
- **Tools/connectors** — built-in (WebSearch/Read/Write), an MCP server (name it),
  and/or the Obsidian vault.
- **Inputs/outputs**, **safety constraints** (anything destructive or that
  sends/posts), and any **required env keys** or **runtime deps** (python/node).

## 2. Write `skills-catalog/<name>/SKILL.md`

Follow the house format exactly:

```markdown
---
name: <kebab-name>            # must equal the folder name
description: >
  <what it does> Trigger whenever the user says: <many concrete phrases>.
compatibility: >
  <which MCP/built-in tools it uses; graceful fallback; whether an API key or
  setup is needed>
---

# <Title>

## <What it does / method / workflow>   (numbered, concrete steps)
## Principles
## Safety            (confirm-before-destructive; cite real data; report writes)
## What this does NOT do
```

Quality rules to apply every time:
- **Integration-aware + graceful:** prefer an MCP server when connected, fall back
  to the filesystem/built-ins, and degrade clearly when nothing is available
  (never hard-fail).
- **Second-brain tie-in** where relevant: read context from and save results to
  the Obsidian vault, and report the exact path written.
- **Safe by default:** never delete/overwrite/send/post without explicit
  confirmation. Use only real data; never fabricate.
- **Substance over fluff:** real workflows and judgment, not a thin wrapper. If
  you can't make it genuinely useful, say so rather than ship a stub.

## 3. Register it in `skills-catalog/catalog.json`

Add an entry keyed by the **name** (= folder):
```json
"<name>": { "requiredEnv": [<keys>], "runtime": [<"python"|"node">], "setup": "<one-line setup or 'No API key.'>" }
```

## 4. Verify (the gate that keeps the tool unbreakable)

Run, from the repo root, and fix anything that fails before committing:
```bash
node scripts/normalize-eol.mjs
node scripts/build-package.mjs
node bin/octogent skills list      # the new skill appears, described correctly
corepack pnpm lint                 # clean (biome check --write for JSON/format nits)
corepack pnpm -r --workspace-concurrency=1 test   # full suite green (incl. catalog integrity)
```
The catalog-integrity test will reject a malformed entry, a folder/name mismatch,
or an unloadable SKILL.md — so a broken skill never reaches a working state.

## 5. Commit

`git add -A && git commit` with a message describing the skill and noting the
suite is green.

## What this does NOT do

- It does not skip verification — a skill isn't "done" until lint + tests pass.
- It does not ship stubs or half-capabilities; depth is the point.
- It does not modify app code (apps/*, packages/*) — skills are additive data.
