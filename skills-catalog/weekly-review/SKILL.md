---
name: weekly-review
description: >
  Run a real weekly review over the Obsidian vault: clear the Inbox to zero,
  sweep the week's daily notes, update every active project, surface orphan and
  stale notes, summarize the week, and set up the next one. Trigger whenever the
  user says: weekly review, review my week, do my weekly, clean up my brain/
  vault, Friday review, plan next week, or "what did I get done this week".
compatibility: >
  Operates on the Obsidian vault via the obsidian MCP server when connected, else
  OBSIDIAN_VAULT_PATH (Grep/Read/Edit/Write). Composes the task-manager skill for
  task moves. No API key.
---

# Weekly Review

The keystone hygiene ritual — adapted from GTD/PARA — that keeps the second brain
trustworthy. Walk the user through it interactively: do the mechanical work, ask
only where judgment is needed, propose a default for every decision.

## The review, step by step

### 1. Clear the Inbox to zero
For each note/snippet in `Inbox/`, decide and act:
- **Trash** (no longer useful) — confirm before deleting.
- **File** → move to `Notes/` (permanent) or attach to a project.
- **Task** → hand to task-manager (into a project or a daily note).
- **Project** → promote to `Projects/<name>.md`.
Process every item; the goal is an empty Inbox.

### 2. Sweep the week's daily notes
Read the last 7 days of `Daily/`:
- Migrate un-filed captures to their permanent home.
- Collect open `- [ ]` tasks: complete, carry forward to next week, or drop
  (with confirmation). Don't let tasks rot in old daily notes.

### 3. Review every active project
For each `Projects/*.md` with `status: active`:
- Confirm it's still active (else set `paused`/`done`).
- Ensure it has a clear **next action**. **Flag stalled projects** — active
  status but zero unchecked next actions — these are the silent killers.
- Append a one-line status to the project log.

### 4. Surface orphans and stale notes
- **Orphans:** notes with no `[[links]]` in or out — propose links or a MOC home
  for each, or archival.
- **Stale:** notes untouched for a long time that may need updating/archiving.
- Where a topic has grown several notes, propose a **Map of Content**.

### 5. Summarize the week
Write a review note `Weekly/YYYY-[W]ww.md` (create the `Weekly/` folder if
needed) containing:
- **Wins / shipped** — what actually got done.
- **Slipped** — what didn't, and why (honest, not punitive).
- **Themes** — patterns worth noticing.
- **Numbers** (if relevant/available) — pull a quick finance or client-SEO note.

### 6. Set up next week
- Top **3 priorities** for next week.
- Carry-forward tasks placed where they belong.
- Anything to schedule (hand to the calendar skill).

## Principles

- **Interactive but efficient:** propose the obvious action for each item; let the
  user override. Don't make them decide 50 things from scratch.
- **Confirm before bulk delete/complete/move.** Never mass-mutate silently.
- **Leave the vault better:** emptier Inbox, every project with a next action,
  fewer orphans, a written summary.

## Output

End with: Inbox count (→ 0), # projects reviewed (and any stalled), # tasks
carried forward, the path to the weekly note, and next week's top 3.

## What this does NOT do

- It does not delete or archive without confirmation.
- It does not invent wins or progress — it reflects what's actually in the vault.
