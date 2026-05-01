# Swipe Retry Idempotency and Notification Dedupe

Branch: `fix/swipe-retry-idempotency-notification-dedupe`

2026-05-01 follow-up: `fix/event-lobby-swipe-idempotency` adds
`20260501224000_event_lobby_swipe_already_swiped.sql`, changing same-type
duplicate/no-op swipes from fresh-looking replay outcomes to explicit
`result/outcome = "already_swiped"`. The mutation and notification dedupe guard
from this stream remains in force; `swipe-actions` now also suppresses on
`duplicate: true` and logs the suppression reason. See
`docs/audits/event-lobby-swipe-idempotency-verification.md`.

## Problem

Streams 1-6 made the Event Lobby and Ready Gate backend contract authoritative. The remaining swipe-path risk was retry behavior: `event_swipes` already has a natural unique key, but `handle_swipe` used `ON CONFLICT DO NOTHING` without returning replay truth. A client/server retry could therefore receive a fresh-looking `vibe_recorded` or related outcome, and `swipe-actions` could emit duplicate user-visible notifications.

## Audit Note

Audited:

- `supabase/functions/swipe-actions/index.ts`
- canonical `handle_swipe` migrations, including:
  - `20260501092000_handle_swipe_presence_and_already_matched_session.sql`
  - `20260501180000_event_lobby_active_event_contract.sql`
- `event_swipes` uniqueness on `(event_id, actor_id, target_id)`
- video-session uniqueness and active-session conflict guards
- notification side effects in `swipe-actions`
- existing matching and Ready Gate regression tests
- web/native `swipe-actions` consumers

The canonical issue was SQL response truth plus edge notification handling, not client UI state.

## SQL/RPC Changes

Migration:

- `supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql`

The migration wraps public `handle_swipe(uuid, uuid, uuid, text)` and preserves:

- public signature
- `SECURITY DEFINER`
- fixed `SET search_path TO 'public'`
- Stream 1 active-event guard
- actor auth and registration checks
- target admission check
- block/report/hidden/discoverability checks
- existing successful delegated happy paths

The natural idempotency key is:

- `event_id`
- `actor_id`
- `target_id`

The wrapper serializes the natural key with an advisory transaction lock, reads the existing `event_swipes` row before delegation, and returns replay/conflict truth before any delegated super-vibe cap accounting, match/session creation, queue creation, or notification-triggering outcome.

## Idempotency Behavior

Same-type replay:

- does not insert another `event_swipes` row
- does not create/reuse another Ready Gate/session as a fresh outcome
- does not deduct or count super-vibe-like accounting a second time
- does not trigger notification side effects
- returns `result: "already_swiped"` / `outcome: "already_swiped"` when no existing active mutual session is present
- returns additive markers:
  - `duplicate: true`
  - `idempotent: true`
  - `replay: true`
  - `existing_swipe_type`
  - `requested_swipe_type`
  - `notification_suppressed: true`
  - `dedupe_reason`

Different-type replay:

- does not mutate
- does not create a match/session
- does not charge/count super-vibe again
- does not send notifications
- returns explicit conflict truth:
  - `success: false`
  - `result: "swipe_already_recorded"`
  - `error: "swipe_already_recorded"`
  - `existing_swipe_type`
  - `requested_swipe_type`
  - `idempotent: true`
  - `replay: true`
  - `notification_suppressed: true`
  - `dedupe_reason: "swipe_type_conflict"`

If a same-type replay already has an active mutual `video_sessions` row, the wrapper returns `already_matched` with the existing session id and replay markers. This preserves the client recovery path without making the replay look like a newly created match.

## Edge Function Changes

Changed:

- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`

`swipe-actions` now suppresses notification side effects when the SQL result is replay/idempotent/already-recorded/conflict or inactive-event truth.

Suppression conditions include:

- `duplicate: true`
- `notification_suppressed: true`
- `idempotent: true`
- `replay: true`
- `result/outcome/error = "already_swiped"`
- `result/error = "swipe_already_recorded"`
- `result/error = "event_not_active"`

Fresh successful outcomes still send existing notifications for:

- `match`
- `match_queued`
- `super_vibe_sent`
- `vibe_recorded`

No broad `send-notification` rewrite was required.

The shared swipe payload type now tolerates the additive replay fields and treats `already_swiped` and `swipe_already_recorded` as no-advance deck outcomes.

## Observability

Duplicate notification suppression is logged through the existing `lifecycle.swipe_actions` console lifecycle event with safe context:

- `event_id`
- `session_id`
- `user_id`
- `target_id`
- `swipe_type`
- `result`
- `dedupe_reason`

No profile names, media URLs, messages, or sensitive profile payloads are logged.

## Tests Added

- `shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`

Coverage:

- Stream 7 migration exists and sorts after Stream 3
- `handle_swipe` signature/security/search-path are preserved
- existing-swipe detection happens before delegated side effects
- same-type replay returns idempotent/replay/notification-suppressed markers
- different-type replay returns already-recorded conflict markers
- duplicate super-vibe cannot reach delegated cap/accounting twice
- `swipe-actions` suppresses replay/conflict/inactive notifications
- fresh notification paths remain present
- production validation SQL is read-only/catalog-safe
- Streams 1-6 artifacts remain present
- no new env vars or `expo-av` usage

## Production Validation

Added:

- `supabase/validation/swipe_retry_idempotency_notification_dedupe.sql`

The validation file is read-only/catalog-safe. It checks:

- canonical `handle_swipe` signature
- `SECURITY DEFINER`
- fixed search path
- duplicate existing-swipe detection before delegation
- replay/conflict markers
- active-event guard preservation
- renamed base function is not executable by `anon` or `authenticated`

## Deploy Requirements

- Supabase migration deploy: required after PR merge
- Edge Function deploy: `swipe-actions` only
- `send-notification` deploy: not required
- Environment variables: none
- Docker/local Supabase: not used
- Native modules: none

## Remaining Deferred Work

- Broader realtime subscription tightening
- Premium/credits observability
- Full native video-date polish beyond Ready Gate handoff
- Physical-device Ready Gate/native QA
- Broader screenshot-led native visual parity
