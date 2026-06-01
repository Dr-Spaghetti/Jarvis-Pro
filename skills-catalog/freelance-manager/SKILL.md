---
name: freelance-manager
description: >
  Run the user's freelance / side-income work end-to-end — web builds, AI, SEO,
  and other paid gigs for people they meet — from lead to paid. Trigger whenever
  the user says: new freelance lead, I met someone who wants a website/SEO, track
  this gig/side job, quote for [name], freelance pipeline, scope this project, or
  "log this paid work".
compatibility: >
  Tracks gigs as notes in the Obsidian vault (Areas/Freelance/) via obsidian MCP
  or OBSIDIAN_VAULT_PATH. Composes task-manager (deliverables), email-assistant
  (quotes/invoices, draft-only), and personal-finance (record income). No API key.
---

# Freelance Manager

This is the user's personal side income — separate from the SEO agency's clients.
Make it easy to turn "someone I met wants a site" into tracked, paid work.

## Pipeline

Each gig moves through: **Lead → Quoted → Won/Scoped → In progress → Delivered →
Invoiced → Paid**. Track the stage on each gig note.

## Per-gig note (`Areas/Freelance/<client-or-gig>.md`)

```markdown
---
type: freelance
contact: <name / how to reach>
met: <where/how you met them>
service: <website | SEO | AI | other>
stage: lead
price: <quoted/agreed>
tags: [freelance]
---

# <Client / Gig>

## Scope
<what they want / deliverables>

## Status & log
- <date> — <update>

## Tasks
- [ ] 

## Links / assets
- 
```

## Workflows

- **Capture a lead:** who they are, how you met, what they need → create the gig
  note at stage `lead`.
- **Quote / scope:** draft a clear, simple quote or mini-SOW (deliverables, price,
  timeline, what's not included). Hand sending to email-assistant — never send
  without confirmation.
- **Run the build:** break the scope into tasks (task-manager); track progress in
  the log; update the stage.
- **Invoice & collect:** when delivered, draft the invoice/payment request; on
  payment, **record the income via personal-finance** and set stage `paid`.
- **Pipeline view:** list all gigs by stage so nothing stalls; flag leads with no
  next action.

## Principles & safety

- Quotes/invoices are **drafts** until the user confirms sending.
- Use only real amounts and commitments; don't promise on the user's behalf.
- Keep each gig's truth in its note so status is never guesswork.

## What this does NOT do

- It does not send quotes/invoices or accept work without confirmation.
- It does not mix freelance gigs with the agency's client records.
