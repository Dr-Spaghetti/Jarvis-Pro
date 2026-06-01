---
name: finance-snapshot
description: >
  Give a fast, plain-English read on the business's finances using QuickBooks:
  cash position, revenue/profit trend, and accounts-receivable aging — optionally
  logged to the vault. Trigger whenever the user says: how's the business doing
  financially, cash position, what's my P&L, who owes me money / AR aging, revenue
  this month, or "finance snapshot".
compatibility: >
  Requires the QuickBooks (Intuit) connector in Claude Code (check
  `claude mcp list`). Read-only. Can log the summary to the Obsidian vault
  (obsidian MCP or OBSIDIAN_VAULT_PATH).
---

# Finance Snapshot

A quick, owner-friendly financial pulse — not an accounting deep-dive.

## What to pull (via the QuickBooks connector)

- **Cash position** — current balances (balance sheet / cash).
- **Profit & Loss** — revenue, expenses, net for the period; compare to the prior
  period when possible.
- **Accounts receivable aging** — who owes, how much, how overdue.
- (Optionally) sales by customer/product if the user asks "what's driving it".

Confirm the **period** (this month / quarter / YTD) if not specified.

## Output

1. **Bottom line** — one or two sentences: cash on hand, are we up or down,
   anything urgent (e.g. large overdue AR, thin cash).
2. **The numbers** — cash, revenue, net profit, and the deltas vs prior period.
3. **Watch items** — overdue invoices worth chasing, unusual swings.
4. (If asked) a couple of plain next actions (e.g. "follow up on $X overdue from
   Client Y").

Keep it scannable. Round sensibly. Always state the period and currency.

## Save to the brain

Offer to log the snapshot to today's `Daily/` note or a `Projects/Finances.md`
note so you can track the trend over time. Report the path.

## Safety

- **Read-only.** Never create, modify, send, or delete invoices/transactions
  here — that requires explicit, separate confirmation and is out of scope.
- Use only real figures from QuickBooks; if something can't be retrieved, say so.
- Finances are sensitive — keep summaries factual and avoid storing more detail
  than the user wants in the vault.
