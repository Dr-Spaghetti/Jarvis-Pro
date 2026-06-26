---
name: gbp-audit
description: >
  Score a client's Google Business Profile across 8 key sections (100-point
  scale), surface critical gaps, pull Local Falcon grid rankings when available,
  and produce a prioritized action plan saved to the vault. Trigger whenever the
  user says: GBP audit, Google Business Profile audit, profile audit, audit GBP
  for [client], GBP health check, profile score, how is [client]'s GBP, or
  "score [client] Google profile".
compatibility: >
  Uses the Local Falcon connector for rank grids, review analysis, and location
  data. Pulls client context from the Obsidian vault (Projects/<client>.md).
  Degrades to a manual-prompt-based audit if Local Falcon isn't connected — ask
  the user to paste the GBP overview. No extra API key beyond claude mcp list.
---

# GBP Audit — 100-Point Scorecard

A weak GBP is the most common reason a local business doesn't show in the
map pack. Run this audit to measure exactly where they're leaking points and
what to fix first.

## Before running

1. Confirm **which client** and load their profile from `Projects/<client>.md`.
   Needed: primary category, description keywords, Local Falcon campaign IDs
   (if any), and canonical NAP.
2. Confirm whether to pull a **fresh Local Falcon scan** (consumes credits) or
   reuse the most recent report. Default: reuse unless the user says fresh.

## Scoring

Score each section. If data for a section is unavailable, score it 0 and note
"data unavailable" — never skip or estimate.

### 1. NAP Accuracy — 20 pts
- Business name exactly matches canonical NAP and website: 7 pts
- Address matches (including suite/unit): 7 pts
- Phone matches (digits, not format): 6 pts
- **Cross-check with citation-audit report if it exists.** Flag any mismatch
  here as a critical issue in both audits.

### 2. Categories — 15 pts
- Primary category is the most specific match for the core service: 8 pts
- At least 2 additional secondary categories are set: 7 pts

### 3. Business Description — 10 pts
- Description is present: 3 pts
- 500–750 characters: 4 pts
- Includes the client's primary keyword naturally: 3 pts

### 4. Hours — 10 pts
- Hours set for all 7 days: 6 pts
- Holiday/special hours updated within the last 90 days: 4 pts

### 5. Photos — 15 pts
- 10+ photos uploaded total: 5 pts
- At least 1 exterior, 1 interior, 1 team/staff photo: 6 pts
- Newest photo added within 30 days: 4 pts

### 6. Reviews — 15 pts
- Average rating ≥ 4.0 stars: 5 pts
- Every review has an owner response: 6 pts
- No unanswered reviews older than 7 days: 4 pts

### 7. Posts — 10 pts
- At least 1 post published in the last 14 days: 6 pts
- Most recent post includes a CTA button: 4 pts

### 8. Q&A — 5 pts
- No unanswered customer questions: 3 pts
- At least 3 seed Q&As authored by the business: 2 pts

## Local Falcon rankings

If Local Falcon is connected and the client has campaign IDs, pull the most
recent grid report and append to the audit:
- ATS (Average Top Spot) score
- Top 3 keywords by current rank
- Grid map summary (where they rank #1–3 vs where they fall off)

## Output in chat

```
GBP Audit — [Client] ([Date])
Overall: X/100 — [Excellent / Good / Needs Work / Critical]

Section             Score  Max  Top Issue
NAP Accuracy          X    20   [issue or "clean"]
Categories            X    15
Description           X    10
Hours                 X    10
Photos                X    15
Reviews               X    15
Posts                 X    10
Q&A                   X     5

Critical gaps (scored 0): [list]
Top 3 fixes by score impact:
1. …
2. …
3. …
```

Grades: 90–100 = Excellent · 75–89 = Good · 60–74 = Needs Work · <60 = Critical

## Save to the brain

Save the full scored report to `Projects/<client>.md` (append a
"GBP Audit — YYYY-MM-DD" section). Include: score, section breakdown, critical
gaps, and the top-3 fix list. Report the vault path.

Offer to add the top-3 fixes as tasks in the task manager.

## Safety

- Read and report only; never modify the GBP listing directly.
- Never invent data for a section — 0 + "data unavailable" is always the right
  call when you can't retrieve it.
- Confirm before running a new Local Falcon scan (it costs credits).
- Honor any client overrides noted in the vault before applying defaults.
