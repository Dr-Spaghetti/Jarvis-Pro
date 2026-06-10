---
name: review-repair-outreach
description: >
  Run Nick's review-repair client-acquisition engine end-to-end and AUTOMATED:
  discover local businesses + their Google ratings via the Local Falcon API, rank
  by pain + value-fit, qualify, enrich the decision-maker's contact via Apollo,
  draft a personalized outreach sequence, and log everything to the private
  tracker. Trigger whenever Nick says: find review-repair leads, build/refresh the
  prospect list, who can I pitch review removal to, run the outreach engine, draft
  the review emails, update the pipeline, or "work the review business".
compatibility: >
  Automated orchestrator (no browser scraping — Google blocks it). Data sources,
  all API: Local Falcon (`searchForLocalFalconBusinessLocation` = free
  ratings/counts/place data; Reviews Analysis report = $19/location for deep review
  text) for discovery + reviews; Apollo for contacts; an optional bulk-reviews API
  (Outscraper/Places) for cheap full review text. Output: the PRIVATE vault tracker
  `Areas/Freelance/Review-Outreach/Prospects.md`, mirrored to a private Google
  Sheet. Composes lead-prospecting, review-manager, email-assistant, task-manager,
  personal-finance. Reads the playbook in Areas/Freelance/Review-Outreach/ + Profile.md.
  For outreach email: email-assistant uses `GMAIL_REFRESH_TOKEN` from env (set via
  Octogent Settings → Gmail) or an authenticated Gmail MCP connector.
---

# Review-Repair Outreach Engine

Nick's fastest-cash system, built to run hands-off inside the tool. The asset is
the **pipeline**, not the removal (fulfillment is delegated to the $300
pay-on-success guy or done legitimately). Honest + compliant always.

Load first: the playbook in `Areas/Freelance/Review-Outreach/` (Offer, Email
Sequence, Target Criteria + contact-routing rule, Fulfillment SOP), `Profile.md`
(goals, voice, current channel preference — **email-only for now**), and
`Jarvis/Memory.md` for durable context.

## Memory & journal (Jarvis shared protocol)

- **Read memory first:** `Jarvis/Memory.md` (durable facts/preferences) alongside the playbook.
- **Log when done:** append one line to `Journal/Activity Log.md` (create with a
  `# Jarvis Activity Log` header if missing), exactly:
  `- [<ISO-8601 timestamp>] [ok|warn|error] (review-repair-outreach) <what you did> — <short detail>`
  Use `warn`/`error` when a run is blocked (e.g. no leads found, API limit) so it's visible on the home.
- **Remember durable facts** (e.g. a target vertical that converts) under `## Facts` in `Jarvis/Memory.md`.

## Automated pipeline (this is how to run it)
1. **Discover + rank — FREE, no browser.** For each target (or a vertical+area),
   call Local Falcon `searchForLocalFalconBusinessLocation` → get rating, review
   count, place_id, address, phone, site, categories. Rank by **pain (lowest
   rating) × value-fit (CLV, review-dependence, ability to pay) → price tier**
   (Tier 1 $700–900 student housing / dental-DSO / med spa / law / multi-loc home
   services; Tier 2 $400–600 single-loc locals; Tier 3 skip). Never anchor the top
   price on a low-margin business.
2. **Qualify removable vs suppress.** Removable = a policy-violating review (fake /
   non-customer / competitor / employee / off-topic / profanity / AI-generated /
   incentivized / impersonation / illegal). This needs the **review TEXT**, which
   the free search does NOT include — pull it via a reviews API (Outscraper/Places,
   pennies) or Local Falcon Reviews Analysis ($19/location). **Flag the cost and
   get Nick's OK before spending.** Until then, run **suppression-led** on the
   lowest-rated (the low rating itself is the pitch).
3. **Enrich contact (Apollo).** `apollo_mixed_people_api_search` (free) to find the
   decision-maker; `apollo_people_match` to reveal the email (**1 credit each —
   confirm count first**). Routing (see Target Criteria): **independent business →
   on-site property manager / owner** (email usually on site/listing); **big
   operator (GMH, Greystar, Landmark, Core, etc.) → corporate marketing** (Apollo).
   Property-level emails often aren't in Apollo — note that, don't fabricate one.
4. **Draft outreach.** Personalize the Email Sequence to the specific business/
   review (cite specifics). Separate, tailored emails per contact — never CC a PM
   and their corporate exec. Hand to email-assistant. **Never send without Nick's
   explicit approval** (he reviews every email); his default signature handles the
   footer; CAN-SPAM applies.
5. **Track.** Write/update each prospect + contact in the vault tracker
   `Prospects.md`; mirror to the private Google Sheet on request. Stages: New →
   Contacted → Replied → Call → Won → Fulfilled → Paid. Create follow-ups via
   task-manager.
6. **Fulfill.** Removable → legit self-report or the $300 guy; not removable →
   suppression via review-manager. On payment, log income via personal-finance.

## Fits the wider Jarvis
New replies + due follow-ups surface in **daily-brief**; pipeline + KPIs reviewed
in **weekly-review**; income logged via **personal-finance**; the tracker lives in
the **Obsidian** brain. KPIs: reply ≥3–5%, bounce <2%, complaints <0.1%, ~2–4
closes/mo.

## Cost ladder (cheapest-first; flag before spending)
Local Falcon search = FREE · Apollo people search = FREE · Apollo email enrich = 1
credit/contact · bulk reviews (Outscraper/Places) = pennies · Local Falcon Reviews
Analysis = $19/location (reserve for hot targets / landed clients).

## Guardrails (non-negotiable)
- Honest **pay-on-success** only; never promise to remove a *legitimate* review.
- **Never send or commit to a client without Nick's explicit approval.**
- CAN-SPAM on every send; for scaled cold email use a separate warmed domain
  (never justifylocal.com); verify addresses.
- Don't resell any fraudulent removal method (fake court orders / bogus DMCA).
- Flag every cost before incurring it.

## What this does NOT do
- It does not scrape Google Maps in a browser (unreliable + blocked) — it uses APIs.
- It does not send emails, spend credits, or commit to clients without confirmation.
- It does not fabricate reviews, contacts, ratings, or removability.
