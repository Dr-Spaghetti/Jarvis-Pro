---
name: task-manager
description: >
  Manage tasks and projects inside the Obsidian vault: capture todos, track
  project status and next actions, list and prioritize open work, and mark items
  done. Trigger whenever the user says: "add a task", "remind me to", "what
  should I work on", "what's on my plate", "my todos / next actions", "track this
  project", "project status", "mark X done", "show open tasks", or "plan my
  work".
compatibility: >
  Operates on Markdown checkboxes in the vault. Uses the obsidian MCP server when
  connected, else OBSIDIAN_VAULT_PATH via Grep (find `- [ ]`), Read, and Edit.
  No API key required. Pairs with the vault's daily template and
  Projects/_Project Template.
---

# Task & Project Manager

A lightweight GTD layer over the vault. Tasks live where they belong and stay
greppable, so the brain always knows what's open.

## Where tasks live

- **Fleeting / today:** the `## Tasks` section of today's `Daily/YYYY-MM-DD.md`.
- **Project-scoped:** the `## Next Actions` section of `Projects/<name>.md`.
- All tasks are Markdown checkboxes: `- [ ]` open, `- [x]` done. Optional inline
  metadata the user may use: due dates (`📅 2026-06-01` or `due:2026-06-01`),
  priority (`!!`), and `#tags`.

## Capabilities

### Capture a task
- Decide destination: a specific project (if named/implied) → that project's Next
  Actions; otherwise today's daily note.
- Append `- [ ] <task> <optional 📅 due / #tag>`. Confirm where it landed.

### List / aggregate open tasks
- Search the whole vault for `- [ ]` (MCP search or Grep).
- Group by project (and surface loose daily-note tasks). Show counts.
- Highlight anything overdue or due soon based on inline dates.

### "What should I work on?"
- Rank by: overdue/today due dates → explicit priority → active project status →
  age. Present a focused **top 3–5**, not the whole list.
- Offer to time-block them (hand off to the calendar skill if present).

### Mark done / update
- Flip the specific `- [ ]` to `- [x]` by editing that one line. Never bulk-close
  without explicit confirmation ("close all of these?").

### Projects
- Create a project from `Projects/_Project Template.md` (status, goal, next
  actions, log, links). If the template is missing, create the note with the same
  structure.
- Update status (`active` / `paused` / `done`), append to the project log, and
  keep Next Actions current.
- For project status requests: summarize goal, open next actions, recent log, and
  what's blocking.

## Principles

- **Edit precisely:** change single lines; preserve surrounding content and
  frontmatter.
- **Never mass-delete or mass-complete** without confirmation.
- **Match the user's existing scheme** if their vault already uses a tasks plugin
  syntax — detect by reading a few notes before writing.
- **Report** exactly which file/section you changed.

## What this does NOT do

- It does not delete tasks or notes without explicit confirmation.
- It does not invent due dates or project facts.
- It does not require any external task app — the vault is the source of truth.
