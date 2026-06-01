---
name: gbp-post-writer
description: >
  Write effective Google Business Profile posts for local-SEO clients — What's
  New, Offer, Event, and Product posts — on demand or as a batch/cadence. Trigger
  whenever the user says: write a GBP post, Google Business Profile post, create a
  post for [client], weekly GBP posts, draft an offer/event/update post, or
  "post about [promo] for [client]".
compatibility: >
  Pulls client context from the Obsidian vault (Projects/<client>) when available
  (obsidian MCP or OBSIDIAN_VAULT_PATH). Posting requires a connected GBP write
  integration + confirmation; otherwise outputs ready-to-paste drafts. No API key.
---

# GBP Post Writer

Google Business Profile posts are a free, recurring local-ranking and conversion
lever. Write them like someone who knows the format and the customer.

## Know the format

- **Post types:** *What's New* (general update), *Offer* (needs title, start/end
  dates, optional code + terms), *Event* (needs title, start/end), *Product*.
- **Length:** posts can run ~1500 chars, but only the **first ~line shows** before
  "more" — front-load the hook and the value. Aim ~150–300 useful words.
- **One clear CTA** mapped to a Google button: *Learn more / Call now / Book /
  Order online / Buy / Sign up*. Pick the one that matches the goal.
- **Local + keyword, naturally:** work in the city/service once or twice as a
  human would — never keyword-stuff.
- **Image:** recommend a relevant, real photo (landscape, well-lit); never
  stock-looking filler. Note recommended dimensions if asked.

## Workflow

1. Get the **client**, the **goal** (awareness / offer / event / booking), and any
   specifics (promo, dates, code).
2. Pull client context from `Projects/<client>.md` if it exists — services, brand
   voice, location, target keywords, past posts — so the post is on-brand and not
   repetitive.
3. Draft the post: strong first line → value → natural local/keyword → single CTA.
   For Offer/Event, include the required fields.
4. Provide **2 variations** when tone/angle is open, and a suggested image idea.
5. For a cadence request, produce a batch (e.g. 4 weekly posts) with varied
   angles so they don't feel repetitive.

## Save / publish

- Save drafts to `Projects/<client>.md` (a Posts section) or a dated note, and
  report the path so there's a record + history.
- If a GBP write integration is connected and the user wants to publish: show the
  final post, **confirm**, then post — one at a time.

## Safety

- Never invent offers, prices, dates, or claims — use only what the user provides.
- Comply with Google content policy (no prohibited/misleading content).
- Never publish without explicit confirmation.

## What this does NOT do

- It does not fabricate promotions or fake urgency.
- It does not auto-post or bulk-publish without confirmation.
