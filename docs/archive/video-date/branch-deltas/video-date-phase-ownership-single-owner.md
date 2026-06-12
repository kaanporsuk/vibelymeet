# Video Date Phase Ownership Single Owner

Date: 2026-06-11

## Summary

This pass tightens the Video Date phase ownership model around the current golden flow:

`Lobby swipe/match -> Ready Gate -> prepare_date_entry -> /date/:sessionId -> Daily join -> entry/date timer -> post-date survey`

The implementation removes the remaining native lobby/pre-navigation prepare owners so each phase has one active owner:

- Event Lobby owns deck, swipe, active-session discovery, Ready Gate mounting, and read-only route convergence.
- Ready Gate overlay and standalone `/ready/[id]` own `prepare_date_entry` before date handoff.
- `/date/[id]` owns Daily token acquisition/join and explicitly named recovery prepares for missing handoff or token-refresh room recovery.

## Source Changes

- `apps/mobile/app/event/[eventId]/lobby.tsx`
  - Removed direct `prepareVideoDateEntry` import and lobby-owned prepare calls.
  - `ready_gate_both_ready` broadcasts now schedule lobby/deck convergence refresh only; they no longer navigate directly from the lobby.
  - Active-date and survey recovery still route through `navigateToDateSession`, but with a read-only startable gate.

- `apps/mobile/lib/videoDateEntryStartable.ts`
  - Converted `ensureVideoDateStartableBeforeNavigation` to a read-only router. It can return date/ready/survey/lobby/ended recommendations and can recognize a fresh prepared handoff, but it no longer calls `prepare_date_entry`.

- `src/hooks/useVideoCall.ts`, `apps/mobile/lib/videoDateApi.ts`, `apps/mobile/app/date/[id].tsx`
  - Date-route fallback prepares are now wrapped/named as recovery paths.
  - Recovery source strings distinguish missing prepared handoff and token-refresh room recovery from normal Ready Gate handoff.

- `apps/mobile/lib/videoDateSessionRow.ts`
  - Added a native counterpart to the web canonical `video_sessions` row reader.
  - Routed native date session/truth fallback reads through the single projection owner.
  - Left native terminal survey reads as explicit narrow survey-truth projections.

## Existing Already Satisfied

Ready Gate entry-proof demotion/removal was already present on current source via `supabase/migrations/20260611091620_remove_ready_gate_entry_proof.sql` and `shared/matching/readyGateEntryProofRemovalContracts.test.ts`; no new migration was needed.

## Verification

Passed:

- `npm run typecheck`
- `npm run lint`
- `npm run test:event-lobby-regression`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`

Focused contracts also passed for the touched native Ready Gate, Daily-room, session-row, surface-owner, and native physical-device readiness assertions.

## Proof Boundary

This is a source/test ownership cleanup only. It does not prove Video Date product acceptance. Final acceptance still requires a fresh disposable two-user production-like run through mutual swipe, Ready Gate, exactly one prepare handoff, Daily media, date end, and persisted `date_feedback`.
