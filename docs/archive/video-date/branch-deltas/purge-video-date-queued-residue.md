# Purge Video Date Queued-State Residue

Date: 2026-06-11
Branch: `codex/purge-video-date-queued-residue`

## Scope

Physically removes the remaining Video Date queued-state schema/source residue after the match queue, queue drain, queue hint, and queued auto-promotion behavior had already been removed.

Golden flow preserved: mutual swipe -> Ready Gate session created directly as `ready` -> both ready -> `prepare_date_entry` / `prepare_entry` -> `/date/:sessionId` or native date -> Daily media -> post-date survey -> persisted `date_feedback`.

## Live Preconditions

Linked read-only checks against project `schdyxcunwcvddlcshwd` found:

- `video_sessions.ready_gate_status = 'queued'`: 0 rows
- `video_sessions.queued_expires_at IS NOT NULL`: 0 rows
- `event_registrations.queue_status = 'queued'`: 0 rows

Generic non-Video-Date queued statuses remain outside this cleanup.

## Implemented

- Forward migration `supabase/migrations/20260611104830_purge_video_date_queued_residue.sql`:
  - guards against applying while queued production rows still exist;
  - drops Video Date queue indexes and `video_sessions.queued_expires_at`;
  - replaces `video_session_blocks_global_active_conflict(...)` without `p_queued_expires_at`;
  - rewrites active swipe, Ready Gate transition, terminalization, and stale-cleanup functions so no active public function/view depends on `queued_expires_at`;
  - removes Video Date queue-fairness views/RPC/helper and related Phase 8 queue-fairness/drain gates;
  - leaves direct mutual swipe -> Ready Gate `ready` creation intact.
- The migration is applied to linked project `schdyxcunwcvddlcshwd`; post-apply dry-run reports the remote database is up to date.
- Web/native Ready Gate fallbacks no longer use `queued` as a pre-hydration placeholder.
- Operator metrics/admin UI no longer request or render Video Date queue-fairness.
- Contracts now assert physical queue-residue absence rather than preserving the old v6 queue-fairness surface.
- Linked Supabase types were regenerated; generated `video_sessions` types no longer expose `queued_expires_at`.

## Preserved

- Event Lobby deck/swipe.
- Direct reciprocal swipe into Ready Gate.
- Ready Gate `ready` / `ready_a` / `ready_b` / `both_ready` lifecycle.
- `prepare_date_entry` / `prepare_entry`, Daily media, date end, post-date survey, and `date_feedback` persistence.
- Generic queued vocabularies outside the removed Video Date match queue/drain/rescue subsystem.

## Verification

Passed for this branch:

- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date-v4`
- `npm run test:video-date:red-flags`
- `npm run test:event-lobby-regression`
- `npm run regen:supabase-types`
- `supabase db push --linked --dry-run`
- `supabase db lint --linked --schema public --fail-on error`
- `supabase db advisors --linked --level error --fail-on error`
- `git diff --check`
- active source scan for `queued_expires_at`, Video Date queue-fairness, `match_queued`, `drain_match_queue`, queue-drain, and queued-rescue residue outside tests/generated types
- linked catalog marker query for absent `video_sessions.queued_expires_at`, absent queue-fairness views/RPC/helper, absent old 13-argument conflict helper, and zero public function/view definitions containing the removed residue

## Proof Boundary

This is schema/source/cloud cleanup evidence only. It does not prove Video Date product acceptance. Acceptance still requires a fresh disposable two-user production-like run from mutual swipe through both persisted `date_feedback` rows.
