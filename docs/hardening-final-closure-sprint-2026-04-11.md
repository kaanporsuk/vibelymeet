# Final hardening closure sprint — 2026-04-11

**Branch:** `hardening/final-closure-sprint`  
**Purpose:** Isolate hardening from unrelated product edits, reduce ESLint noise safely, refresh high-authority docs, and record proof boundaries honestly.

## Phase 0 — Branch hygiene

- **Unrelated pre-existing edits** were **stashed** before work:
  - `apps/mobile/app/(tabs)/events/index.tsx`
  - `apps/mobile/app/(tabs)/index.tsx`
  - `src/components/events/EventsFilterBar.tsx`
  - `src/pages/Dashboard.tsx`
  - `src/pages/Events.tsx`
  - `docs/golden-path-regression-runbook.md`
  - `docs/native-complete-sitemap.md`
  - `shared/eventTimingBuckets.ts` (untracked)
- **Restore:** `git stash pop` (resolve conflicts if any) after merging this branch.

## Phase 1 — ESLint

- **Before:** 274 warnings (full `npm run lint`, 0 errors).
- **After:** 268 warnings.
- **Representative fixes:** `email-verification` Edge Function `catch (unknown)`; `EventLobby` removed unnecessary `deckNonce` memo dep; `ProfileStudio` replaced `any` with `ProfileData`-aligned fields; `SwipeableCard` drag handler typed `unknown` instead of `any`.

## Phase 2 — Doc / context cleanup

- **`docs/active-doc-map.md`** — Notes that `_cursor_context/*.md` may lag; points to hardening closure docs.
- **`_cursor_context/vibely_rebuild_runbook.md`** — Banner: removed pages, not Lovable-first hosting.
- **`docs/vibely-canonical-project-reference.md`** — New subsection under Events: **email verification / Apple canonical email / no inbox-first OTP gate** (code-aligned; device QA not re-run here).

## Phase 3 — Apple / email verification

- **Code-verified:** `resolveCanonicalAuthEmail` includes Apple `identity_data.email`; `email-verification` send path requires `requestedEmail === canonicalAuthEmail`.
- **Runtime QA:** **Not executed** in this environment (no Sign in with Apple device/browser session). Status: **code-verified; runtime proof pending.**

## Phase 4 — Browser / authenticated proof

- **`docs/browser-auth-runtime-proof-results.md`** — Still **historical** to 2026-04-08 branch; this sprint did not refresh Playwright evidence.
- **`docs/rebuild-rehearsal-log.md`** — See §10 for this sprint’s commands.

## Phase 5 — Structural audit

- **No additional file removals** in this sprint (prior pass already removed `VideoLobby` / legacy `ReadyGate` page).

## Phase 6 — Validations

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS (0 errors, 268 warnings) |

## Remaining risks

- Large ESLint warning debt outside touched files.
- Stashed feature branch may need manual merge with `hardening/final-closure-sprint`.
- Apple Sign-In + email OTP **not** device-tested in CI.
