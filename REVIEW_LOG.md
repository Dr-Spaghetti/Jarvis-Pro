# Review Log

Recurring lessons from per-wave adversarial review passes. Append per wave; newest first.

## Deferred-hardening audit — all three items resolved (2026-06-17)

Verified that the three items marked "defer — no high risk" in the post-wave-12 security review are all resolved. No code changes required.

### Fix 1 — OPTIONS before auth (intentional design, correct as-is)

The adversarial review flagged the `OPTIONS → 204` handler firing before the auth
check as a potential "route probing" vector. On audit:
- The handler returns an **identical `204` for every path** regardless of whether
  the route exists — no route-specific information is disclosed.
- A dedicated test (`"answers OPTIONS preflight without a token when auth is
  enabled"`, `createApiServer.test.ts:556`) verifies this as intentional behavior.
- A code comment (added during hardening) explicitly documents the rationale:
  *"an OPTIONS request returns an identical empty 204 for every path regardless of
  auth, so it discloses nothing, and keeping it open preserves standard
  cross-origin behavior."*
- Moving OPTIONS after the auth gate would break CORS preflights (browsers send
  OPTIONS without credentials; a `401` on the preflight silently aborts the real
  request). No legitimate security gain justifies that regression.
- **Decision: leave as-is.** The design is correct and well-documented.

### Fix 2 — Trailing-slash normalization (already implemented)

`isAuthExemptPath` at `requestHandler.ts:161–165` already normalizes a single
trailing slash before the exempt-path lookup: `pathname.slice(0, -1)` when the
path ends with `/`. The companion test (`"treats an exempt path with a trailing
slash as exempt"`, line 565) verifies it. Nothing to change.

### Fix 3 — Token-rotation warning in remote-access doc (already written)

`docs/remote-access.md` lines 16–22 already contain a full `⚠️ Token visibility
in URLs` callout explaining that `?token=…` appears in logs/history, and
instructing Nick to rotate the token immediately if any such URL is ever shared.
The "Day-to-day use" section also has a `Lost or leaked token?` note. Nothing to add.

### Lessons

- **"Defer" items from an adversarial review need a follow-up audit** — they
  sometimes have already been addressed in a prior increment (Fix 2, Fix 3) or
  are actually intentional design decisions backed by tests (Fix 1). Applying
  them mechanically without re-reading the code can break correct behavior.
- **Always check for a test before changing a security boundary** — the OPTIONS
  test was the signal that the current behavior is deliberate, not an oversight.

---

## Wave 11 security follow-up — agenticAsk output overflow — commit 34766a8 (2026-06-17)

All 320 API + 195 web tests pass, lint clean, web build green, API bundle green, `build-package.mjs` exit 0.

### Applied (MEDIUM)

**M-1 — Unbounded stdout/stderr buffers in `agenticAsk` → local OOM DoS**
`agenticAsk.ts` buffered the `claude -p` process's stdout and stderr into plain
strings with no size cap. A runaway model response (or adversarially-crafted MCP
connector output) could continuously emit data, growing the strings until the
Node process exhausted its heap and crashed.

Fixed: Added `MAX_OUTPUT_BYTES = 1_000_000`. Each `data` event handler checks the
accumulated string length after appending the new chunk; if either stream exceeds
the cap the child is killed (`proc.kill()`) and the `Promise` resolves with
`{ ok: false, reason: "output-overflow", hint: "...try a more specific question" }`.
The existing `finished` guard ensures this resolves exactly once regardless of
which stream overflows first. The 30 s timeout, env allowlist, and stdin-piping
are untouched.

Added `apps/api/tests/agenticAsk.test.ts` (5 tests) covering:
- stdout overflow at 1 MB + 1 byte → `reason: "output-overflow"`, `proc.kill` called
- stderr overflow at 1 MB + 1 byte → same
- two-chunk accumulation (600 kB + 600 kB) triggers on the second chunk
- exactly 1 MB does NOT overflow; process closes normally → `ok: true`
- double-stream overflow is idempotent (promise resolves once)

### Lessons
- **Any process you `spawn` and buffer into memory is an OOM vector** — cap both
  streams regardless of how trustworthy the source is. The parent process budget
  is shared with the HTTP server; unbounded child output is a silent availability
  risk.
- **Test the boundary, not just well-past it** — the "exactly 1 MB" test confirms
  the `>` condition (not `>=`) and that normal close still works at the limit.

---

## Wave 12 — Tiles + money engine (2026-06-17)

Two commits: `feat(wave-12)` (sensitive flags on skills) and hardening `fix(wave-12)`. All 315 API + 195 web tests pass, lint clean, web build green, API bundle green, `build-package.mjs` exit 0.

### Tile decision (documented)

Nick has no `APOLLO_API_KEY` or `LOCALFALCON_API_KEY` in `.env`. The `tilesRoutes.ts` tile implementation (built in Wave 6) already handles this correctly: Apollo and Local Falcon tiles return `status: "not-configured"` with `value: null` and a clear hint to add the key. QuickBooks stays deferred (OAuth complexity). **Decision:** those tiles stay "not configured" until Nick adds the REST keys. Apollo/Local Falcon data is available on-demand via the Wave 11 agentic Ask Jarvis path — ask "what does my Local Falcon rank look like?" and it routes through `claude -p` with MCP connectors. No fake data anywhere.

### Applied (CRITICAL)

**C-1 — Voice confirm handler missing `confirmed: true`**
The voice approval dialog Confirm button POSTed `{ skillName }` without `confirmed: true`. The server reads `body?.confirmed === true` and was returning another 403. The user would tap Confirm, see an error, and the skill would never run. Fixed: `{ skillName: name, confirmed: true }` — mirrors the Deck path which was already correct.

### Applied (HIGH)

**H-1 — Hardcoded voice gate regex instead of server-driven 403**
The voice run-skill handler checked `\b(outreach|email.assist)\b` client-side before hitting the server. Any new `sensitive: true` skill added to the catalog would be unprotected on the voice path (POST without `confirmed: true` → 403 error, not a dialog). Replaced with the same server-driven pattern as DeckPrimaryView: POST first, check for 403 `requiresConfirmation`, then show the dialog and speak the approval request. The voice path is now forward-compatible with any future sensitive skill.

### Not applied (MEDIUM, LOW)

**MEDIUM-1 — `sensitive:` with no value / wrong casing silently reads as false**
`parseFrontMatterFields` stores an empty value for `sensitive:` (no inline value), and `readSkillMetadata` checks `=== "true"` (case-sensitive). A typo (`sensitive: True`, `sensitive:`) produces `sensitive: false` with no warning. Both deployed SKILL.md files use the correct `sensitive: true` string. Not applying a parser change here — the format is simple and documented; a lint/schema check is future scope.

**LOW-1 — `checkProvider` tile error detail doesn't distinguish bad key from network outage**
Both a 401 (wrong key) and a connection failure return `status: "error"` with the same `detail` message. No fake data produced; it's a debugging quality issue. Pre-existing pattern; future scope.

### Lessons

- **The voice and Deck paths share the approval dialog UI but had diverged in the protocol** — Deck was correct (server-driven 403 → dialog); voice was using a client-side regex. Always verify both trigger paths when adding an approval gate.
- **`confirmed: true` must travel with EVERY post-approval POST** — the client has two call sites for skill run (initial + post-confirm), and only one of them was correct. When you change the confirmation protocol, search both call sites.
- **Server-side gates are forward-compatible; client-side regex gates are not** — adding a new sensitive skill requires no client change when the gate is server-driven.

---

## Wave 11 — Agentic Ask Jarvis — hardening (2026-06-17)

Adversarial review of Wave 11 diff. **All CRITICAL and HIGH findings applied in this hardening commit. MEDIUM and LOW findings applied where safe; one LOW test change required to match new correct behavior.**

### Summary

Two commits: feature (`feat(brain): Wave 11 — agentic Ask Jarvis with live MCP data`) and this hardening commit. All 315 API + 195 web tests pass, lint clean, web build green, API bundle green, `build-package.mjs` exit 0.

### Applied (CRITICAL)

**C-1 — Windows `shell:true` with unresolved binary**
Spawning `"claude"` with `shell:true` on Windows bypassed the resolved binary path and risked picking up a rogue `claude.bat` from cwd. Fixed to `cmd.exe /c <resolved_path>` with `shell:false`.

**C-2 — Child process inherited all parent secrets**
`buildChildEnv()` used a denylist that still passed `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, and every other server secret. Replaced with an OS-var allowlist (`PATH`, `HOME`, `USERPROFILE`, `TEMP`, `TMP`, `TMPDIR`, `SystemRoot`, `COMSPEC`, `PATHEXT`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`).

### Applied (HIGH)

**H-1 — Explicit Ollama + agentic question silently fell through to hallucination**
When `model` was an explicit Ollama model and the question classified as agentic, the code fell through to Ollama, which would fabricate a live-data answer. Now returns `reason: "agentic-skipped"` with a clear hint to switch to Auto.

**H-2 — Voice path missing `via` field**
The `runVoiceIntent` "ask" branch's `data` type cast lacked `via?: string` and never called `setAnswerVia`. Fixed to match the text-ask path.

**H-3 — 60 s timeout too long**
Reduced from 60 s to 30 s to keep the UI from hanging.

### Applied (MEDIUM)

**M-2 — "rank" and "leads" matched substrings ("frank", "misleads")**
Changed `containsAny` from `string.includes(kw)` to `new RegExp(\`\\b${kw}\\b\`).test(lower)` so single-word keywords only match at word boundaries.

**M-3 — `.jarvis-answer-via` used `--text-muted` (undefined in theme)**
Changed to `var(--text-secondary)` which is defined in the design system.

### Applied (LOW)

**L-2 — Binary resolution shelled out on every request**
Added module-level `cachedBinary` cache. Also exported `resetClaudeBinaryCache()` for test isolation.

### Test update

The "skips agentic path when explicit Ollama" test was updated to assert `reason: "agentic-skipped"` instead of `"no-chat-model"` — the old assertion described the old (incorrect) fall-through behavior that H-1 eliminated.

### Lessons

- **Allowlists beat denylists for env scrubbing** — a denylist always misses new secrets; an allowlist of OS-required vars is complete by design.
- **Windows spawn requires explicit `cmd.exe /c <path>` pattern** — `shell:true` with a relative name silently discards any resolved absolute path.
- **Never silently fall through to a model that can't answer correctly** — an explicit "I can't fetch that" is always better than a plausible hallucination.
- **Word-boundary regexes for short keywords prevent false positives** — `\b` is cheap and eliminates the "frank" / "misleads" class of classifier bugs.

---

## Wave 10 — Claude answer-model picker — commits feat + fix (2026-06-17)

Adversarial review of Wave 10 diff. **Two MEDIUM findings applied in a hardening commit. Two MEDIUM and two LOW findings documented but not applied (reasons below).**

### Summary

Two commits: feature (`feat(brain): Wave 10 — user-selectable Claude answer model`) and hardening (`fix(brain): harden Wave 10 post-review`). Tests pass (303 API, 195 web), lint clean, web build green, API bundle green, `build-package.mjs` exit 0.

Changes: `brainRoutes.ts` (routing logic, `claudeModels` field in `/api/brain/models`, `askViaClaude` model param), `JarvisHomePrimaryView.tsx` (Claude model dropdown options, `claudeModels` state), `brainRoutes.test.ts` (4 new tests covering new routing branches).

### Applied (MEDIUM)

**MEDIUM-1 — Stale localStorage not reset when API key removed**
After `ANTHROPIC_API_KEY` is removed from `.env`, the persisted `jarvis.chatModel` could still be `claude-haiku-*` or `claude-sonnet-*` — causing every ask to hit the explicit-Claude branch and return `no-chat-model` silently. **Fix:** validate the persisted selection against the combined `[...claudeModels, ...chatModels]` list after each models fetch; clear localStorage and reset to `""` (Auto) if the stored value is no longer available.

**MEDIUM-2 — Wrong Ollama failure hint when model is explicit**
When an explicit Ollama model (e.g. `qwen3.6:latest`) fails to respond, the error message said "Couldn't reach a cloud model" — even though cloud was deliberately skipped. **Fix:** conditional hint: explicit-model path says "The local model X did not respond — pull it" while the auto-cascade path keeps the original cloud-failure wording.

### Considered and not applied (with reason)

**MEDIUM-3 — Ollama-skip test does not prove cloud skipping via call inspection**
The test verifying explicit-Ollama model skips cloud uses response-shape difference (400 auto-cascade vs 200 explicit-Ollama), not mock call counts. This means it does not technically prove that `askViaClaude` / `askViaOpenAI` are never called on the explicit-Ollama path. **Why not applied:** Adding fetch mocking to this test suite would require restructuring the module to inject providers rather than calling module-level closures. The routing logic is clear from the code (`model?.startsWith("claude-")` short-circuits first; no-key auto-cascade exits with 400 before reaching Ollama). The test is accepted as a behavior-contract test, not a call-isolation test. **Lesson:** annotate the test comment so the next reader knows the limitation is intentional.

**MEDIUM-4 — No `sources` field in Ollama slow-path when `vaultDir` is null (pre-existing)**
When `vaultDir` is null and no cloud model answers, the 400 response lacks `sources`. This was pre-existing before Wave 10; the Wave 10 routing code preserves it. Addressing it correctly requires threading `sources` through the early-exit path, which is a broader refactor. Scoped as a future cleanup, not a Wave 10 regression.

### LOW findings (not applied)

**LOW-1 — `CLAUDE_MODEL_IDS` `as const` + spread loses readonly type**
`[...CLAUDE_MODEL_IDS]` returns `string[]`, discarding the `readonly` narrowing. No runtime impact; a future loop over the array already has correct values. Not worth a separate refactor commit.

**LOW-2 — No loading / error state for models fetch failure**
If `/api/brain/models` returns a network error, `claudeModels` stays `[]` silently and the Claude options disappear without explanation. Pre-existing pattern for all model selects; fixing it uniformly is Wave 11 scope.

### Lessons

- **PowerShell `@'...'@` here-strings split on embedded single quotes in some tool invocations** — write commit messages to a temp file and use `git commit -F` as a reliable cross-platform fallback. The `$(cat <<'EOF'...'@` hybrid is a non-starter.
- **Stale localStorage after credential removal is an easy miss** — any picker whose options are key-gated must validate the stored value at load time, not just on change.
- **Conditional error messages pay off** — the same "no-chat-model" response shape looks right to the client; the human-readable hint is where context matters. Branch the hint on `model` being set vs auto-cascade.

---

## Post-verification hardening (2026-06-13)

Independent 3-reviewer audit of all waves (security / data-honesty / connector
alignment). Data-honesty: spotless. Security: fundamentally sound. Two minor items
applied, one reviewer finding deliberately NOT applied.

### Applied
1. **Trailing-slash normalization on the auth exempt-path check**
   (`requestHandler.ts` `isAuthExemptPath`). `/api/auth/status/` now normalizes to
   the exempt path instead of failing closed. Was already safe (denied), so this is
   pure future-proofing against a trailing-slash route variant. Test added.
2. **Token-visibility note in `docs/remote-access.md`.** `?token=` rides in WS /
   download URLs (browsers can't header them) and can land in Cloudflare / browser
   logs — documented the rotate-on-leak guidance.

### Considered and rejected (with reason)
- **"Gate OPTIONS behind auth" (reviewer graded HIGH).** Rejected as overstated:
  an OPTIONS request returns an identical empty `204` for every path regardless of
  auth, so it discloses nothing (no route enumeration). An explicit existing test
  (`createApiServer.test.ts` "answers OPTIONS preflight without a token") encodes the
  intentional decision to keep CORS preflight open. Gating it would trade real
  CORS-correctness for closing a non-leak. **Lesson: a reviewer's severity label is a
  hypothesis — verify the actual disclosure before acting; don't break intentional,
  tested behavior to satisfy an overstated finding.**

### Known limitation confirmed (not a bug)
- Apollo / Local Falcon **home tiles** gate on `.env` keys (`APOLLO_API_KEY`,
  `LOCALFALCON_API_KEY`) the user doesn't have — they use those services via MCP
  connectors instead. Tiles correctly show "not configured"; the **skills**
  (local-falcon-seo, lead-prospecting, review-repair-outreach) work fully via MCP.
  Lighting up the tiles would need either `.env` keys or an MCP-backed tile rewrite
  (scoped as future work, not done).

## Wave 9 — Run-skill voice intent + POST /api/skills/run — commit 8424c5c

Adversarial review of Wave 9 diff. **No blocking issues. Two medium findings, three low/negligible. All documented for follow-up.**

### Summary

10 files changed, 430 insertions. Tests pass (285 API, 191 web), lint clean, builds green. The run-skill voice classifier, fuzzy-match API route, approval gate, and Deck ▶ button all function correctly under normal use. Findings below are edge-case quality issues, not correctness bugs.

### MEDIUM-1 — Approval gate checks spoken name, not resolved canonical name

**File:** `apps/web/src/components/JarvisHomePrimaryView.tsx`

```typescript
const needsApproval = /\b(outreach|email.assist)\b/.test(intent.skillName.toLowerCase());
```

`intent.skillName` is the raw spoken phrase, **not** the canonical name resolved by `fuzzyFindSkill`. A user who says "run campaign blaster" where "campaign blaster" fuzzy-resolves to an outreach skill internally named "Outreach Builder" bypasses the gate — the regex never sees "outreach".

**Risk:** Approval gate is bypassable via any synonym that fuzzy-matches a gated skill.
**Mitigation options:**
1. Move the gate server-side: add `sensitive: true` frontmatter to SKILL.md and check it in `handleSkillsRunRoute` before spawning the terminal, returning 403 with a `requiresConfirmation` flag.
2. Run the gate regex against the resolved skill name (from a pre-flight lookup) rather than the spoken phrase.

Current gate is a UX friction point, not a security boundary — acceptable for the current local-first deployment, but worth addressing when high-value catalog skills are added.

### MEDIUM-2 — No server-side skill category enforcement

**File:** `apps/api/src/createApiServer/skillsRoutes.ts`

The API accepts any valid `skillName` and spawns a terminal unconditionally. Any authenticated caller can POST `/api/skills/run` directly, bypassing the confirmation dialog. Auth-gating prevents unauthenticated callers, but not authorized users making direct API calls.

**Mitigation:** `sensitive: true` frontmatter + server-side gate (see MEDIUM-1 option 1). Pass `confirmed: true` in the POST body after the dialog; server enforces its presence for sensitive skills. Scope as Wave 10 work.

### LOW-1 — `needle.includes(hay)` false positives on short skill names

**File:** `apps/api/src/createApiServer/skillsRoutes.ts`, `fuzzyFindSkill` step 2

```typescript
if (hay.includes(needle) || needle.includes(hay)) return skill;
```

If the bundled catalog ever includes a skill with a very short normalized name (e.g., `"ai"`, `"run"`, `"brief"`), the contains-check matches any spoken input containing that substring — before word-overlap even fires. "run my daily brief" → matches any skill named "brief" or "run" at step 2.

**Mitigation:** Guard `hay.length >= 4` before the contains check so single-word skills with ≤3 chars fall through to word-overlap scoring instead.

### LOW-2 — "run the skill" (no name given) classifies as `run-skill` with candidate `"skill"`

**File:** `apps/api/src/voiceIntent.ts`, implicit run-skill matcher

When the user says "run the skill" without specifying a name, the explicit prefix check returns `""` (correctly rejected), but the implicit regex then captures `"skill"` as the candidate via lazy-match backtracking. The intent becomes `{ type: "run-skill", skillName: "skill" }`, which either matches an unintended skill or returns 404 with a confusing error toast.

**Mitigation:** Add `runSkillCandidate !== "skill"` to the implicit guard (or a broader stop-word list). **No test covers this path** — add one.

### LOW-3 — Redundant `existsSync` before `readFileSync` (TOCTOU)

**File:** `apps/api/src/createApiServer/skillsRoutes.ts`, lines 104–115

`existsSync` followed by `readFileSync` has a race window. The `try/catch` at line 110 already handles the failure case — the only difference is 404 vs 500 status. The check is redundant and cosmetically leaks a known anti-pattern.

**Mitigation:** Remove the `existsSync` block; detect `ENOENT` inside the catch and return 404; return 500 for other errors. Makes the code simpler and the status codes more precise.

### Test coverage gaps

| Scenario | Covered? |
|---|---|
| Explicit `run skill [name]` | ✅ |
| Implicit `run [name]` (non-nav) | ✅ |
| Nav word guard (`run deck`) | ✅ |
| Terminal keyword guard (`run new agent`) | ✅ |
| Question opener guard | ✅ |
| **`run the skill` (no name) → candidate "skill"** | ❌ |
| **Gate regex on spoken vs resolved name** | ❌ |
| **Confirm button double-click prevention** | ❌ |
| POST 400 / 404 / 200 / 405 | ✅ |
| `buildSkillsRunUrl` same-origin + absolute | ✅ |

### Design decisions confirmed correct

- **Client-side approval gate** is appropriate for a local tool with auth-gated API. Gate is UX friction, not a security boundary.
- **`fuzzyFindSkill` 50% word-overlap** trades some false-positive risk for user-friendly matching. Correct for the use case; LOW-1 above is a preventable edge case.
- **`initialPrompt` = full SKILL.md body** is safe — `filePath` comes from an enumerated set of real files, not user input. No path traversal risk.
- **`workspaceMode: "shared"`** for skill terminals is correct; skills should share workspace context.

### Lessons

- **`resolveJarvisVoiceIntent` lazy-regex with `(?:\s+skill)?$` captures ambiguous trailing words** — test bare invocations ("run the skill") to catch classifier edge cases before they surface as confusing API errors.
- **Approval gates that operate on spoken input instead of resolved identifiers are structurally fragile** — the gate should always verify the resolved canonical name, not the user's words.
- **`build-package.mjs` does not rebuild the API bundle** (lesson from Wave 7 reinforced) — any API-route change needs `vite build --config vite.api.bundle.config.mts` explicitly before functional smoke.
- **PowerShell here-string git commits fail on backticks and angle brackets** — assign the message to `$msg` first, then `git commit -m $msg`.

---

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

---

## Wave 6 — Live home tiles — commit 1a1a812

Adversarial review of the wave diff. **No critical or real findings.**

### What held up
- **No fabricated data, ever.** Every tile carries an explicit `status`. Only
  `ok` tiles render a `value`; `not-configured` and `error` tiles render their
  status text and carry `value: null` (asserted in tests). A vault with zero
  tasks honestly shows `0`, distinct from an unconfigured vault showing
  "Not configured".
- **Gmail token freshness.** The unread tile never reuses the stored
  `GMAIL_ACCESS_TOKEN` (expires ~hourly) — `fetchGmailUnreadCount` always calls
  `refreshAccessToken()` to mint a fresh one from the refresh token, and reports
  an honest `error` tile if the refresh or API call fails.
- **Phase B is genuinely key-gated.** Apollo / Local Falcon tiles read their key
  from `.env`; absent (the current reality) → "not configured"; present → a real
  health call decides ok/error. No invented pipeline counts. QuickBooks is
  deferred with a code comment, per the plan.
- **Failure isolation + bounded cost.** The three async tiles run under
  `Promise.all`, each catching its own errors, so one slow/broken provider can't
  break the others. With no external keys set, the route makes zero network
  calls; the panel fetches once on mount (no polling), so Gmail's 2-call refresh
  only happens on explicit load/refresh.
- **Auth + robustness.** `/api/tiles` is under `/api/` and not exempt →
  token-protected. The client guards a malformed payload (`Array.isArray`) so a
  non-conforming response renders an empty grid, never a `.map` crash (tested).

### Follow-up (honest boundary, not a defect)
- The Apollo (`/v1/auth/health`) and Local Falcon (`/v1/whoami`) endpoints are
  best-effort from public docs and **could not be verified** (no keys available
  to test). With a valid key, a wrong endpoint surfaces as an honest "error"
  tile — never fake data — but the exact health endpoint should be confirmed
  when Nick adds a key. Logged here so it isn't mistaken for verified.

### Lessons
- **A new self-contained panel that fetches on mount can break sibling view
  tests via the catch-all mock.** `JarvisHomePrimaryView.test.tsx` returns
  `jsonResponse({})` for unmatched URLs, so `/api/tiles` resolved to `{}` and
  `data.tiles` was `undefined`. The fix is defensive parsing in the component
  (`Array.isArray(data.tiles) ? … : []`) — good practice regardless, and it
  kept the existing test green without modifying it.

---

## Wave 8 — Hands-free voice loop — commits 46d18df, c0d1f6d

Adversarial review of the wave diff. **One real bug found and fixed; no others.**

### Real finding (FIXED in c0d1f6d)
- **Hard mute could hang the speak promise.** `speakJarvis` awaits the audio
  element's `ended`/`error` to resolve (so the continuous loop can re-arm after
  speech). `hardMute` calls `audio.pause()`, which fires neither — so the
  promise would never resolve, leaving `isSpeaking` stuck and any awaiting loop
  iteration hung. Fixed by also resolving on the `pause` event (idempotent
  cleanup), so a mute mid-utterance unwinds cleanly.

### What held up
- **Hard mute is genuinely hard.** `stopAllVoiceActivity` stops the recorder +
  mic tracks, the wake `SpeechRecognition`, the in-flight TTS audio element, and
  `speechSynthesis.cancel()`, and `isMutedRef`/`isContinuousModeRef` are set
  synchronously so `startCommandRecording` and `speakJarvis` both bail
  immediately — no race where a queued callback re-opens the mic after mute.
- **Loop can't run away.** Re-arming happens only through
  `maybeContinueLoop → startCommandRecording`, guarded by continuous + not-muted
  + tab-visible. Each cycle requires a real 7s recording + network round-trip,
  so even on repeated silence it's a paced listen loop, not a tight spin; mute
  or tab-blur ends it.
- **Background safety.** `visibilitychange`(hidden) and `blur` both stop the loop
  and disable continuous mode, so the mic is never left listening when the user
  leaves the tab.
- **Indicator is a pure function.** `deriveVoicePhase` (mute > speaking >
  thinking > listening > idle) is unit-tested and the only source of the
  indicator state, so the dot can't disagree with reality.

### Lessons
- **Promise-wrapping a media element must resolve on every terminal path** —
  `ended`, `error`, AND `pause` (an external stop). Awaiting only the
  happy-path event makes an external interrupt (mute) a silent hang. Stale-
  closure reads were avoided throughout by mirroring loop flags
  (`isMutedRef`/`isContinuousModeRef`) and the latest `startCommandRecording`
  into refs, since the async voice callbacks outlive the render that created
  them.
