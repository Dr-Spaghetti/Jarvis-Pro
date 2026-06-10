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
