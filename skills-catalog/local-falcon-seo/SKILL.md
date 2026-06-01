---
name: local-falcon-seo
description: >
  Run and interpret local search / Google Business Profile performance using the
  Local Falcon connector: rank-grid scans, keyword and location reports,
  competitor analysis, and trend tracking — then summarize findings and save them
  to the vault. Trigger whenever the user says: run a rank scan, check rankings
  for [business], grid scan, how is [client] ranking, GBP/Google Business Profile
  audit, keyword report, competitor report, local SEO check, or "scan [keyword]
  in [city]".
compatibility: >
  Requires the Local Falcon MCP connector to be connected in Claude Code (check
  `claude mcp list`). Saves summaries to the Obsidian vault when available
  (obsidian MCP or OBSIDIAN_VAULT_PATH). No extra setup beyond the connector.
---

# Local Falcon — Local SEO / GBP

Operate the Local Falcon connector to measure and explain local search
visibility, then turn raw grids into decisions.

## Before running

1. Confirm the **business/location** (list saved locations if unsure) and the
   **keyword(s)** to scan.
2. Confirm scan parameters when relevant: grid size, radius, and whether to reuse
   a recent report vs run a fresh scan (scans may consume credits — confirm
   before running new ones).

## Typical workflows

- **Rank grid scan:** run or pull a scan for a location + keyword; read the grid.
- **Keyword report:** performance across keywords for a location.
- **Competitor report:** who ranks around the target and where they win.
- **Trend report:** movement over time; flag improvements/regressions.
- **Location/GBP audit:** pull the location report and summarize profile health.

Use the connector's own tools (list locations → run/get scan → keyword /
competitor / trend reports). Prefer reusing recent reports over new scans unless
the user wants fresh data.

## Interpreting results

- Report the headline metrics in plain English: average rank, share of local
  voice / visibility, % of grid in the top 3, and how it changed.
- Identify **where** on the grid the business is weak (geographic gaps) and which
  **keywords** underperform.
- Name 2–4 concrete next actions (e.g. GBP categories, review velocity, posts,
  citations, service-area focus) tied to the gaps you saw — but stay honest about
  what the data does and doesn't show.

## Save to the brain

Offer to save the summary to the relevant `Projects/<client>.md` (or create it)
with: date, keyword(s), headline metrics, change vs last scan, and next actions.
Report the note path. This builds a per-client history over time.

## Safety

- Confirm before running NEW scans (credit cost).
- Don't fabricate metrics; if a value isn't in the report, say so.
- Read/report only — never change GBP listings here.
