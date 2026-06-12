# Video Date Client Stuck Observability

Branch: `feat/video-date-client-stuck-observability`

## Problem

Sparse client-perceived stuck states in the Vibe Video Date journey were only visible through volatile client analytics and breadcrumbs. Operators needed durable, SQL-backed evidence for slow handoff, prepare-entry failure, Daily joined-confirmation failure, peer-missing terminal states, and native background recovery expiry/failure.

## Approach

This branch adds a participant-authenticated, allowlisted RPC that writes sanitized rows into the existing `event_loop_observability_events` table. It does not change Video Date state transitions or user-facing flow behavior.

## Files Changed

- `supabase/migrations/20260501151000_video_date_client_stuck_observability.sql`
- `supabase/validation/video_date_end_to_end_hardening.sql`
- `shared/observability/videoDateClientStuckObservability.ts`
- `shared/observability/videoDateClientStuckObservability.test.ts`
- `supabase/functions/_shared/admin-video-date-ops.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- Web/native Ready Gate and Video Date call sites for sparse emitters

## Schema / RPC Changes

Adds `public.record_video_date_client_stuck_observability(uuid,text,jsonb,integer)`.

- `auth.uid()` is the only accepted actor.
- The caller must be `participant_1_id` or `participant_2_id` on the target `video_sessions` row.
- Unknown event names return `unknown_event_name` and do not insert.
- Payload details are allowlisted and sanitized server-side.
- Rows are stored as `operation = 'video_date_client_stuck_state'`.
- A partial unique index dedupes one row per `(session_id, actor_id, operation, reason_code)`.
- `public.get_video_date_session_timeline(uuid)` includes the new operation.

Allowed event names:

- `ready_gate_handoff_slow`
- `prepare_date_entry_failed`
- `daily_join_confirmation_failed`
- `peer_missing_terminal`
- `native_background_recovery_started`
- `native_background_recovery_failed`
- `native_background_expired`

## Supabase Deploy Requirement

Required: yes.

Deploy this migration after merge:

```sh
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Expected linked project: `schdyxcunwcvddlcshwd`.

## Edge Function Deploy Requirement

Not required. The existing `admin-video-date-ops` function already renders timeline rows generically; this branch only changes shared tests for that function.

## Web / Native Deploy Requirement

Web and native code emit the new RPC events. Ship through the normal app deployment/release process after merge.

## Manual QA

1. Use two test users in the same live event.
2. Trigger Ready Gate both-ready and delay prepare-entry beyond the slow threshold.
3. Confirm an admin timeline row with `operation = video_date_client_stuck_state` and `reason_code = ready_gate_handoff_slow`.
4. Force prepare-entry failure and confirm `prepare_date_entry_failed`.
5. Join Daily with one participant only and wait for the peer-missing terminal watchdog; confirm `peer_missing_terminal`.
6. On native, background during a date and let the grace window expire; confirm `native_background_expired`.
7. Verify row detail does not include tokens, URLs, room names, device identifiers, phone/email, raw provider payloads, or free-form error text.

## Rollback Plan

If the RPC causes unexpected insert pressure or policy issues, ship a forward migration that revokes `EXECUTE` from `authenticated` on `record_video_date_client_stuck_observability`. Client calls are fail-soft and will not affect the Video Date flow.

## Validations

To be recorded before merge:

- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/observability/videoDateOperatorMetrics.test.ts`
- `npx tsx supabase/functions/_shared/admin-video-date-ops.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `cd apps/mobile && npm run rc-smoke`
- `npx supabase db push --linked --dry-run`
