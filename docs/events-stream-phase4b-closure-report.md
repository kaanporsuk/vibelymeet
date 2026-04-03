# Events Stream Phase 4B Closure Report

Date: 2026-04-04
Scope: final live-state audit for active events flow after merged/deployed Phases 1, 1.1, 2, 3, 4A.

## Closure Verdict
Ready to close events stream after one final ship-now fix in this pass:
- Mobile event status bootstrap now uses server-owned `update_participant_status` via `updateParticipantStatus(eventId, 'browsing')`.

## Ship-Now Fix Applied (Phase 4B)
- `apps/mobile/lib/eventStatus.ts`
  - Removed direct client-owned `queue_status='browsing'` write.
  - Replaced with server-owned transition call: `updateParticipantStatus(eventId, 'browsing')`.
  - Heartbeat remains activity-only (`last_active_at`).

## Canonical Active Contracts
- Discovery + detail + registration truth
  - registration state is read from `useIsRegisteredForEvent` snapshots and refreshed post-action.
  - paid path remains webhook-settled; success surfaces poll briefly for final `admission_status` truth.
- Lobby + deck + swipes
  - deck source: `get_event_deck` RPC.
  - swipes: `swipe-actions` edge function -> `handle_swipe` contract.
  - queue activation: `drain_match_queue` + realtime transition into Ready Gate.
- Ready Gate
  - transitions are server-owned through `ready_gate_transition`.
  - terminal callback dedupe is active on web + native.
- Video Date
  - transitions are server-owned through `video_date_transition` (`enter_handshake`, `vibe`, `complete_handshake`, `end`, reconnect actions).
  - reconnect grace/expiry is server-owned and polled via `sync_reconnect`.
- Post-date return
  - survey path returns users to lobby/event flow with status normalization (`browsing`) and queue drain hook.

## Intentionally Deprecated (Compatibility Only)
- Legacy queue-era DB surfaces are frozen compatibility only and marked deprecated in migration contract:
  - `join_matching_queue`
  - `find_video_date_match`
  - `leave_matching_queue` (retained compatibility path, deprecated marker)
- Active product path does not rely on these for matchmaking progression.

## Material Findings Status
- Resolved in this pass:
  - Client-owned mobile queue status bootstrap write (now server-owned).
- Remaining findings:
  - No additional high-confidence ship-now blockers found on active events path.
  - Legacy alias compatibility (`pendingMatch`) is retained intentionally and can remain document-only.

## Out of Scope / Future Work (Outside Events Stream)
- Optional cleanup of non-primary fallback surfaces (home-level emergency/session cleanup flows) to remove residual direct row writes where server transition already exists.
- Cosmetic parity polish and non-state-affecting UX text harmonization between web/native.
- Broader architecture cleanup beyond active events path hardening.
