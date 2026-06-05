# Video Date Diagnostics Runbook (G2)

This runbook covers client diagnostics for the journey:

- Event Lobby
- Ready Gate
- Video Date
- Post-Date Survey

Scope is primarily **client-side** (web + native). For **server-side queue / promotion** correlation, operators may use read-only SQL on `event_loop_observability_events` (service role) as documented in `docs/observability/watchdog-no-remote-query-pack.md` — no application RPC contract is implied here.

Current 2026-06-05 recovery overlay: start with `docs/video-date-success-command-center.md`. Functional Video Date code landed in PR #1200 at merge commit `fbca4996a096273914ee650b556ba7994477aa5e`; the current terminal-survey lifecycle hardening adds migrations `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, and `20260605152058_video_date_pending_survey_registration_repair.sql`, plus redeployed `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup`. The active lifecycle false-away follow-up adds `20260605200729_video_date_beforeunload_active_presence_repair.sql`, `20260605203904_video_date_remote_seen_grace_payload_preserve.sql`, and `20260605211924_video_date_surface_claim_expiry_current_guard.sql`. Verify current Git state and Supabase migration state before assuming deployment. This changes Daily triage: `participant_*_joined_at` is latest-state evidence only when newer than away/left evidence; active co-presence requires both users joined without a later `participant.left` / `participant_*_away_at`, canonical `remote_seen` should advance on every remote-media observation, confirmed bilateral remote-media encounters should promote to `date` immediately, browser lifecycle reasons `web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and native `app_background` must not terminalize a live date while fresh joined, remote-media, or current unexpired video-date surface evidence exists, historical encounter proof must not suppress current peer-missing, `in_survey` must survive client offline writes until feedback, pre-hardening downgraded registrations still pointing at pending surveys must be repaired to `in_survey`, terminal room metadata should remain canonical for ended survey-eligible sessions, provider deletion belongs in `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason`, and terminal survey truth must stop Daily/surface churn and open survey on `/date/:sessionId`.

## Watchdog, no-remote, and peer-missing (native vs web)

### What “no remote” means

- **Daily SDK view:** After local `join`, there may be **zero remote participants** in the room snapshot even when the partner is still connecting (delayed visibility).
- **Not the same as** server `video_sessions.phase` lag — reconcile using DB + client breadcrumbs together.

### Authoritative layers (do not mix meanings)

| Layer | Native | Web |
|-------|--------|-----|
| **RC operator breadcrumbs** | Sentry category `rc.video_date.entry` — control-plane steps (`daily_join_ok`, `enter_handshake_*`, …) plus **`no_remote_watchdog_recovery_start`**, **`peer_missing_terminal_watchdog_fire`** for the first-remote watchdog | No `rc.*` namespace; use **`vdbg`** messages (`daily_no_remote_watchdog_*`) |
| **Daily transport breadcrumbs** | Sentry category **`video-date-daily`** (`videoDateDailyDiagnostic`) — `peer_missing_timeout`, `no_remote_auto_recovery_*`, `first_remote_observed`, join/token messages | Same logging style via `vdbg` / development console for web Daily path |
| **Product analytics** | PostHog events such as `video_date_peer_missing_*`, `video_date_join_*` when the analytics instrumentation PR is present (`shared/analytics/lobbyToPostDateJourney.ts`) | Same event names with `platform: web` |

### Distinguishing “remote truly absent” vs “join lag”

1. **`first_remote_observed`** or **`remote_track_mounted`** before terminal peer-missing → **delayed join**, not a missing partner.
2. **`no_remote_watchdog_recovery_start`** followed by **`first_remote_observed`** → **successful recovery** after one automatic rejoin attempt (native).
3. **`peer_missing_terminal_watchdog_fire`** with no prior remote diagnostics → user-facing **peer-missing terminal**; confirm whether partner opened the date route (PostHog / route journey) and whether promotion rows exist for `session_id` (Supabase observability table).
4. **`daily_no_remote_watchdog_historical_truth_requires_current_peer`** means the server can prove the encounter happened, but the client still could not see a current remote peer. This should not be treated as a false positive; inspect provider leave/rejoin order and post-encounter absence handling.

### Incident triage — order of operations

1. **Session id** — collect UUID from support ticket or analytics.
2. **Sentry** — filter breadcrumbs by `session_id`; review `rc.video_date.entry` then `video-date-daily`.
3. **PostHog** — join funnel + peer-missing taps for the same session (when instrumented).
4. **Supabase (service role)** — `event_loop_observability_events` and `video_sessions` for authoritative queue/session truth.

### Retry / keep waiting / back to lobby (native UX)

Interpret together:

- **`video_date_peer_missing_retry_tap`** (PostHog) → user initiated full retry pipeline (clears terminal and bumps join attempt).
- **`video_date_peer_missing_keep_waiting_tap`** → user dismissed terminal but stays in waiting posture (see code: `peer_missing_keep_waiting`).
- **`video_date_peer_missing_back_to_lobby_tap`** or abort path → exit without survey (pre-connect).

Cross-check **`peer_missing_terminal_watchdog_fire`** in Sentry — if absent, the UI state may be from another branch (e.g. prejoin failure vs peer-missing).

### Evidence that would justify future threshold/cadence tuning

Structured measurement checklist (queue drain, reconnect backoff, dashboards): **[`docs/observability/evidence-led-queue-reconnect-tuning.md`](./observability/evidence-led-queue-reconnect-tuning.md)**.

Document **before** proposing code changes:

- Histogram of **`daily_no_remote_watchdog_timeout` → recovery** vs **terminal** rates per platform.
- Rate of **`peer_missing_terminal_watchdog_fire`** where **`first_remote_observed`** occurs within **X minutes** after (late join) — suggests threshold sensitivity.
- Correlation with **`event_loop_observability_events`** outcomes (`blocked`, `conflict`) — if high, tune queue/server path before media timeouts.

**Concrete query patterns and SQL snippets:** [`docs/observability/watchdog-no-remote-query-pack.md`](./observability/watchdog-no-remote-query-pack.md).

## Daily Active Co-Presence And Stale Join Evidence

Use this section when Ready Gate reaches `both_ready`, both users route to `/date/:sessionId`, or Daily room metadata exists, but remote media/date start fails.

Expected behavior after the current recovery migrations:

- `mark_video_date_daily_joined` records the actor's latest join, clears that actor's away stamp, and clears reconnect grace when the route join proves return.
- Daily provider `participant.joined` repairs latest joined evidence and can clear reconnect grace; stale provider `participant.left` cannot override a newer join.
- The visible handshake starts only when both participants' latest Daily presence is active.
- If the partner's latest Daily provider event is missing or is a later `participant.left`, the RPC should stay in waiting posture and emit `daily_join_waiting_for_active_partner`.
- `handshake_started_after_active_daily_copresence` should appear only after both latest presences are active.
- Web/native Daily `participant-left` should not call backend partner-away immediately. Backend grace should start only after local transport grace expires with `daily_transport_grace_expired`.
- Browser lifecycle reasons `web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and native `app_background` should be soft while Daily is joining/joined or the session is in handoff/warm-up/date. If a reconnect grace exists anyway, expiry must clear it instead of ending the session when latest joined, remote-media, or active `video_date` surface-claim evidence is fresh.
- Surface-claim evidence is valid at reconnect-expiry time only when the `video_date` claim is still unreleased and unexpired at the expiry instant. A claim that was valid near the away timestamp but expired before `expire_video_date_reconnect_graces()` runs is historical evidence and must not suppress real disconnect expiry.
- Web and native/mobile `video_date` surface claims should renew on a 30-second server TTL. A missing claim during route churn is evidence to inspect, not a reason to assume the user left.
- If canonical terminal truth is `ended + survey_required`, `/date/:sessionId` should open survey and stop Daily start, surface claim, reconnect, and peer-missing loops.
- If both sides have confirmed remote-media/date-entry evidence and neither side has passed or both-decided, `mark_video_date_remote_seen` or `video_session_handshake_auto_promote_v2` should promote the session to `date` immediately; deadline finalization is only a fallback and must never end that encounter as `handshake_timeout`.
- After `date_started_at`, a missing peer is a post-encounter absence, not a pre-date partial join. Web/native/mobile should end it with `partner_absent_after_confirmed_encounter` when they need to terminalize manually.
- `update_participant_status` must not overwrite `in_survey` to `offline`/`idle`/`browsing` while the user still has a survey-eligible ended session and no `date_feedback` row.
- Terminal timeout/replay/already-ended paths should preserve or repair deterministic `daily_room_name` and `daily_room_url` for support forensics.

Read-only session shape:

```sql
select
  id,
  event_id,
  participant_1_id,
  participant_2_id,
  daily_room_name,
  daily_room_url,
  ready_gate_status,
  phase,
  state,
  participant_1_joined_at,
  participant_2_joined_at,
  participant_1_away_at,
  participant_2_away_at,
  participant_1_remote_seen_at,
  participant_2_remote_seen_at,
  handshake_started_at,
  date_started_at,
  ended_at,
  ended_reason,
  session_seq
from public.video_sessions
where id = '<video_session_id>';
```

Read-only Daily webhook ledger shape:

```sql
select
  provider_event_id,
  event_type,
  room_name,
  provider_user_id,
  processing_state,
  processing_result,
  session_id,
  occurred_at,
  processed_at
from public.video_date_daily_webhook_events
where session_id = '<video_session_id>'
   or room_name = '<daily_room_name>'
order by occurred_at asc, processed_at asc;
```

Read-only observability shape:

```sql
select
  operation,
  outcome,
  reason_code,
  session_id,
  actor_id,
  detail,
  created_at
from public.event_loop_observability_events
where session_id = '<video_session_id>'
  and (
    operation like '%daily_join%'
    or operation like '%handshake%'
    or reason_code in (
      'daily_join_waiting_for_active_partner',
      'handshake_started_after_active_daily_copresence',
      'mark_reconnect_self_away_suppressed_active_daily_presence',
      'reconnect_grace_cleared_by_daily_join',
      'reconnect_grace_cleared_by_provider_join',
      'reconnect_grace_cleared_by_return',
      'reconnect_grace_expiry_suppressed_latest_presence'
    )
    or detail::text like '%daily_join_waiting_for_active_partner%'
    or detail::text like '%handshake_started_after_active_daily_copresence%'
    or detail::text like '%daily_call_cleanup%'
    or detail::text like '%daily_call_reuse%'
    or detail::text like '%remote_seen_canonical%'
    or detail::text like '%historical_remote_seen_truth%'
    or detail::text like '%partner_absent_after_confirmed_encounter%'
  )
order by created_at asc;
```

Read-only post-date survey lifecycle shape:

```sql
select
  er.profile_id,
  er.queue_status,
  er.current_room_id,
  er.last_active_at,
  vs.id as session_id,
  vs.date_started_at,
  vs.ended_at,
  vs.ended_reason,
  vs.daily_room_name,
  vs.daily_room_url,
  df.id as feedback_id
from public.event_registrations er
join public.video_sessions vs
  on vs.id = er.current_room_id
left join public.date_feedback df
  on df.session_id = vs.id
 and df.user_id = er.profile_id
where vs.id = '<video_session_id>'
order by er.profile_id;
```

For duplicate-tab or lobby/date cycling reports, also inspect `video_date_surface_claims` and record whether the two test users used separate browsers/profiles or shared one browser storage context. The local lease is now profile-scoped by `profileId + sessionId`; server claims remain scoped per user/profile.

For repeated Daily cleanup/rebuild reports, inspect `daily_call_cleanup`, `daily_call_reuse`, and `daily_call_busy_internal_retry` diagnostics. A same-session same-room call in joining/joined state should be reused or waited on. Cleanup is expected only for terminal, mismatched, or unrecoverable Daily state.

## Canonical Journey Events

All journey analytics events are emitted as:

- `video_date_journey_<event>`

Canonical event keys are defined in `shared/matching/videoDateDiagnostics.ts`.

Primary milestones:

- `ready_gate_opened`
- `ready_gate_both_ready_handoff_started`
- `ready_gate_dismissed`
- `ready_gate_forfeited`
- `ready_gate_invalidated`
- `date_route_entered`
- `date_route_bounced`
- `date_route_recovered`
- `survey_opened`
- `survey_recovered`
- `survey_lost_prevented`
- `survey_completed`
- `mutual_match_detected`
- `chat_cta_pressed`

Hardening sprint product events added/verified in `shared/analytics/lobbyToPostDateJourney.ts`:

- `video_date_ready_gate_ready`
- `video_date_both_ready`
- `video_date_route_entered`
- `video_date_enter_handshake_success`
- `video_date_enter_handshake_failure`
- `video_date_daily_token_success`
- `video_date_daily_token_failure`
- `video_date_daily_joined`
- `video_date_remote_seen`
- `video_date_handshake_grace_started`
- `video_date_handshake_completed_mutual`
- `video_date_handshake_not_mutual`
- `video_date_extension_attempted`
- `video_date_extension_succeeded`
- `video_date_extension_failed`
- `video_date_reconnect_grace_started`
- `video_date_reconnect_returned`
- `video_date_reconnect_expired`
- `video_date_survey_opened`
- `video_date_survey_submitted`
- `video_date_survey_abandoned`
- `video_date_queue_drain_found`
- `video_date_queue_drain_not_found`
- `video_date_queue_drain_blocked`

Read-only operator SQL for stuck sessions and stale registrations lives in
`supabase/validation/video_date_end_to_end_hardening.sql`.

## Canonical Fields

Journey events use the same core fields across web and native:

- `platform` (`web` or `native`)
- `session_id`
- `event_id`
- branch-specific context (for example `reason`, `source`, `target`, `outcome`)

Avoid adding PII-heavy fields (message content, media URLs, etc.).

## Media / Reconnect Diagnostics (C1)

Two main diagnostic layers exist:

- `vdbg` breadcrumbs for branch-level flow tracing
- Daily/media diagnostics for transport milestones

Common Daily milestones:

- token lifecycle: `token_fetch_start`, `token_fetch_success`, `token_fetch_failure`
- join lifecycle: `daily_join_start` / `daily_call_join_start`, `daily_join_success` / `daily_call_join_success`, `daily_join_failure` / `daily_call_join_failure`
- track lifecycle: `daily_local_track_mounted` / `local_track_mounted`, `daily_remote_track_mounted` / `remote_track_mounted`
- remote visibility: `first_remote_observed`, `remote_participant_promoted_*`
- watchdog/recovery: `daily_no_remote_watchdog_*`, `no_remote_auto_recovery_*`, `peer_missing_timeout`

Reconnect sync outcomes are normalized in `shared/matching/videoDateDiagnostics.ts`:

- `rpc_error`
- `ended`
- `ok`

## Triage Flow (Quick)

For a failed user journey, walk in this order:

1. **Route entered?**
   - Find `video_date_journey_date_route_entered`.
2. **Ready Gate handoff happened?**
   - Confirm `video_date_journey_ready_gate_both_ready_handoff_started`.
3. **Date join succeeded?**
   - Check token and join diagnostics (`*_token_*`, `*_join_*`).
4. **Remote media became usable?**
   - Confirm `first_remote_observed` and remote track-mounted diagnostics.
5. **Reconnect path (if present)**
   - Inspect `sync_reconnect_result` breadcrumbs and outcome (`rpc_error`, `ended`, `ok`).
6. **Terminal routing**
   - Confirm survey events (`survey_opened`, `survey_recovered`, `survey_completed`) or bounce/recovery (`date_route_bounced`, `date_route_recovered`).

## Query/Filter Suggestions

- Filter by `session_id` first, then sort by timestamp.
- Add `platform` to compare web vs native branch behavior.
- For reconnect incidents, filter message `sync_reconnect_result` and inspect `outcome`.
- For blank-media incidents, filter for `first_remote_observed`, `remote_track_mounted`, and watchdog events in the same session.
- For native peer-missing incidents, filter **`rc.video_date.entry`** message **`peer_missing_terminal_watchdog_fire`** or **`video-date-daily`** message **`peer_missing_timeout`** (same clock order).
