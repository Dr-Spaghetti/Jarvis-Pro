---
name: content-calendar
description: >
  Plan a content calendar across channels (Google Business Profile, blog, social,
  email) from content pillars, business goals, and seasonality — then hand each
  item to the right production skill. Trigger whenever the user says: build a
  content calendar, plan my content, what should I post this month, content plan
  for [client], or "map out [period] of content".
compatibility: >
  Pulls pillars/services/context and recent performance from the Obsidian vault
  and Local Falcon (if connected). Saves the calendar to the vault and feeds
  gbp-post-writer / seo-content-writer / infographic-generator / video skills. No
  API key.
---

# Content Calendar

Strategy before production: decide *what* to publish, *where*, and *when* — so the
production skills have a clear queue instead of guessing.

## Inputs

1. **Client/brand** and **period** (default: next 30 days).
2. **Content pillars / themes** — pull from the vault if defined; otherwise help
   the user name 3–5 pillars (e.g. educational, proof/results, offers,
   behind-the-scenes, local/community).
3. **Goals** for the period (awareness, leads, reviews, a specific promo).
4. **Signals:** seasonality/holidays, what's worked before (Local Falcon trends or
   past performance notes), and what the business wants to push.

## Plan

Produce a calendar as a table the user can act on:

| Date | Channel | Pillar | Topic / hook | Format | Keyword/CTA | Status |
|------|---------|--------|--------------|--------|-------------|--------|

- **Balance** pillars and channels; don't post the same thing everywhere.
- **Cadence** that's realistic (better consistent-and-sustainable than a
  firehose). Match channel norms (GBP weekly, blog 1–4/mo, social per channel).
- Tie items to goals and to upcoming events/seasonality.

## Hand off to production

Each row is a concrete brief. Offer to generate the assets via the right skill:
- GBP posts → **gbp-post-writer**
- Blog/landing → **seo-content-writer**
- Visuals/carousels → **infographic-generator**
- Short-form video ideas → the video skills
- Email → **email-assistant** (draft)

## Save

Save the calendar to `Projects/<client>.md` (a Calendar section) or a
`Content/<client> <period>.md` note; report the path. Update statuses as items
get produced/published so it stays a living plan.

## Principles

- **Actionable, not vague.** Every item has a specific hook/topic, not "post
  something about X".
- **Reflect reality.** Base it on the client's real services, audience, and
  performance — not generic templates.

## What this does NOT do

- It does not publish or schedule posts (hand to scheduled-automation /
  production skills, with confirmation).
- It does not invent performance data; if signals aren't available, it plans from
  pillars/goals and says so.
