# Ready Gate Single Prepare-Owner Consolidation

Date: 2026-06-10
Branch: `codex/ready-gate-single-prepare-owner`

## Goal

Simplify Ready Gate entry ownership so there is one canonical handoff path into Video Date. Golden flow preserved: Event Lobby -> mutual match -> Ready Gate -> both_ready -> `prepare_date_entry`/`prepare_entry` -> `/date/:sessionId`. Ready Gate itself and the Daily room creation done by `prepare_date_entry` are untouched.

## Problem (before)

`prepare_date_entry` was owned in multiple competing places per platform:

- **Web**: `EventLobby.tsx` ran its own `prepareVideoDateEntry` via `prepareAndNavigateToDateSession`, fired from a `ready_gate_both_ready` realtime broadcast — racing the mounted `ReadyGateOverlay`, which also owns prepare on `both_ready`. The standalone `/ready/:id` (`ReadyRedirect`) mounts the same overlay.
- **Native**: the lobby's `navigateToDateSession` ran `prepareVideoDateEntry` again after the overlay had already prepared and called `onNavigateToDate` — a double prepare.

On web, the overlay's `exhausted` / `exception` prepare-failure paths blind-navigated to `/date` ("date_owned"), which could cause `/date`<->lobby bounce churn for sessions that were not actually date-routeable.

## Change (single prepare-owner)

Canonical owner per platform: the **Ready Gate overlay** (mounted by the lobby and by the standalone `/ready/:id` host) owns `prepare_date_entry`. The lobby only mounts/routes.

- **Web `src/pages/EventLobby.tsx`**: removed `prepareAndNavigateToDateSession` (its own prepare + retry/catch + failure date-nav), the `prepareNavigationInFlightRef` latch, and the `prepareVideoDateEntry` import. The `reconcileLobbyBroadcastEvent` handler no longer prepares on a `ready_gate_both_ready` broadcast; it only runs the existing convergence refresh, after which the mounted overlay observes `both_ready` and owns the single prepare/navigate. The lobby still dedupes date *navigation* (`claimDateNavigation` / `dateNavigationSessionIdRef`).
- **Native `apps/mobile/app/event/[eventId]/lobby.tsx`**: the overlay handoff now passes `{ skipPrepare: true }` to `navigateToDateSession`, so the lobby does not re-run prepare after the overlay already did. `navigateToDateSession`'s `startable` (routeable-truth) gate still runs before any `/date` navigation. Other (non-overlay) entry callers keep their existing prepare behavior.
- **Web `src/components/lobby/ReadyGateOverlay.tsx`**: the `exhausted` and `catch` (exception) prepare-failure handoffs now navigate to `/date` only when `isRouteableVideoDateTruth(latestTruth)` proves the session date-routeable (mirroring the overlay's existing retryable-failure gate and native's behavior). Otherwise the overlay surfaces a failed/ended state instead of blind-navigating. Native already routed these through the lobby's `startable` gate, so no native overlay change was needed.

## What is NOT changed

- Ready Gate UI/overlay is preserved (not removed).
- `prepare_date_entry` / `prepareVideoDateEntry` remain the only route into `/date/:sessionId`.
- Daily room creation in `prepare_date_entry` is untouched.
- The standalone `/ready/:id` host (web `ReadyRedirect`, native `app/ready/[id].tsx`) stays a canonical host/owner; deep links still work.
- Non-Ready-Gate entry paths (deep-link/survey recovery) keep their existing `navigateToDateSession` prepare behavior.

## Tests / docs updated

- `shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts` — the date-owned-failure test now asserts the single-owner invariant (lobby is not a prepare owner; overlay gates date handoff on routeable truth).
- `shared/matching/videoDateEndToEndHardening.test.ts` — web lobby prepare-ownership / prepare-dedup / `READY_GATE_HANDOFF_RECOVERY` assertions updated to single-owner.
- `shared/matching/realtimeSubscriptionTightening.test.ts` — web lobby no longer asserts `prepareNavigationInFlightRef` / direct `prepareVideoDateEntry`.

## Verification

- `npm run typecheck` (web core + app + mobile) — pass.
- `npm run lint` — pass.
- `npm run test:video-date:red-flags`, `npm run test:video-date-v4`, `npm run test:event-lobby-regression` — pass.
- Directly affected suites pass: `readyGatePartialReadyDefinitiveClosure`, `videoDateEndToEndHardening`, `nativeReadyGateParityContract`, `videoDateLatestFailureSurfaceOwnerContracts`, `realtimeSubscriptionTightening`.
- Broad `shared/matching` + `shared/observability` sweep: the 13 still-red files were confirmed **pre-existing** failures on clean `main` (stash baseline), unrelated to this change.

## Proof boundary

This is a client ownership simplification, not Video Date product acceptance. No two-user end-to-end run was possible in this environment. Acceptance still requires a real run: direct mutual swipe -> canonical Ready Gate -> both tap ready -> one `prepare_date_entry` -> `/date/:sessionId` -> survey, plus a `/ready/:id` deep-link check.
