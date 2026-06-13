# Review Log

Recurring lessons from per-wave adversarial review passes. Append per wave; newest first.

## Wave 1 — Recent Agents command center + global UX polish (2026-06-10)

Scope reviewed: commits `9aca49c..82095e8` (core deck fields, opened/pinned API,
endpoint builders, RecentAgentsPanel, "?" shortcuts overlay, tooltips/toasts/PanelState).

### Confirmed findings (fixed)

1. **`<dialog open>` does not trap focus** (`ShortcutsOverlay.tsx`). The static `open`
   attribute renders the dialog but only `showModal()` activates native focus trapping —
   so `aria-modal="true"` was an unbacked claim. We avoid `showModal()` because jsdom
   support is unreliable; fixed with a manual Tab/Shift+Tab focus trap in the dialog's
   `onKeyDown`, covered by a test.
   **Lesson:** an ARIA attribute is a promise — verify the runtime behavior actually
   backs it, especially with half-native elements like `<dialog>`.

2. **Traversal guards omitted backslash** (`recordDeckTentacleOpened`,
   `setDeckTentaclePinned`). The `".."`/`"/"` checks block upward traversal (any `..\\`
   contains `..`), but Windows path separators were not rejected, allowing IDs that
   address nested subdirectories. Added `"\\"` to both new guards as defense-in-depth.
   **Lesson:** on a Windows-first project, every path-segment guard needs `\\` alongside
   `/`. The same gap exists in the pre-existing guards (`updateDeckTentacleSuggestedSkills`,
   `deleteDeckTentacle`, vault/todo readers) — candidate for a shared
   `isSafeTentacleId()` helper in a later wave.

### Reviewer false positives (documented so they aren't "re-found")

- **"StrictMode double-increments openCount."** False: StrictMode re-runs effects on
  mount but does NOT remount the component, so `useRef` values persist across the
  double-invocation. The `recordedOpenRef` guard in `DeckPrimaryView` holds and the
  second effect run early-returns. No double POST.
- **"`writeDeckState` clobbers unknown top-level keys in deck.json."** False:
  `readDeckState` returns the *raw parsed object* (the `as DeckStateDocument` cast does
  not strip keys at runtime), and create/delete mutate only their own entry before
  writing the same object back. Unknown top-level keys and unknown keys on untouched
  entries survive. Only `parseTentacleState` strips unknown fields, and it is read-only
  (never feeds a write).
- **"`<output>` is semantically wrong for the toast stack."** Biome's
  `lint/a11y/useSemanticElements` itself mandates `<output>` over `role="status"`;
  `<output>` carries implicit `role="status"`. Keeping it.

### Deferred (with reasons)

- **Sort-mode persistence for RecentAgentsPanel**: `PersistedUiState` silently drops
  unknown keys, so persisting the sort mode needs plumbing across
  `usePersistedUiState.ts`, `uiStateNormalizers.ts`, the API ui-state route, and two
  test files (~5 files). Local component state for now; revisit in Wave 2 alongside the
  planned ui-state work.
- **Breadcrumbs** (Feature 8): no breadcrumb system exists anywhere in the app — cost
  outweighs value for a single-level navigation model.
- **"Waiting for resources" consolidation** (Feature 8): only one legitimate occurrence
  (`TelemetryTape.tsx`); nothing to consolidate.
- **Sidebar collapse toggle tooltip** (planned target): no such control exists in the
  codebase — the plan listed it speculatively. Tooltips applied only to verified
  icon-only controls (deck pod delete, terminal prompt dismiss, canvas terminal
  minimize/close).
- **Conversations PanelState adoption**: its loading/empty/error states already use
  styled classes (`conversations-empty`, `conversations-error`), not bare strings —
  per plan, left alone.

### Process lessons

- Biome's formatter wants multi-condition `if` headers split across lines and short
  `expect()` calls collapsed — run `biome check --fix` before the lint gate to avoid a
  round-trip.
- Biome `useSemanticElements` will reject `role="group"`, `role="dialog"`, and
  `role="status"` on divs — reach for `<fieldset>`, `<dialog>`, `<output>` first.
- The Deck view lives at nav index **2** ("[2] Deck"), not 1 ("[1] Agents" is the
  canvas) — integration tests must click the right tab.
- Row buttons containing multiple spans have a concatenated accessible name; query rows
  by visible text (`getByText`) instead of `getByRole("button", { name })`.

---

## Wave 7 — Phone/remote access (bearer-token auth) — commits 753a382..7f8515f

Adversarial review of the wave diff. Hunted for auth bypasses, header-less
callers, fake UI, and migration regressions. **No critical or real findings** —
fixes were applied during the build (live-smoke-tested), leaving only nits.

### What held up under attack
- **No parser-differential bypass.** The auth gate and the route dispatcher both
  read the *same* `requestUrl.pathname` from one `new URL(request.url, base)`.
  `/api/../x`, `//api/x`, and trailing-slash tricks all normalize identically for
  the gate and the router, and the gate fails closed (`startsWith("/api/")` +
  exempt-set is case-sensitive, so any casing trick that dodges the gate also
  fails to route → static/404, never an authed handler).
- **Every header-less channel carries `?token=`:** both `new WebSocket` sites,
  the settings-export `<a download>`. Audio playback uses a blob from an
  `apiFetch` response, not a direct URL. Gmail "Connect" does an `apiFetch` then
  `window.open`s the *Google* URL; the only header-less `/api/` navigation is
  `/api/gmail/callback`, which is correctly in `AUTH_EXEMPT_PATHS` (Google's
  redirect can't carry a header; protected by OAuth state instead).
- **Token never reaches app logs:** `logRequest` logs `pathname` only, never the
  query string.
- **AuthGate gates the whole app:** `<App/>` doesn't mount until `gateState ===
  "ready"`, so no storm of 401s fires on load — only the gate's own exempt
  `status` + `verify` calls run pre-auth.

### Nits (logged, not fixed — inherent / cosmetic)
- **N1 — query-param token visibility.** `?token=` on WS upgrades and the export
  link can land in upstream proxy/CDN access logs and browser history. Inherent
  to header-less channels; acceptable because it's the user's own token on their
  own infra. If ever exposed to shared infra, rotate to short-lived signed URLs.
- **N2 — redundant prompt trigger.** On a stale stored token, the initial
  `verify` 401 both fires `apiFetch`'s unauthorized listener *and* the explicit
  `clearStoredAuthToken()/setGateState("prompt")` path. Converges to the same
  prompt; harmless.

### Lessons
- **`build-package.mjs` does NOT rebuild the API bundle** — it only copies
  `prompts`, `skills-catalog`, and the web `dist` into `dist/`. The API is bundled
  separately by `vite build --config vite.api.bundle.config.mts` (wired into the
  `build` npm script). A green test/lint/web-build gate can still ship a **stale
  `dist/api`** to `node bin/octogent`. For any API-route change, run the API
  bundle step before functional smoke, or the running server won't have the new
  routes (cost us a confusing "route returns index.html" moment).
- **Bearer-via-env-expansion in hooks is auth-state-safe.** Curl hooks send
  `Authorization: Bearer $OCTOGENT_AUTH_TOKEN`; when auth is off the var expands
  empty and the server ignores it (`authToken === null` short-circuit); when on,
  `.env` → `process.env` → forwarded to the PTY, so it expands correctly. http
  hooks must also list the var in `allowedEnvVars`.
- **Re-running the server reinstalls hooks** — the merge now prunes prior
  octogent-owned entries (matched by `/api/hooks/` or `/api/code-intel/events` in
  the serialized entry) before re-adding, so a port/token change no longer
  accumulates duplicate hooks. User-authored hooks to other URLs are preserved.
- **A central `apiFetch` + a Biome `noRestrictedGlobals: ["fetch"]` override on
  `apps/web/src/**` is the durable guard** against a future raw-`fetch` call site
  silently skipping auth. The lint gate now enforces it.

---

## Wave 4 — Telemetry → analytics → alerting → export — commits a66cc8a..ecae609

Adversarial review of the wave diff. **No critical or real findings.**

### What held up
- **Honest telemetry, no fabrication.** `scanTranscriptTokenUsage` reads only
  real `message.usage` blocks from the Claude transcript JSONL and returns
  `null` when none exist, so pre-telemetry / non-Claude sessions get no entry.
  The route returns `[]` (not an error) → honest "collecting from now" empty
  state. Re-firing the Stop hook re-scans the whole transcript and SETS totals,
  so it's idempotent (no double counting).
- **Alerts are derived, never stored.** `evaluateAgentAlerts` is pure over the
  live snapshot list; an alert exists only while its condition holds. Nothing to
  "clear" or go stale. `agentStateChangedAt` is set at the single state-
  transition point + at session creation, and lives only on the in-memory
  session (added to the snapshot, NOT to PersistedTerminal) — no registry bloat.
- **Auth intact.** All new routes are under `/api/` and absent from
  `AUTH_EXEMPT_PATHS`, so they require the token when set. The export download
  link carries `?token=` via `appendAuthTokenParam` (browsers can't header an
  `<a download>`), matching the Wave 7 pattern. The biome raw-`fetch` guard
  still passes — the only unguarded `fetch` is the one inside `apiFetch`.
- **No route shadowing.** The five `/api/monitor/*` handlers all match on exact
  pathname equality, so ordering among them is irrelevant and none swallows
  another's path.

### Deferrals (logged, by design)
- **Alert toasts fire only while the Monitor view is mounted** — the 30s poller
  lives in `AgentAlertsPanel`. App-wide background alerting (poller hoisted to
  `App`) is a larger change; the persistent alerts list is always accurate when
  viewed, and toasts fire whenever Monitor is open. Revisit if push-style
  alerting is wanted.
- **Export is a point-in-time snapshot, not a historical log.** Because alerts
  are live-derived, the export captures rules + alerts active at export time.
  A persisted alert-history log would be a separate feature; documented in the
  route comment and commit so it isn't mistaken for a full audit trail.

### Lessons
- **Adding a field to the shared `@octogent/core` `TerminalSnapshot` needs a
  `pnpm --filter @octogent/core build`** before the API tests that import the
  built type will see it. The `-r` test run handles ordering, but a single-
  package `--filter @octogent/api test` against a stale core build will fail
  confusingly.
- **Biome reformats object-spread ternaries and multi-line conditions
  aggressively** — run `biome check --write` on touched files before the lint
  gate; three increments tripped the formatter on first pass.
- **Self-contained panels (own `apiFetch` + `PanelState` states) avoid prop
  threading** through `PrimaryViewRouter`/`App` — `JournalTimeline` was the
  template for both `AgentAnalyticsPanel` and `AgentAlertsPanel`. Keeps wave
  increments small and the view router untouched.

---

## Wave 5 — Proactive morning briefs — commit fab3e5d

Adversarial review of the wave diff. **No critical or real findings.**

### What held up
- **Deterministic, no agent.** The brief is rendered from `computeBrainDigest()`
  (pure vault filesystem read) — the same function the GET digest route now uses
  after the refactor. No Claude process is ever spawned; UI copy says so.
- **Idempotent three ways.** A brief is written at most once per date because:
  (1) the note filename is date-stamped, (2) an existing note file is never
  overwritten (and the run records the date so checks stop), and (3)
  `config.lastBriefDate === today` short-circuits `shouldWriteBrief`. Tested.
- **Missed days are never back-filled.** `shouldWriteBrief` only ever considers
  the current date — a machine that was off all day yesterday gets today's brief
  once it passes the configured time, not a backlog. Matches the spec.
- **Lifecycle-safe.** The scheduler starts on `listen` and stops on `stop()`;
  the interval is `unref()`'d so it never keeps the process alive on its own.
  With the default (disabled) config the per-minute tick is a cheap file read.
- **Auth intact.** `/api/brief/config` is under `/api/` and not exempt →
  protected when a token is set. PATCH validates the `HH:MM` time and the
  boolean `enabled`; the running scheduler re-reads config each tick so a config
  change takes effect without a restart.

### Nit (logged, not fixed)
- The startup catch-up tick runs synchronously inside `start()`. It only does
  real work when a brief is genuinely due (enabled + past time + vault present),
  and the vault scan is bounded by `MAX_FILES_SCANNED`, so worst case is one
  bounded synchronous scan before `listen` resolves. Acceptable; revisit with a
  `setTimeout(0)` deferral if a very large vault ever makes startup feel slow.

### Lessons
- **Embedding a self-contained, toast-using panel into a presentational view
  breaks that view's existing bare-render tests.** `MorningBriefPanel` uses
  `useToasts()` + fetches on mount, so `gmailSettings.test.tsx` (which rendered
  `SettingsPrimaryView` directly) had to be wrapped in `ToastProvider` and given
  a `fetch` stub. When adding a stateful child to a previously-pure component,
  grep its test files for bare `render(<Component …>)` and wrap them.
- **Refactor-extract before adding a second caller.** Pulling the digest body
  into `computeBrainDigest()` (returning the payload) let the route shrink to a
  one-liner and gave the scheduler an honest, identical data source — no
  HTTP-self-call, no duplicated scan logic.
