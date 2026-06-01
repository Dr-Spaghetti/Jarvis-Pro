---
name: lead-prospecting
description: >
  Build and enrich a list of prospective clients using Apollo, qualify them
  against an ideal-customer profile, store them, and draft outreach. Trigger
  whenever the user says: find leads, prospect [niche/area], build a prospect
  list, find [type] businesses in [place], enrich these companies/contacts, or
  "who should I reach out to".
compatibility: >
  Requires the Apollo connector in Claude Code (check `claude mcp list`).
  Optionally writes lists to Airtable (if connected) and/or the Obsidian vault,
  and hands outreach drafting to the email-assistant skill. No auto-sending.
---

# Lead Prospecting

Find the right local businesses to pitch, enrich them, and tee up outreach —
without spraying.

## Define the target (ICP) first

Clarify before searching: business category/industry, geography (city/region),
size signals, and any disqualifiers. A tight ICP beats a big messy list.

## Workflow

1. **Search** with Apollo (companies and/or people) matching the ICP.
2. **Enrich** the promising ones (firmographics, contacts, key roles).
3. **Qualify** against the ICP; drop poor fits. Note *why* each is a fit.
4. **Store** the shortlist:
   - To **Airtable** if connected (a prospects table), and/or
   - To the vault (e.g. `Projects/Prospecting.md` or a dated note) with name,
     site, contact, fit reason, and status.
5. **Draft outreach** per prospect via the email-assistant skill — personalized
   to the fit reason, not a generic blast.

## Principles

- **Quality over volume.** A handful of well-fit, well-researched prospects with
  tailored messages beats a huge cold list.
- **Personalize** using something real about each business (recent signal, niche,
  location) — surface that hook for the outreach.
- Respect limits: be mindful of connector credits/rate limits; work in small
  batches.

## Safety

- **Never auto-send.** Outreach is drafted and shown; sending requires explicit
  confirmation (and a connected email integration).
- Don't fabricate contact details — use only enriched/verified data; flag
  low-confidence emails.
- Handle personal data responsibly.
