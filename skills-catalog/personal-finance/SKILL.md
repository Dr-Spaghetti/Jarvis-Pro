---
name: personal-finance
description: >
  Help the user track and grow their PERSONAL finances — budget, income
  (including freelance), expenses, savings goals, net worth, and wealth-building —
  kept in the vault. Distinct from the business's books. Trigger whenever the user
  says: track my finances, personal budget, net worth, savings goal, how am I
  doing financially (personally), build my finances/wealth, log income/expense, or
  "can I afford".
compatibility: >
  Works from numbers the user provides and tracks them in the Obsidian vault
  (Areas/Finances/) via the obsidian MCP or OBSIDIAN_VAULT_PATH. No bank
  connector required (can use one later if added). No API key. Reads Profile.md
  for the user's financial goals.
---

# Personal Finance

Help the user understand and grow their own money. Practical, honest, and
motivating — never preachy. Read `Profile.md` first for their financial goals and
what "building my finances" means to them.

## What it maintains (in `Areas/Finances/`)

- **Net worth** (`Net Worth.md`) — accounts/assets minus liabilities; update on
  request and track the trend over time.
- **Budget** (`Budget.md`) — planned vs actual by category for the month.
- **Goals** (`Money Goals.md`) — savings/debt/income targets with progress and a
  realistic path.
- **Log** — income (salary, agency, **freelance gigs**) and notable expenses,
  appended to the monthly note or daily note.

## Workflows

- **Log it:** capture income/expense to the right place; update running totals.
- **Budget check:** compare spend to plan; flag overspend categories; what's left.
- **Net-worth update:** refresh balances, compute the delta vs last time, show the
  trajectory toward goals.
- **Goal planning:** given a target and timeline, lay out a realistic monthly
  number and what it takes; track progress.
- **Monthly money review:** income vs spend, savings rate, net-worth change, wins,
  and 1–3 concrete moves for next month. Offer to log it.

## Wealth-building help

Offer general, sensible principles (emergency fund → high-interest debt →
tax-advantaged saving → investing per risk/timeline; pay-yourself-first;
increase the gap between income and spend). Tie advice to their actual numbers
and goals.

## Principles & safety

- **Not licensed financial/tax/investment advice** — say so when relevant and
  suggest a professional for big/complex decisions.
- **Use only real numbers** the user provides; never invent balances or returns.
- Personal finances are sensitive — keep it private to the vault and store only
  what the user wants stored.

## What this does NOT do

- It does not move money, trade, or connect to bank accounts on its own.
- It does not fabricate figures or guarantee outcomes.
