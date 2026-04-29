# Handshake Limbo After Partial Daily Join

Branch: `fix/handshake-limbo-partial-join`

## Audit

### Current State Machine

1. Ready Gate owns pre-Daily readiness through `ready_gate_transition`.
   - `ready`, `ready_a`, `ready_b`, `snoozed`, and `both_ready` remain `state = ready_gate`.
   - Web and native route owners do not navigate directly on phase alone. They require backend truth and provider room evidence before `/date/:id`.

2. Provider-atomic date entry starts before route hydration.
   - `video_date_transition('prepare_entry')` is preflight only.
   - The `daily-room` Edge Function prepares or recovers the deterministic Daily room and token.
   - `confirm_video_date_entry_prepared(...)` is service-role only and persists `daily_room_name`, `daily_room_url`, `state/phase = handshake`, `handshake_started_at`, and both registrations as `in_handshake`.

3. Daily joined evidence is written after the Daily SDK join succeeds.
   - Web `useVideoCall` calls `mark_video_date_daily_joined` after `callObject.join(...)` succeeds and retries once if the RPC fails.
   - Native `app/date/[id].tsx` calls `markVideoDateDailyJoined(sessionId)` after `call.join(...)` succeeds and retries once if the RPC fails.
   - `mark_video_date_daily_joined` stamps exactly one of `participant_1_joined_at` / `participant_2_joined_at` for the caller and refreshes registrations to `in_handshake` or `in_date`.

4. Handshake completion remains backend-authoritative.
   - `video_date_transition('vibe'|'pass')` records decisions.
   - `video_date_transition('complete_handshake')` advances to `date` only when both participants decided and both vibed.
   - Non-mutual or grace-expired handshakes end pre-date and registrations are cleared to non-survey states.

5. Date end and survey entry are gated by date evidence.
   - `video_date_transition('end')` routes to `in_survey` only when `date_started_at` or date phase evidence exists.
   - Web and native survey recovery both use shared `videoSessionHasRecoverablePostDateSurveyTruth`, which requires `ended_at` and `date_started_at` and excludes pre-date terminal reasons.

### Timeout / Expiry Paths

- Ready Gate snooze wake: `expire_stale_video_sessions_bounded` only mutates rows with no Daily/provider/date/joined evidence.
- Queued TTL expiry: same no-evidence guard; terminal `queued_ttl_expired`.
- Ready Gate expiry for `ready`, `ready_a`, `ready_b`, and `both_ready`: same no-evidence guard; terminal `ready_gate_expired`.
- Handshake grace expiry: `expire_stale_video_date_phases_bounded` ends only rows with `state = handshake`, no `date_started_at`, and no joined evidence.
- Generic handshake timeout: same no-joined-evidence guard; terminal `handshake_timeout`.
- Date timeout: `state = date` with `date_started_at` routes to `date_timeout` and registrations to `in_survey`.
- Reconnect/native background: client calls `mark_reconnect_*`, `sync_reconnect`, or `end` paths; `reconnect_grace_expired` is terminal, and survey eligibility still depends on `date_started_at`.
- Web/native first-remote watchdogs: local UI retries or shows peer-missing actions, but they do not authoritatively end a one-sided joined backend row.

### Joined Evidence Fields

- `daily_room_name` / `daily_room_url`: persisted by service-role `confirm_video_date_entry_prepared` after provider preparation succeeds.
- `handshake_started_at`: set by `confirm_video_date_entry_prepared` or legacy `enter_handshake`, and used by route hydration as stronger evidence than legacy `phase`.
- `participant_1_joined_at` / `participant_2_joined_at`: persisted by `mark_video_date_daily_joined` after an actual Daily SDK join.
- `date_started_at`: set only when mutual handshake advances to date; it is the survey eligibility boundary.

### Partial-Join Misclassification Cases

- Current Ready Gate cleanup does not misclassify persisted joined evidence as `ready_gate_expired`: ready-gate expiry has explicit guards for `date_started_at IS NULL`, `handshake_started_at IS NULL`, provider room fields null, and both joined timestamps null.
- The remaining bug is limbo: a row with exactly one joined timestamp, `state = handshake`, and `date_started_at IS NULL` is skipped by both handshake cleanup branches because they require both joined timestamps to be null.
- If the joined user closes the app/browser, backgrounds, or leaves the peer-missing UI without successfully ending the session, no backend-owned cleanup terminates the partial join. Registrations can remain `in_handshake`, and later jobs preserve the row because joined evidence exists.
- A late peer can still join before the cleanup timeout. After both joined timestamps exist, the existing handshake decision/grace flow remains authoritative and the new partial-join timeout must not fire.

### Web / Native Differences

- Web allows two no-remote auto-recovery attempts, then shows a peer-missing terminal overlay with Try reconnecting, Keep waiting, and Leave.
- Native allows one no-remote leave/rejoin recovery, then shows a peer-missing terminal card with the same actions.
- Both platforms persist joined evidence after Daily join success and both use shared route/survey truth helpers.
- Neither platform should own the terminal classification for this edge case; both should display ended pre-date sessions as a clear return/retry path and avoid opening normal post-date survey without `date_started_at`.

### Root Cause

The cleanup hardening correctly protected joined evidence from false Ready Gate expiry, but it stopped short of adding a distinct backend terminal path for exactly-one-joined handshakes. The system preserves valid joined evidence, then has no authoritative timeout for the missing peer case. That can leave the session in `handshake` indefinitely and keep users/registrations stuck in date routing.

### Definitive Fix Plan

- Add a forward migration that replaces the bounded stale phase cleanup with an exactly-one-joined branch.
- Use a new explicit terminal reason: `partial_join_peer_timeout`.
- Fire only when:
  - `state = handshake`
  - `ended_at IS NULL`
  - `date_started_at IS NULL`
  - exactly one joined timestamp exists
  - reconnect grace is not active
  - `GREATEST(joined_at, handshake_started_at, started_at) + interval '90 seconds' <= now()`
- Preserve existing Ready Gate expiry behavior for no-evidence sessions.
- Clear registrations still pointing at the session to `idle`; do not touch registrations that moved to another room.
- Record a per-session `event_loop_observability_events` entry with session id, event id, transition/action, prior/next state and reason, joined evidence snapshot, and timeout/watchdog source.
- Include `partial_join_peer_timeout` in the bounded phase cleanup summary JSON and per-session observability detail.
- Add `partial_join_peer_timeout` to shared survey-ineligible and validation lists so pre-date partial joins never open the normal survey path.
- Keep client changes minimal and parity-safe: neutral peer-missing copy can be aligned, but backend state owns the terminal reason.

### Tests Required

- Static DB/RPC contract tests asserting:
  - Ready Gate expiry remains guarded to no joined/provider/date evidence.
  - Partial join cleanup matches exactly-one-joined rows and uses `partial_join_peer_timeout`.
  - Late join with both joined timestamps is excluded from partial-join timeout.
  - Partial join cleanup emits observability with joined evidence and timeout source.
  - Summary observability includes the partial-join count.
  - Survey gates classify `partial_join_peer_timeout` as ineligible.
- Shared/client tests asserting:
  - `partial_join_peer_timeout` is excluded from post-date survey recovery.
  - Web/native peer-missing surfaces have consistent actions and neutral copy.
  - Route hydration continues to prefer backend room/date truth over `phase`.

### Manual QA Script

1. A joins, B never joins
   - Start an event with two test users.
   - Make both users ready, but only open `/date/:id` on A.
   - Let A complete Daily join and wait past the peer-missing UI timeout and backend cleanup window.
   - Verify the session ends with `ended_reason = partial_join_peer_timeout`, registrations clear to a non-date state, A sees a clear return/retry path, and no normal post-date survey opens.

2. A joins, B joins late
   - Make both users ready.
   - Let A enter the Daily room first.
   - Open B before the backend partial-join timeout window elapses.
   - Verify both joined timestamps are set, the session stays in handshake/date flow, and no `partial_join_peer_timeout` is written.

3. A backgrounds during handshake
   - Make both users ready and have A enter the Daily room.
   - Background A while B has not joined or is joining late.
   - Return before native/web reconnect grace expires and confirm recovery still works.
   - Repeat and keep A backgrounded past grace/cleanup. Verify the terminal reason is reconnect/background-driven when appropriate or `partial_join_peer_timeout` only when the persisted evidence is exactly one joined peer and no reconnect grace is active.

## Gate Decision

The audit found a real bug and a single safe definitive fix. The implementation should continue automatically with a minimal backend-authoritative partial-join timeout plus shared survey/client contract updates.

## Post-Audit

### Final Contract

- Joined evidence remains authoritative once `participant_1_joined_at` or `participant_2_joined_at` is persisted.
- Ready Gate expiry still applies only to rows with no provider, handshake, date, or joined evidence.
- Exactly-one-joined handshakes now end from backend cleanup with `ended_reason = partial_join_peer_timeout` after a 90 second server window and no active reconnect grace.
- Rows where both participants eventually joined are excluded from the partial-join timeout and stay in the existing handshake/date flow.
- Pre-date partial-join terminal states clear pointed registrations to `idle` and do not enter normal post-date survey recovery.
- Web and native peer-missing surfaces use the same neutral copy and actions: reconnect, keep waiting, or return to lobby.

### Validation

- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/videoSessionDailyGate.test.ts`
- `npm run test:daily-room-contract`
- `npm run typecheck`
- `npm run lint` (passes with existing repo warnings)
- `npm run build` (passes with existing chunk-size/dynamic-import warnings)
- `supabase db push --linked --dry-run` (confirms only `20260501143000_video_date_partial_join_timeout.sql` would push)
- `supabase db lint --local --fail-on error` could not run because local Postgres was not listening on `127.0.0.1:54322`.
