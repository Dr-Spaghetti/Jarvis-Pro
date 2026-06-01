---
name: meeting-notes
description: >
  Turn a meeting transcript or rough notes into a clean, structured note —
  summary, decisions, and action items — filed and linked in the vault, with
  action items turned into tasks. Trigger whenever the user says: take meeting
  notes, summarize this meeting/call/transcript, notes from my call, action items
  from this, recap this meeting, or pastes a transcript to process.
compatibility: >
  Works on pasted text/transcripts (no integration needed). Saves to the Obsidian
  vault (obsidian MCP or OBSIDIAN_VAULT_PATH) and composes task-manager to create
  action-item tasks. No API key.
---

# Meeting Notes

Capture the signal from a meeting so nothing important is lost in a wall of
transcript — and so the follow-through actually happens.

## Input

A transcript, recording summary, or rough notes (pasted or referenced). Identify
whether it's a **client** meeting (→ tie to `Projects/<client>`) or internal (→
the relevant project), and the date.

## Produce a structured note

```markdown
---
type: meeting
date: <YYYY-MM-DD>
attendees: [<names>]
project: <[[Projects/<name>]]>
tags: [meeting]
---

# Meeting — <topic> (<date>)

## Summary
<3–6 sentences: what it was about and where it landed.>

## Decisions
- <clear decisions made>

## Action items
- [ ] <action> — owner: <who> — due: <date if stated>

## Open questions / follow-ups
- <unresolved items>

## Notes
<other context worth keeping>
```

## Turn action items into tasks

For each action item, hand to **task-manager**: create `- [ ]` tasks in the
relevant `Projects/<name>.md` (or the owner's daily note), preserving owner and
due date. Confirm before creating a large batch.

## Save + link

Save the note to `Projects/<client>` (client meetings) or `Notes/`/the project
(internal); link it from the project. Report the path. If it's a client call,
offer to draft a follow-up email recap (hand to email-assistant — never send
without confirmation).

## Principles

- **Faithful and concise.** Summarize what was actually said; don't invent
  decisions or commitments. Flag anything ambiguous as an open question.
- **Bias to follow-through:** every commitment becomes a tracked task.

## What this does NOT do

- It does not fabricate attendees, decisions, or action items.
- It does not send recaps or create many tasks without confirmation.
