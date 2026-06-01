---
name: review-repair-outreach
description: >
  Run Nick's review-repair client-acquisition engine end-to-end: find local
  businesses with fresh negative/policy-violating Google reviews, qualify them,
  enrich the contact, send a personalized outreach sequence, track the pipeline,
  and route fulfillment. Trigger whenever Nick says: find review-repair leads,
  build a prospect list, who can I pitch review removal to, run outreach, draft
  the review-removal emails, update the outreach pipeline, or "work the review
  business".
compatibility: >
  Orchestrator. Uses Google Maps (manual or, later, Places API) for discovery,
  Apollo for contact enrichment, and a PRIVATE prospect tracker — the Obsidian
  vault master, mirrored to a private Google Sheet for sharing on demand. Composes
  lead-prospecting, review-manager, email-assistant, and task-manager. Reads the
  playbook in Areas/Freelance/Review-Outreach/ and Profile.md. No API key.
---

# Review-Repair Outreach Engine

Nick's fastest-cash system. The asset is the **pipeline**, not the removal —
fulfillment is a commodity (legit self-removal or the $300 pay-on-success
subcontractor). Operate honestly and compliantly at all times.

Always load the playbook first: `Areas/Freelance/Review-Outreach/` (offer, email
sequence, target criteria, objections, fulfillment SOP) and `Profile.md`.

## Two tracks (run in parallel)
- **Track 1 — manual hot prospects (now, $0):** the 10–20 businesses with the
  freshest, clearly policy-violating reviews → reach by phone / website contact
  form / personal email. Fastest path to the first 1–2 clients.
- **Track 2 — scaled cold email:** only from a separate, warmed sending domain
  (never justifylocal.com) with SPF/DKIM/DMARC, 25–40/inbox/day, verified list.

## Pipeline (per prospect)
1. **Discover** — Google Maps: "[vertical] in [city]" → profiles with a review in
   the last 30–60 days. Best verticals: dentists, med spas, law firms, home
   services (HVAC/plumbing/roofing), auto, vets, real estate, property mgmt.
2. **Qualify** — read the bad review against Google's removal policy
   (see review-manager). Mark **removable? Y/N**:
   - **Y** (fake / non-customer / competitor / employee / off-topic / profanity /
     AI-generated / incentivized / impersonation / illegal) → lead with **Removal
     (pay-on-success)**.
   - **N** (legit bad experience, e.g. 1★ no text) → lead with **Suppression**
     (review-gen + responses, recurring).
3. **Enrich contact** — small locals: phone/email off the listing/site; mid/large:
   Apollo (`apollo_organizations_enrich`, `apollo_mixed_people_api_search`,
   `apollo_people_match`). Verify the email (bounce <2% is the #1 lever).
4. **Outreach** — personalize the sequence templates to the *specific* review;
   hand to email-assistant. **Never send without Nick's confirmation**; CAN-SPAM
   footer (physical address + unsubscribe) on every email.
5. **Track** — log/update the prospect in the tracker. The private master lives in
   the vault (`Areas/Freelance/Review-Outreach/Prospects.md`); mirror to the
   private Google Sheet when Nick wants to show Vinny. Stages: New → Contacted →
   Replied → Call → Won → Fulfilled → Paid. Create follow-up tasks via task-manager.
6. **Fulfill** — removable: legit self-report (keep margin) or delegate to the
   $300 guy; not removable: suppression via review-manager. On payment, log income
   via personal-finance.

## KPIs (refine with real data)
Reply ≥3–5% (8–12% when hyper-relevant), bounce <2%, complaints <0.1%, ~2–4
closes/mo. Surface replies + follow-ups in daily-brief; review the pipeline in
weekly-review.

## Guardrails (non-negotiable)
- Honest **pay-on-success** only; never promise to remove a *legitimate* review.
- CAN-SPAM compliant on every send; separate warmed domain; verified list.
- Do not resell any fraudulent removal method (fake court orders / bogus DMCA) —
  if delegating, the method must be legitimate.
- Cheapest option first; flag any cost before incurring it.

## What this does NOT do
- It does not send emails or commit to clients without Nick's confirmation.
- It does not fabricate reviews, contacts, or removability — qualify honestly.
