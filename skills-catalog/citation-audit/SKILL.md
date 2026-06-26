---
name: citation-audit
description: >
  Audit NAP (Name, Address, Phone) consistency across local citation directories
  for one or more SEO clients — check each directory for accuracy, flag
  mismatches, score overall health, and save a markdown report to the vault.
  Trigger whenever the user says: citation audit, check citations for [client],
  NAP audit, NAP consistency, citation check, are citations consistent for
  [client], directory audit, or "run citations for [client]".
compatibility: >
  Uses the Local Falcon connector (citation/location data) and the Obsidian vault
  (client profiles at Projects/<client>.md). Degrades gracefully — runs a
  web-search–based check if Local Falcon isn't connected. No extra API key beyond
  what's already in claude mcp list.
---

# Citation Audit

NAP consistency across directories is a foundational local-SEO signal. Small
mismatches (wrong suite number, old phone, truncated name) suppress rankings and
confuse customers. Find them and fix them.

## Before running

1. Confirm **which client(s)** to audit. If multiple, run one at a time and
   summarize at the end.
2. Pull the client's canonical NAP from `Projects/<client>.md` → NAP section. If
   the note doesn't exist, ask the user for: business name (exact legal form),
   address, phone, and target directories.
3. Confirm the **directory list** — default to Google Business Profile, Yelp, Bing
   Places, Apple Maps, Facebook, BBB, Foursquare, Yellow Pages, and any
   client-specific directories noted in the vault. User can add or remove.

## Process

1. **Load canonical NAP** — the single source of truth for this client.
2. **Check each directory** using the Local Falcon location/citation tools, or
   web search + fetch if Local Falcon isn't connected:
   - Business name — exact match including punctuation, LLC/Inc, DBA.
   - Street address — suite/unit, abbreviations (St vs Street), zip.
   - Phone — format doesn't matter; the underlying digits must match.
   - Website URL — consistent with the client's primary domain.
   - Status — is the listing claimed? Active? Any duplicates?
3. **Score each directory:** Pass / Fail / Warning (partial mismatch or
   unclaimed).
4. **Compile totals:** pass count, fail count, warning count out of total checked.
5. **Identify critical issues** — any NAP field that differs across 3+ directories,
   duplicate listings, or unclaimed high-authority profiles.

## Output in chat

Emit a compact summary table, then wait for user direction:

| Directory | Name | Address | Phone | Status | Notes |
|-----------|------|---------|-------|--------|-------|
| Google    | ✅   | ✅      | ❌    | Claimed | Old number |
| Yelp      | ⚠️   | ✅      | ✅    | Claimed | Truncated name |
…

**Score: X/Y pass (Z warnings)**  
**Top issue:** [most impactful mismatch]

## Save to the brain

Save the full report to `Projects/<client>.md` (append a "Citations — YYYY-MM-DD"
section) with canonical NAP, directory results table, score, and a prioritized
fix list. Report the vault path.

Also offer to add fix tasks to the task manager (one task per failing directory).

## Recommended fix order

Prioritize by authority:
1. Google Business Profile — highest weight
2. Apple Maps / Bing Places / Facebook — tier 2
3. Data aggregators (Neustar Localeze, Factual) — fix here, it propagates
4. Long-tail directories — lowest urgency

## Safety

- Read-only analysis only; never modify listings directly.
- If a directory is inaccessible, record "data unavailable" — don't skip or guess.
- Never invent NAP data; if canonical NAP is missing a field, ask.
- Flag any discrepancy between GBP and the citation profile as critical — it
  affects the GBP audit score too (cross-reference with gbp-audit).
