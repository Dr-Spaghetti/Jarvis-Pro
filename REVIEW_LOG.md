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
