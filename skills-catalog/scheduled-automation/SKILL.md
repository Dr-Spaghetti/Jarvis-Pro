---
name: scheduled-automation
description: >
  Set up, list, and remove scheduled runs of other skills so routines happen
  automatically — e.g. the daily brief each morning, rank-drop alerts, or the
  Friday weekly review. Trigger whenever the user says: schedule X, run [skill]
  every morning/day/week, automate this, set up a recurring task, remind me
  weekly, or "make the daily brief run on its own".
compatibility: >
  On Windows, schedules headless runs via Task Scheduler (`schtasks`) invoking
  `claude -p "<prompt>"` in the project directory. Requires the `claude` CLI on
  PATH. Unattended runs only have access to whatever MCP/tools are pre-authorized.
---

# Scheduled Automation

Turn skills into routines that run *to* the user, not *by* them. The mechanism on
this machine is Windows Task Scheduler launching Claude Code headlessly.

## Core pattern

A scheduled job runs a single headless Claude prompt in the repo, which triggers
the target skill and writes its output to the vault:

```bat
schtasks /create /tn "Octogent Daily Brief" /sc daily /st 07:00 ^
  /tr "cmd /c cd /d C:\Users\nicks\octogent-skills && claude -p \"Run my daily brief\" >> .octogent\automation.log 2>&1"
```

- `/sc` = `daily` | `weekly` (+ `/d FRI`) | `hourly`; `/st HH:MM` start time.
- `/tn` = a clear task name so it's easy to find/remove.
- Use the **skill's natural trigger phrase** as the prompt so the right skill
  fires (e.g. "Run my daily brief", "Run my weekly review", "Check client review
  alerts").

## Manage jobs

- **List:** `schtasks /query /tn "Octogent*" /v /fo LIST`
- **Run now (test):** `schtasks /run /tn "Octogent Daily Brief"`
- **Remove:** `schtasks /delete /tn "Octogent Daily Brief" /f`

Always show the user the exact command, confirm the schedule/time, then create
it. Keep a record of created jobs (append to `Projects/Automations.md` in the
vault) so they're discoverable later.

## Safe-by-default for unattended runs

Unattended automation must not take irreversible actions with no human in the
loop. Restrict scheduled jobs to **gather / draft / report** scope:

- ✅ Good for automation: daily-brief, weekly-review summary, rank-drop alerts,
  finance snapshots, "draft" outputs left in the vault for review.
- ⛔ Do **not** schedule actions that send email, post review replies, create
  calendar events, or run new paid scans **unattended** — those keep their
  "explicit confirmation" rule and should run interactively.
- Headless Claude only has the tools/permissions it's been granted; if a job
  needs a tool that prompts for approval, it will stall. Prefer prompts that use
  already-authorized, read-only capabilities, and write results to the vault.

## Verify a new job

After creating, run it once (`schtasks /run`), then confirm the expected note/log
was written to the vault. Report the job name, schedule, and where output lands.

## What this does NOT do

- It does not schedule send/post/payment actions to run unattended.
- It does not create jobs without confirming the command and time.
- It is Windows-specific here; on macOS/Linux the equivalent is cron/launchd
  (offer that if the environment differs).
