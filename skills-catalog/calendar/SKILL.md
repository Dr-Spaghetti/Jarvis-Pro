---
name: calendar
description: >
  Plan and manage your schedule: check availability, find meeting times, create
  and summarize events, and prep for the day or week. Trigger whenever the user
  asks to: check my calendar, what's on today/this week, am I free at …, schedule
  a meeting, block time, find a time with someone, or "prep me for my day". Also
  trigger on phrases like "add to my calendar", "when am I free", "my agenda", or
  "set up a meeting".
compatibility: >
  Reading/creating events uses a connected calendar MCP server in Claude Code
  (e.g. a Google Calendar connector), which must be authenticated. With no
  calendar integration, it still helps plan, draft agendas, and propose times
  for you to add manually. Check `claude mcp list` for a connected calendar
  server first.
---

# Calendar

Be a real scheduling assistant — but **never create, move, or delete events
without explicit confirmation.**

## Capabilities by integration state

1. **Calendar MCP connected & authenticated:** read the schedule, check
   availability, find open slots, and — after confirmation — create/update
   events and invites.
2. **No calendar integration:** still useful for **planning** — draft agendas,
   propose time blocks, build a day/week plan, and write meeting briefs. Tell the
   user they can connect a calendar connector to enable live read/write.

Detect which state you are in before claiming to read or change the calendar.

## Common workflows

- **Day/week prep:** summarize upcoming events, flag conflicts and back-to-backs,
  list what needs preparation, and suggest focus blocks for open time.
- **Find a time:** given constraints (duration, participants, window, working
  hours), propose 2–3 concrete slots. With integration, check real availability;
  without it, ask for the user's known commitments.
- **Schedule an event:** confirm title, time, duration, attendees, location/link,
  and notes → show the final event → only then create it (integration required).
- **Time-blocking:** turn a task list into a realistic blocked-out day.

## Confirmation protocol (writes)

1. Present the exact event (title, date/time, duration, attendees, location).
2. Wait for explicit "yes / create it".
3. Only then call the create/update tool. Never schedule speculatively or invite
   people without confirmation.

## Second-brain tie-in

- Pull prep material from the vault (e.g. the relevant `Projects/` note) into a
  meeting brief.
- After meetings, offer to capture notes/decisions into the vault and link them
  to the project.

## What this does NOT do

- It does not create, move, or cancel events without explicit confirmation.
- It does not invent attendee emails or event details.
