---
name: review-manager
description: >
  Monitor and respond to Google/business reviews for local-SEO clients: pull
  recent reviews, flag negatives and themes, and draft on-brand, policy-compliant
  responses for every rating tier. Trigger whenever the user says: check reviews,
  any new reviews, respond to reviews, draft a reply to this review, review
  responses for [client], reputation, or "how are [client]'s reviews".
compatibility: >
  Reads review data via the Local Falcon connector (reviews-analysis reports) or
  a connected Google Business Profile source; check `claude mcp list`. Works on a
  pasted review with no integration (drafting only). Posting replies requires GBP
  write access — otherwise it outputs drafts to copy. Saves themes to the vault.
---

# Review Manager

Reputation is local SEO's highest-trust signal. Handle reviews like a pro: fast,
personal, on-brand, and within Google's rules.

## Gather

- Pull recent reviews for the client (Local Falcon reviews-analysis report, or
  GBP if connected). If neither is available, work on reviews the user pastes.
- Sort by rating and date. Surface: new since last check, anything ≤ 3 stars,
  and **recurring themes** (the same praise or complaint across reviews — these
  are operational signals, not just PR).

## Draft responses — by tier

Every response: address the reviewer **by name**, reference **something specific**
they said (never generic), keep the brand voice, and read like a human wrote it.

- **5★ / positive:** warm, specific thanks; reinforce what they valued; a light,
  natural invitation to return. Optionally weave the city/service in *once*,
  never keyword-stuffed.
- **4★ / mostly positive:** thank them, acknowledge the small gap, note the
  improvement or invitation to give feedback.
- **3★ / mixed:** thank, acknowledge both sides, take the concern seriously, and
  offer a path to make it right.
- **1–2★ / negative:** lead with empathy and a genuine (non-defensive) apology,
  do **not** argue or disclose private details, take it **offline** ("please
  reach us at …"), and signal the fix. Never blame the customer.

## Google policy guardrails

- No incentives offered for reviews; no asking to remove/edit a review in
  exchange for anything.
- Don't reveal private customer info in a public reply.
- For reviews that appear **fake, defamatory, or policy-violating**, don't
  respond combatively — draft a brief professional holding reply and **flag it
  for a removal request** (note why it qualifies).

## Posting

- If GBP write access is available: show the final reply, **get explicit
  confirmation**, then post. One at a time.
- If not: output the drafts clearly labeled per review for the user to paste.

## Save to the brain

Append a dated **reputation summary** to `Projects/<client>.md`: rating trend,
new review count, recurring themes (with the operational issue each implies), and
any flagged reviews. This turns reviews into recurring client insight.

## What this does NOT do

- It never posts without explicit confirmation, and never auto-replies in bulk.
- It does not fabricate reviewer names or details.
- It does not offer incentives or violate Google review policy.
