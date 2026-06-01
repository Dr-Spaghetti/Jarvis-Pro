---
name: seo-content-writer
description: >
  Write search-optimized, local-SEO-aware content — blog posts, service pages,
  and location/landing pages — with proper on-page structure and metadata.
  Trigger whenever the user says: write a blog post, write a service/location
  page, SEO article about [topic], landing page copy, rewrite this page for SEO,
  or "content targeting [keyword] in [city]".
compatibility: >
  Optionally composes web-research (built-in web tools) for SERP/competitor angles
  and pulls client voice/context from the Obsidian vault. Saves drafts to the
  vault. No API key required.
---

# SEO Content Writer

Write content that ranks *and* reads well — for a real local business, not a
keyword robot.

## Brief first

Establish before writing:
- **Primary keyword** + **location** (for local), and the **search intent**
  (informational / commercial / transactional) — the structure follows intent.
- **Page type:** blog post, service page, location page, or landing page.
- **Audience** and the **action** you want them to take.
- Optionally run **web-research** to see what's ranking and find a differentiated
  angle (don't copy competitors — beat them on usefulness).
- Pull the client's **voice and services** from `Projects/<client>.md` if present.

## On-page structure to produce

- **Title tag** (~55–60 chars) and **meta description** (~150–160 chars) with the
  keyword + a reason to click.
- **One H1**; logical **H2/H3** covering the topic and natural semantic variants.
- **Intent-matched body:** answer the query fully; lead with the answer for
  informational, with value+proof for commercial.
- **Internal link suggestions** (to relevant service/location/related pages) and
  1–2 authoritative external references where appropriate.
- **E-E-A-T / local signals:** specifics, experience, NAP consistency for local
  pages.
- **Schema suggestion:** LocalBusiness / Service / FAQ / Article as fits, with a
  short FAQ section when useful.
- A clear **CTA**.

## Principles

- **Useful > stuffed.** Natural keyword usage; write for the reader first.
- **No fabrication.** Don't invent stats, reviews, awards, or citations — flag any
  claim that needs a real source.
- **Match the brand voice**; avoid generic AI filler and hedging.

## Save

Save the draft (with the title tag, meta, and schema notes) to the vault
(`Projects/<client>` or `Notes/`), and report the path. Offer to spin related
assets (hand to gbp-post-writer, infographic-generator, or the video skill).

## What this does NOT do

- It does not fabricate facts, reviews, or sources.
- It does not publish anywhere; it produces the draft + on-page guidance.
