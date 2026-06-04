---
name: daily-brief
description: >
  Produce a single morning briefing that orients the whole day: today's
  schedule, emails needing a response, top tasks, and watch items (finance /
  client SEO) — written into today's daily note. Trigger whenever the user says:
  good morning, daily brief, brief me, what's my day, start my day, morning
  briefing, what's on my plate today, or "catch me up".
compatibility: >
  An orchestrator: it composes the calendar, email-assistant, task-manager,
  finance-snapshot, and local-falcon-seo skills and reads the Obsidian vault.
  Every source is optional — it uses whatever connectors are available
  (`claude mcp list`) and gracefully skips the rest. No API key of its own.
---

# Daily Brief

One command, one clear picture of the day. Pull from each available source, keep
it tight, and write it where the day lives — today's daily note.

## Memory & journal (Jarvis shared protocol)

- **Read memory first:** check `Jarvis/Memory.md` (durable facts/preferences about
  Nick) alongside `Profile.md`, so the brief reflects lasting context. Skip silently
  if it doesn't exist yet.
- **Log the outcome when done:** append one line to `Journal/Activity Log.md`
  (create it with a `# Jarvis Activity Log` header if missing), in this exact format
  so the home Activity panel can parse it:
  `- [<ISO-8601 timestamp>] [ok|warn|error] (daily-brief) <what you did> — <short detail>`
- **Remember durable facts:** if you learn a lasting fact worth keeping (not daily
  noise), append it as a `- ` bullet under `## Facts` in `Jarvis/Memory.md`.

## Gather (use what's connected; skip what isn't)

First, read `Profile.md` (if present) for the user's current priorities and
goals — the brief should reflect what matters to *them*, including personal,
freelance, and financial goals, not just work.

1. **Schedule** — via the calendar skill/connector: today's events in order,
   flag conflicts and back-to-backs, note anything needing prep.
2. **Needs response** — via the email skill/connector: unread/important email
   awaiting a reply (summarize each in a line; don't dump the inbox).
3. **Tasks** — via task-manager: open tasks due today or overdue, plus the top
   priorities pulled from `Projects/` and recent daily notes.
4. **Watch items** (only if quick + connected):
   - **Finance** — any notably overdue AR / cash flag (finance-snapshot).
   - **Client SEO** — recent rank regressions worth knowing (local-falcon-seo),
     if the user tracks clients there.
5. **Recent context** — scan the Inbox and the last 1–2 daily notes for loose
   ends to carry forward.

Keep each source to the essentials. If a source isn't available, omit its
section silently (don't pad the brief with "not connected" noise — mention gaps
once at the end if useful).

## Write the brief

Append to today's `Daily/YYYY-MM-DD.md` (create it from `_Daily Template` if
missing) under a `## Brief` heading, and also show it in chat. Structure:

```markdown
## Brief — <weekday, date>

**Focus today:** <the 1–3 things that matter most>

### Schedule
- <time> — <event> (prep: …)

### Needs response
- <person/subject> — <one-line ask>

### Tasks
- [ ] <due/overdue or top-priority task>

### Watch
- <finance or SEO flag, if any>
```

End with a single suggested **first move** for the day.

## Principles

- **Synthesize, don't dump.** The value is prioritization — surface the few
  things that matter, not everything.
- **Read-only gather.** Don't send email, create events, or close tasks while
  briefing; offer to act afterward (handing to the relevant skill, with
  confirmation).
- **Honest about gaps.** If email/calendar isn't connected, say so once so the
  user knows the brief is partial.

## Great as a routine

This skill is ideal to run automatically each morning. The user can schedule it
(e.g. a cron/scheduled agent) so the brief is waiting in the daily note when they
start.
