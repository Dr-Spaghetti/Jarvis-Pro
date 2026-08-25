---
name: e2e-test
description: Run E2E human-simulating tests on Jarvis after any UI or API route change
---

After ANY change to `apps/web` or `apps/api` routes, execute this protocol before marking the task done:

## 1. Verify Jarvis is running
Confirm `localhost:3001` (Vite) and `localhost:8787` (API) are up. If not, start with `pnpm dev`.

## 2. Drive the UI with Playwright MCP
Use the Playwright MCP (already connected) to navigate `localhost:3001` and interact with the affected surface:
- Navigate to the affected tab
- Perform the user flows from `e2e/flows.md` that the change touches
- Take a screenshot at each key assertion point
- Note any visual regressions, blank states, or broken layouts

## 3. Run smoke suite
```sh
pnpm test:e2e --grep "@smoke"
```
All smoke tests must pass. If any fail, fix before proceeding.

## 4. Run the relevant spec
```sh
# For Content Analyzer changes:
pnpm test:e2e e2e/tests/analyzer.spec.ts

# For Settings changes:
pnpm test:e2e e2e/tests/settings.spec.ts

# For Jarvis HQ changes:
pnpm test:e2e e2e/tests/hq.spec.ts
```

## 5. Pre-release: full suite
```sh
pnpm test:e2e
pnpm test:e2e:report   # open HTML report with screenshots/videos
```

## 6. Maintain the flow map
When adding a new tab, panel, or user-facing feature:
- Add it to `e2e/flows.md`
- Add a corresponding spec in `e2e/tests/`
- Mark it ★ in flows.md if it's a critical path

## What counts as done
A task is done when:
- Smoke suite passes (`@smoke`)
- Relevant spec for the changed area passes
- No visual regressions observed in Playwright MCP screenshots
