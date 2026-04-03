# Events Hardening — Phase 1 + Phase 1.1 Release Audit

Date: 2026-04-04

## Scope

Correctness hardening only for event presence, ready-gate/date cleanup ownership, and legacy leave-path dependency removal.

## Files changed

- `supabase/migrations/20260404183000_phase1_presence_atomic_cleanup.sql`
- `supabase/migrations/20260404191500_phase1_1_true_lobby_foreground.sql`
- `src/hooks/useEventStatus.ts`
- `src/pages/EventLobby.tsx`
- `src/pages/VideoDate.tsx`
- `apps/mobile/lib/eventStatus.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/date/[id].tsx`
- `src/integrations/supabase/types.ts`
- `_cursor_context/vibely_migration_manifest.md`
- `_cursor_context/vibely_schema_appendix.md`
- `_cursor_context/vibely_machine_readable_inventory.json`

## Migrations added

- `20260404183000_phase1_presence_atomic_cleanup.sql`
- `20260404191500_phase1_1_true_lobby_foreground.sql`

## RPC changes

Changed:
- `handle_swipe(p_event_id, p_actor_id, p_target_id, p_swipe_type)`
  - Immediate match now requires queue status eligibility plus 60s recency proof from `last_lobby_foregrounded_at`.
- `drain_match_queue(p_event_id)`
  - Promotion from queued requires the same 60s recency rule.
- `ready_gate_transition(p_session_id, p_action, p_reason?)`
  - `forfeit` is server-atomic for video session + participant linkage cleanup.
- `video_date_transition(p_session_id, p_action, p_reason?)`
  - Canonical date-end cleanup owns participant/session teardown in active path.
- `update_participant_status(p_event_id, p_status)`
  - No longer updates `last_lobby_foregrounded_at`; status/activity only.

Added:
- `mark_lobby_foreground(p_event_id)`
  - Auth-bound foreground-proof stamp for caller/event row (`last_lobby_foregrounded_at`, `last_active_at`).

## Behavior summary (before -> after)

- Immediate/queued decision:
  - Before: queue status only.
  - After: queue status + true lobby foreground recency (<= 60s).

- Ready-gate forfeit:
  - Before: split cleanup between session transition and client follow-up writes.
  - After: server-atomic cleanup in `ready_gate_transition('forfeit')`.

- Date end:
  - Before: active flow still used `leave_matching_queue` in client paths.
  - After: active web/mobile paths use backend-owned `video_date_transition('end')`; no active client dependency on `leave_matching_queue`.

- Foreground proof:
  - Before: could be stamped via generic status/browsing writes.
  - After: stamped only by `mark_lobby_foreground` from true lobby surfaces (web route+visibility gated, native focus+AppState gated).

## Verification checks

- No active client callsites to `leave_matching_queue` in `src/` or `apps/mobile/`.
- `last_lobby_foregrounded_at` is not stamped from generic status hooks.
- No paid-registration/webhook-settlement behavior change.
