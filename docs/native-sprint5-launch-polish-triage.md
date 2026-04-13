# Native Sprint 5 — launch-polish triage

**Branch:** `native/sprint5-launch-polish-triage`  
**Purpose:** Static/code-path triage of launch-critical native flows (no device run). Severity reflects **repo + operator** reality: hard launch blockers are mostly **external** (see `docs/native-final-blocker-matrix.md`).

---

## 1. Triage matrix (launch-critical flows)

| Area | Blocker | Important | Defer |
|------|---------|-----------|-------|
| **Auth entry** | Provider/config: RevenueCat, OneSignal, EAS secrets (**KD/KB/KV**) | **Refresh entry state before routing** after password reset success (avoids gate/index churn) | Deep link edge cases already covered Sprint 3 |
| **Onboarding handoff** | — | **Refresh entry state before** `/(tabs)` / events after celebration (aligns with `EntryStateRouteGate`) | Extra celebration copy tweaks |
| **Dashboard / home** | — | Offline/realtime already surfaced (`OfflineBanner`, errors) | Visual polish |
| **Events list + detail + lobby** | — | Existing `ErrorState`, registration flows | Filter sheet micro-copy |
| **Matches list** | — | Empty states present | Spotlight animations |
| **Chat thread** | — | Invalid route + load errors use `ErrorState` | Read receipt edge cases |
| **Ready gate** | — | Stale/invalid deep links use dialog + `router.replace` | — |
| **Video date** | Daily device validation **KV** | In-call extras parity closed Sprint 4 | In-call extras polish |
| **Post-date survey** | — | `PostDateSurvey` verdict error paths | Survey skip analytics |
| **Profile** | — | — | Studio polish |
| **Settings** | — | Credits / account parity | — |

**Legend**

- **Blocker:** Prevents safe launch validation or breaks a P0 path without workaround (here: mostly **operator/dashboard**, not missing app code).
- **Important:** Wrong UX, confusing loop, or rare race that affects real users; fixable client-side with tight scope.
- **Defer:** Polish, non-P0, or requires device-only repro.

---

## 2. Issues implemented this sprint (chosen)

| Issue | Severity | Change |
|-------|----------|--------|
| Post-onboarding “Go to Now” / “Explore events” could navigate before `entryState` matched `complete` in edge races | **Important** | `await refreshEntryState()` then `router.replace` |
| Post–password-reset navigation to `/` without fresh entry resolution | **Important** | `refreshEntryState()` before `router.replace('/')` (auto + “Continue now”) |

No backend, migration, or observability changes.

---

## 3. Explicitly deferred (not in this pass)

- RevenueCat / OneSignal / EAS / store: **KD/KB/KV** (see `docs/native-external-setup-checklist.md`).
- Bunny CDN 404 / photo display: provider config; URL contract unchanged.
- Reset-password **UX parity** with web (full flow): documented as non-blocker in `docs/native-final-blocker-matrix.md`.
- Dedicated vibe-failure toast (video date): deferred Sprint 4 notes.
- Banner overlap on video date: cosmetic.

---

## 4. Merge evidence

- Validation: `npm run typecheck` (repo script) — run before merge.
- Files: see PR description / git diff for this branch.

---

## 5. Canonical doc alignment

- `docs/native-sprint0-architecture-lock.md` — onboarding / auth handoff note updated.
- This file — single triage artifact for Sprint 5 polish pass.
