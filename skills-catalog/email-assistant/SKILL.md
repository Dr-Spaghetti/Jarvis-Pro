---
name: email-assistant
description: >
  Draft, review, reply to, and triage email — and send only with explicit
  confirmation. Trigger whenever the user asks to: write/draft an email, reply to
  someone, follow up, summarize my inbox, find an email, clean up email, or "send
  a note to …". Also trigger on phrases like "draft a reply", "write an email
  to", "what's in my inbox", "follow up with", or "summarize this thread".
compatibility: >
  Sending/reading uses a connected Gmail (or other email) MCP server in Claude
  Code — e.g. the claude.ai "Gmail" connector, which must be authenticated once.
  Drafting works with no integration at all. Check `claude mcp list` for a
  connected, authenticated email server before attempting to read or send.
---

# Email Assistant

Compose great email and manage the inbox — safely. The rule that never bends:
**never send without the user's explicit go-ahead.**

## Capabilities by integration state

1. **Email MCP connected & authenticated** (e.g. Gmail connector): can read,
   search, summarize, draft, and — after explicit confirmation — send/reply.
2. **No email integration:** still fully useful for **drafting**. Produce the
   email text for the user to copy, and tell them they can connect the Gmail
   connector (`claude mcp list` → authenticate it) to enable sending/reading.

Detect which state you are in before claiming you can read or send.

## Drafting

- Match the user's intent, audience, and tone (ask if unclear: formal vs casual,
  short vs detailed).
- Default structure: clear subject, one-line context, the ask/point, a specific
  next step, sign-off.
- Keep it tight. Lead with the point. Make the requested action obvious.
- Offer 1–2 variants when tone is uncertain (e.g. "warm" vs "direct").

## Reading / triage (integration required)

- Summarize threads: who, what's being asked, what's blocking, suggested reply.
- For inbox triage: group into action-required, FYI, and noise; surface the few
  that need a response and draft those replies.

## Sending (integration required) — safety protocol

1. Show the user the **final draft** (recipient, subject, body).
2. **Wait for explicit confirmation** ("send it").
3. Only then call the send/reply tool. Never send speculatively, never to
   guessed addresses, never bulk-send without per-message confirmation.

## Second-brain tie-in

When an email captures a decision, commitment, or useful info, offer to log it to
the vault (e.g. append to today's `Daily/` note or the relevant `Projects/`
note) so it isn't lost in the inbox.

## What this does NOT do

- It does not send, archive, or delete anything without explicit confirmation.
- It does not invent recipient addresses or thread contents.
