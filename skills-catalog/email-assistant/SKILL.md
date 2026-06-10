---
name: email-assistant
description: >
  Draft, review, reply to, and triage email — and send only with explicit
  confirmation. Trigger whenever the user asks to: write/draft an email, reply to
  someone, follow up, summarize my inbox, find an email, clean up email, or "send
  a note to …". Also trigger on phrases like "draft a reply", "write an email
  to", "what's in my inbox", "follow up with", or "summarize this thread".
compatibility: >
  Two auth paths are supported. Preferred: `GMAIL_REFRESH_TOKEN` in the project
  `.env` (set via the Octogent Settings → Gmail → Connect Gmail button). Fallback:
  a connected Gmail MCP server in Claude Code (e.g. the claude.ai "Gmail" connector).
  Drafting works with no integration at all.
---

# Email Assistant

Compose great email and manage the inbox — safely. The rule that never bends:
**never send without the user's explicit go-ahead.**

## Capabilities by integration state

Detect which state you are in **before** claiming you can read or send.

1. **`GMAIL_REFRESH_TOKEN` in env** (set via Octogent Settings → Gmail → Connect
   Gmail): fully autonomous read, search, summarize, draft, and — after explicit
   confirmation — send/reply. Use the Gmail REST API with the refresh token:
   - Refresh access token: `POST https://oauth2.googleapis.com/token` with
     `client_id=$GMAIL_CLIENT_ID`, `client_secret=$GMAIL_CLIENT_SECRET`,
     `refresh_token=$GMAIL_REFRESH_TOKEN`, `grant_type=refresh_token`
   - List inbox: `GET https://gmail.googleapis.com/gmail/v1/users/me/messages`
     with `Authorization: Bearer <access_token>`
   - Send: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
     with base64url-encoded RFC 2822 message in `{"raw":"..."}` body
2. **Email MCP connected & authenticated** (e.g. claude.ai Gmail connector):
   read, search, summarize, draft, and — after explicit confirmation — send/reply
   via MCP tools. Check `claude mcp list` first.
3. **No email integration:** drafting only. Produce email text for the user to
   copy, and tell them to connect Gmail in Octogent Settings to enable read/send.

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
