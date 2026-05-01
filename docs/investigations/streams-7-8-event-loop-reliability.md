# Streams 7-8 Event-Loop Reliability Investigation

Date: 2026-05-01

Branch: `docs/investigate-streams-7-8-event-loop-reliability`

Base inspected: `main` at `9f02cf8be` (`docs: close Streams 4-6 Ready Gate client parity findings`)

## Executive Verdict: PASS

Streams 7-8 artifacts are present on `main`, and the inspected code preserves the intended event-loop reliability contract:

- swipe retries are natural-key idempotent before delegated business effects
- duplicate/replay/conflict/inactive swipe outcomes suppress notifications
- current `handle_swipe` later wrappers preserve Stream 7 behavior
- web/native realtime discovery uses participant-scoped `video_sessions` bindings instead of broad event-level filters
- Ready Gate session listeners remain session-id scoped
- client fallbacks, latches, and backend prepare-entry gates remain in place
- no direct client writes to Ready Gate-owned `video_sessions` or `event_registrations` lifecycle fields were found

No material defect, broad undocumented event-level subscription, or material validation failure was found.

## Artifacts Inspected

Stream 7:

- `supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql`
- `supabase/validation/swipe_retry_idempotency_notification_dedupe.sql`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`
- `shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`
- `docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md`

Stream 8:

- `src/pages/EventLobby.tsx`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useActiveSession.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/useActiveSession.ts`
- `shared/matching/realtimeSubscriptionTightening.test.ts`
- `docs/branch-deltas/fix-realtime-subscription-tightening.md`

Cross-stream and later-overwrite context:

- `supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql`
- `supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql`
- `src/hooks/useSwipeAction.ts`
- `shared/observability/eventLobbyObservability.ts`
- `src/hooks/useReadyGate.ts`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- Stream 1-6 tests/docs/migrations referenced by the requested carry-forward validations

## Idempotency Findings

PASS: `handle_swipe(uuid, uuid, uuid, text)` keeps its public signature, `SECURITY DEFINER`, and `SET search_path TO 'public'`.

PASS: The Stream 7 natural idempotency key is explicitly `(event_id, actor_id, target_id)`. The migration serializes that key with `pg_advisory_xact_lock(hashtextextended('handle_swipe_idempotency:' || ...))`.

PASS: Existing swipe detection occurs before delegated mutation side effects. The wrapper selects the existing `event_swipes` row with `FOR UPDATE` before calling `handle_swipe_20260501210000_idempotency_base`.

PASS: Current main includes later `handle_swipe` wrappers (`20260501224000_event_lobby_swipe_already_swiped.sql` and `20260501225000_event_lobby_ready_queue_contract.sql`) that preserve the Stream 7 guard. The latest wrapper still checks active-event truth, locks/serializes participants, locks the natural key, reads the existing swipe, and only then delegates to the base mutation path.

PASS: Same-type duplicate swipes now return explicit no-op replay truth on current main: `outcome/result = already_swiped` with `duplicate`, `idempotent`, `replay`, `notification_suppressed`, `existing_swipe_type`, `requested_swipe_type`, and `dedupe_reason`.

PASS: Same-type replay with an existing active mutual session returns `already_matched` with the existing `video_session_id` and replay/no-notify markers, preserving recovery without making the retry look like a new match.

PASS: Different-type replay returns `swipe_already_recorded` conflict truth with replay/no-notify markers.

PASS: Duplicate `super_vibe` cannot reach cap/accounting twice by inspection. The replay guard returns before the delegated base path where first-time cap/session/queue mutation can run.

PASS: Match/session/queue creation remains delegated only for fresh accepted swipes.

PASS: The Stream 1 active-event guard remains preserved. Current canonical wrappers call `get_event_lobby_active_state(p_event_id, now())`, hold the event row stable, and return `event_not_active` with `notification_suppressed` before replay/delegation when inactive.

PASS: The production validation file is catalog/read-only safe and checks the canonical signature/security/search path, ordering of active/replay/delegation logic, replay markers, and renamed-base execute privileges.

## Duplicate Notification Findings

PASS: `swipe-actions` accepts additive replay fields (`duplicate`, `idempotent`, `replay`, `notification_suppressed`, `dedupe_reason`, `existing_swipe_type`, `requested_swipe_type`).

PASS: Notification suppression covers explicit server flags and duplicate outcomes:

- `duplicate: true`
- `idempotent: true`
- `replay: true`
- `notification_suppressed: true`
- `already_swiped`
- `swipe_already_recorded`
- `event_not_active`
- blocked/reported/account-paused/target-unavailable/active-session-conflict outcomes

PASS: Inactive-event outcomes do not send notifications because they enter the suppression branch before any `send-notification` invocation.

PASS: Replay/idempotent/conflict outcomes are logged as suppressed and do not reach fresh notification branches.

PASS: Fresh notification paths remain for `match`, `match_queued`, `super_vibe_sent`, and `vibe_recorded`.

PASS: Stream 7 changed only `swipe-actions`, shared matching payload code, SQL migration, validation SQL, test, and branch delta doc. `send-notification` was not broadly rewritten.

## Realtime Subscription Findings

PASS: No broad event-level `video_sessions` realtime filter (`event_id=eq...`) remains in the audited web/native Event Lobby, match queue, or active-session discovery surfaces.

PASS: Discovery surfaces subscribe to both participant columns where Supabase Realtime cannot express the participant OR in one filter:

- `participant_1_id=eq.<current user>`
- `participant_2_id=eq.<current user>`

PASS: Event/session validation runs before side effects. Handlers re-check `session.event_id`, participant membership, and session id before opening Ready Gate, navigating, queue-draining, refreshing deck state, or showing terminal/TTL UI.

PASS: Session-id scoped Ready Gate listeners remain unchanged in web/native Ready Gate surfaces (`id=eq.<sessionId>`).

PASS: Own `event_registrations` subscriptions remain present and scoped by `profile_id=eq.<current user>`.

PASS: Polling/refetch/visibility/AppState fallbacks remain:

- web visibility refetch and interval reconciliation
- web `drain_match_queue` and queue count refreshes
- native `AppState` foreground refetch
- native interval reconciliation
- Ready Gate overlay sync/poll/reconcile paths

PASS: Duplicate navigation and terminal latches remain session-scoped and reset on session id changes. Web and native overlays reset their navigation, terminal, and suppression refs when `sessionId` changes; standalone native `/ready/[id]` also resets session latches by `sessionId`.

PASS: Stream 8 did not introduce backend/RPC/migration changes. The Stream 8 commit touched only client, test, and branch-delta files, and no `realtime_subscription_tightening` migration or validation SQL exists.

## Cross-Stream Side-Effect Findings

PASS: Replayed swipes cannot produce duplicate realtime side effects that bypass client latches by code inspection. Backend replay returns no-new-business-effect/no-notify outcomes, shared payload helpers classify those outcomes as duplicates/no-advance, and web/native latches suppress duplicate Ready Gate/date navigation.

PASS: Participant-scoped realtime still permits queued promotion discovery. `useMatchQueue`, web Event Lobby, native Event Lobby, and active-session hooks listen on both participant columns and keep queue drain/refetch fallbacks.

PASS: Idempotent swipe results are treated as no-advance/no-notify outcomes in shared payload types. `LOBBY_SWIPE_NO_ADVANCE_RESULTS` includes `already_swiped` and `swipe_already_recorded`; observability helpers classify duplicate/idempotent/replay outcomes and suppress notification-attempt reporting.

PASS: Web and native consumers tolerate additive replay fields. The shared type includes the additive fields, `swipe-actions` preserves them in responses, web `useSwipeAction` handles `already_swiped` quietly, and native lobby logs duplicate suppression while avoiding deck advancement for no-advance outcomes.

PASS: No direct client writes to Ready Gate-owned `video_sessions` or `event_registrations` lifecycle fields were found in the audited web/native realtime surfaces.

PASS: No `expo-av` import or require was found.

## Validation Results

Passed:

- `npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`
- `npx tsx shared/matching/realtimeSubscriptionTightening.test.ts`
- `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
- `npx tsx shared/matching/readyGateTerminalUxObservability.test.ts`
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`
- `npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `git diff --check`

Notes:

- `npm run build` passed with existing Vite warnings about large chunks and mixed dynamic/static imports. No investigation-specific build failure occurred.

## Missing Runtime or Manual Proof

Not performed by design:

- no Docker
- no local Supabase
- no Supabase cloud mutation
- no deployment
- no production data-mutating smoke
- no live concurrent swipe race smoke against production
- no live notification provider invocation
- no live Supabase Realtime subscription smoke

The SQL validation file inspected for Stream 7 is read-only/catalog-safe, but it was not executed against the cloud database during this investigation.

## Repair Recommendations

No repair stream is recommended for Streams 7-8 from this audit.

If a future release requires live operational proof, use read-only cloud checks and non-mutating observer telemetry first. Any live concurrent swipe or notification-provider smoke would require explicit approval because it can create business/user-visible effects.

## Confirmation

Confirmed for this investigation:

- no Docker used
- no local Supabase used
- no Supabase cloud mutation
- no deploy
- no fixes implemented
- report-only branch scope
