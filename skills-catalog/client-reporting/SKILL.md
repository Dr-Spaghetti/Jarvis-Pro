---
name: client-reporting
description: >
  Build a client-ready performance report for a local-SEO/marketing client:
  pull the data (Local Falcon rankings/trends, and other connectors as needed),
  compare to the prior period, and produce a clean summary with wins and next
  steps — optionally with a Canva visual. Trigger whenever the user says: build a
  client report, monthly report for [client], report on [client], put together a
  deliverable, or "summarize results for [client]".
compatibility: >
  Uses connectors already available in Claude Code: Local Falcon (rankings/
  trends), optionally Canva (visuals), and the Obsidian vault for storage/history
  (obsidian MCP or OBSIDIAN_VAULT_PATH). Check `claude mcp list` for what's
  connected; degrade gracefully to a text report if a connector is missing.
---

# Client Reporting

Turn raw performance data into a deliverable a client actually understands.

## Inputs

1. **Which client** and **period** (e.g. this month vs last month).
2. Pull data from the relevant connectors:
   - **Local Falcon** — current vs prior rank/trend, competitor position.
   - Pull prior context from the client's `Projects/<client>.md` in the vault if
     it exists (so the report reflects continuity, not a one-off).

## Report structure

Produce, in this order:

1. **Executive summary** — 2–3 sentences a busy owner can read: are things up or
   down, and the one thing that matters.
2. **Results vs last period** — headline metrics with the delta (rank, share of
   local voice, top-3 coverage). Use plain language.
3. **What we did** — the work that drove it (pull from the project log if
   available; otherwise ask).
4. **Wins** — concrete, specific.
5. **Next steps** — 2–4 prioritized actions for the coming period.

## Optional visual

If Canva is connected and the user wants a visual, generate a simple branded
summary graphic (key metrics + deltas). Otherwise deliver clean text/markdown.

## Save + deliver

- Save the report to `Projects/<client>.md` (append a dated report section) so the
  history compounds, and report the path.
- Offer to draft a client email with the summary (hand to email-assistant) —
  **never send without explicit confirmation.**

## Safety

- Use only real, pulled metrics; never inflate results. If data is missing, say
  what you couldn't get rather than guessing.
- No sending/publishing without confirmation.
