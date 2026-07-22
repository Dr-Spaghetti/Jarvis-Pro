# Repository Guidelines

## Code Style First
- Preserve existing patterns before inventing new ones. Read nearby code and match the established module shape, naming, and data flow unless there is a clear reason to change direction.
- Start with tests. For bug fixes, reproduce first. For new features, add the test that defines the behavior before expanding the implementation.
- Implement incrementally. Prefer small, working steps over broad rewrites. Keep the tree passing as you go.
- Think in systems. Extract shared behavior into reusable components, hooks, utilities, or domain functions instead of cloning slightly different versions.
- Keep modules focused. Large React containers should orchestrate, not hold every constant, parser, and JSX block. Keep pure logic in `src/app/*`, UI in `src/components/*`, and CSS split into focused files under `src/styles/*`.
- Comments explain why, not what. Add comments only for constraints, tradeoffs, or non-obvious reasoning.
- Design defensively. Validate assumptions, handle edge cases, and treat security boundaries as part of the implementation, not a follow-up.

## Project Structure
- Monorepo: `apps/*` and `packages/*` via `pnpm-workspace.yaml`.
- Runtime: Node.js 22+, TypeScript, `pnpm`.
- Core package: `packages/core`
  - Framework-agnostic domain types, application logic, and ports.
  - Must stay free of React, HTTP, PTY, and filesystem orchestration concerns.
- API app: `apps/api`
  - Node HTTP/WebSocket server, PTY session runtime, worktree lifecycle, transcript persistence, monitor service.
- Web app: `apps/web`
  - Vite + React operator UI, modular CSS, UI orchestration over API/runtime contracts.
- Runtime state: `.octogent/`
  - `state/tentacles.json`
  - `state/transcripts/*.jsonl`
  - `worktrees/<tentacleId>`

## Documentation Map
- Start at `README.md` for the product overview and command surface.
- Docs index: `docs/index.md`
- Core concepts:
  - `docs/concepts/mental-model.md`
  - `docs/concepts/tentacles.md`
  - `docs/concepts/runtime-and-api.md`
- Workflow guides:
  - `docs/guides/working-with-todos.md`
  - `docs/guides/orchestrating-child-agents.md`
  - `docs/guides/inter-agent-messaging.md`
- References:
  - `docs/reference/cli.md`
  - `docs/reference/api.md`
  - `docs/reference/filesystem-layout.md`
  - `docs/reference/troubleshooting.md`
- Read only the docs relevant to the surface you are touching. Do not do a full docs sweep unless the task is documentation maintenance.

## Architecture Boundaries
- `packages/core` defines domain contracts and pure application logic. Both apps may depend on it; it must not depend on app code.
- `apps/api` owns infrastructure concerns: PTYs, WebSockets, filesystem persistence, process execution, and git worktree operations.
- `apps/web` owns presentation and client-side interaction state. Do not move server-only behavior into the web app to avoid adding hidden backend logic to the UI.
- If behavior is reusable across apps, move it into `packages/core` only when it can remain framework-agnostic.
- Keep orchestration thin. Entry points such as API server/bootstrap files and top-level React containers should wire dependencies, not accumulate business logic.

## Workflow
- Read only the guides and code relevant to the surface you are changing. Do not sweep the whole repo before starting.
- Prefer small, isolated edits over broad cleanup unless the task explicitly asks for refactoring.
- Keep docs in sync with behavior changes when user-facing workflows, commands, persistence layout, or architecture assumptions change.
- Preserve the product vocabulary already documented in `CLAUDE.md`: agents, sessions, worktrees, logs, pipelines, tentacles, and terminal columns.

## Verification
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Format: `pnpm format`
- For narrow changes, run the most direct test or package-scoped test first, then widen verification as needed.
- For changes that affect shared contracts, persistence, or cross-app behavior, run the relevant package tests and the root build before landing.

## E2E Testing Protocol

After any change to `apps/web` or `apps/api` routes, invoke the `/e2e-test` skill:
- Use the Playwright MCP to navigate `localhost:3001` and drive the affected UI surface
- Verify the ★-starred flows in `e2e/flows.md` pass
- Run `pnpm test:e2e --grep "@smoke"` — must pass before marking the task done
- Run `pnpm test:e2e` for a full suite check before any release
- Update `e2e/flows.md` whenever a new tab, panel, or surface is added

## Scoped Guides
- `apps/api/AGENTS.md` expands server/runtime/worktree rules.
- `apps/web/AGENTS.md` expands UI/component/style rules.
- `packages/core/AGENTS.md` expands domain and ports-and-adapters rules.

## Cross-Tool Sync (Claude Code ↔ Codex)

Both Claude Code and Codex work on this repo. Follow this protocol so they stay aligned.

### Session Start — read these in order
1. `.octogent/.remember/remember.md` — snapshot of current state written at last session end
2. `.octogent/.remember/today-YYYY-MM-DD.md` — today's running work log
3. `.octogent/.remember/recent.md` — last 7 days of activity
4. `git status` — confirm working tree state before touching anything

### Session End — write a snapshot
Append or overwrite `.octogent/.remember/remember.md` with:
- **What changed**: files modified, features shipped, bugs fixed
- **Working tree**: clean / has uncommitted changes (list them)
- **Open threads**: in-progress work, next priorities
- **Blockers**: anything the next tool needs to know before starting

Keep it under 30 lines. The next tool reads this cold.

### Division of labor
- **Claude Code**: multi-file reasoning, planning, MCP integrations, Playwright E2E verification, artifacts, complex debugging across layers
- **Codex**: rapid in-editor generation, focused single-file edits, TypeScript completions, staying in flow in VS Code

### Conflict avoidance
- Check `git status` before starting work. If uncommitted changes exist from the other tool, commit or stash them first.
- Prefer feature branches for parallel work. Merge to `main` only after the verification gate passes (§Verification above).
- Do not touch files the other tool is actively editing in an uncommitted state — coordinate via `remember.md` if handoff mid-feature is needed.
