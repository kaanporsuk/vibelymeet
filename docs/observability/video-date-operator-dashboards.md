# Video Date Operator Dashboards

## 1. Purpose

This runbook defines operator-grade dashboards for the live event loop:

Ready Gate -> video date -> post-date survey -> next Ready Gate.

It answers five questions:

1. How long does Ready Gate open -> date join take?
2. Are simultaneous swipe conflicts recovering into the existing Ready Gate/date session?
3. Does post-date survey completion convert into the next Ready Gate/date opportunity?
4. Are queue drain failures real failures, blocked cases, or expected no-ops?
5. Is client timer drift detected and corrected from server-owned `video_sessions` truth?

These dashboards are for operations and regression detection. They are not product UX dashboards.

## 2. Source Of Truth

| Source | Use For | Trust Level | Notes |
| --- | --- | --- | --- |
| Client PostHog | UI chain checkpoints, client-observed Daily token/join/remote media, survey conversion route, timer drift recovery | Client-observed truth | Do not treat client analytics as backend truth. Use stable enum properties only. |
| Supabase SQL | Queue drain, promotion engine, event validity, active-session conflicts, `video_sessions` server state | Backend truth | Use normalized views and keep drain wrapper rows separate from promotion engine rows. |
| Sentry breadcrumbs | Correlating client failures, route guards, Daily failures, reconnect drift symptoms | Debug evidence | Use for investigation, not rates. Sampling and client health can bias counts. |

PII guardrails:

- Do not send partner names, profile text, message text, image paths, prompts, emails, or freeform user content.
- Allowed IDs are stable operational IDs such as `event_id`, `session_id`, and backend operator `actor_id` in SQL-only queries.
- Reason and outcome properties must be enum-style values.

## 3. Event Names And Required Properties

Common PostHog properties:

| Property | Values | Notes |
| --- | --- | --- |
| `platform` | `web`, `native` | Required on all client events. |
| `session_id` | UUID/string | Required when the event is session scoped. |
| `event_id` | UUID/string | Required when the event is event scoped. |
| `source_surface` | enum string | Example: `ready_gate_overlay`, `event_lobby`, `video_date`, `post_date_survey`. |
| `source_action` | enum string | The stable action/checkpoint that caused the event. |
| `reason_code` | enum string/null | Required for failure, blocked, timeout, no-op, or recovery explanation. |
| `attempt_count` | integer/null | Required when retry vs first attempt matters. |
| `duration_ms` | integer/null | Required when a duration is available. |
| `latency_bucket` | enum string/null | Use for latency tiles and failure tables. |
| `outcome` | `success`, `failure`, `blocked`, `no_op`, `timeout`, `recovered` | Required on operator events. |

Ready Gate -> date latency:

- `ready_gate_to_date_latency_started`
- `ready_gate_to_date_latency_checkpoint`
- `ready_gate_to_date_latency_completed`
- Existing funnel steps: `ready_gate_both_ready`, `video_date_route_entered`, `video_date_daily_token_success`, `video_date_daily_join_success`, `video_date_remote_seen`

Latency duration properties:

- `readyGateOpenToReadyTapMs`
- `bothReadyToDateRouteMs`
- `bothReadyToDailyTokenMs`
- `bothReadyToDailyJoinMs`
- `bothReadyToRemoteSeenMs`
- `bothReadyToFirstRemoteFrameMs`
- `dailyTokenDurationMs`
- `dailyJoinDurationMs`

Simultaneous swipe recovery:

- `simultaneous_swipe_conflict_detected`
- `simultaneous_swipe_recovery_attempted`
- `simultaneous_swipe_recovery_succeeded`
- `simultaneous_swipe_recovery_failed`

Survey -> next Ready Gate:

- `post_date_survey_impression`
- `post_date_survey_submit`
- `post_date_survey_complete_return`
- `survey_next_gate_check_started`
- `survey_next_gate_check_result`
- `survey_next_gate_conversion`
- Existing conversion evidence: `video_date_queue_drain_found`, `ready_gate_impression`, `ready_gate_both_ready`, `video_date_daily_join_success`

Timer drift:

- `video_date_timer_drift_detected`
- Canonical recovered event: `video_date_timer_drift_recovered_by_server_truth`
- Code constant alias: `VIDEO_DATE_TIMER_DRIFT_RECOVERED` resolves to `video_date_timer_drift_recovered_by_server_truth`.
- `video_date_timer_drift_recovery_failed` is reserved but is not emitted today; failure rate is not measurable until there is a real failed recovery path.

Timer drift properties:

- `drift_ms`
- `drift_bucket`: `lt_1s`, `1_5s`, `5_15s`, `15_60s`, `gt_60s`
- `drift_direction`: `client_ahead`, `client_behind`, `aligned`
- `recovery_source`: `foreground_reconcile`, `sync_reconnect`, `session_reload`, `realtime`, `route_hydration`
- `local_phase`
- `server_phase`
- `survey_recovered`
- `date_phase_restored`
- `ended_state_corrected`

## 4. Dashboard: Ready Gate Open To Date Join Latency

Question: after Ready Gate is visible and both users are ready, how quickly does the user enter the Daily call?

PostHog funnel:

1. `ready_gate_both_ready`
2. `video_date_route_entered`
3. `video_date_daily_token_success`
4. `video_date_daily_join_success`
5. `video_date_remote_seen`

Recommended tiles:

- Funnel conversion by `platform`.
- p50, p75, p95 of `bothReadyToDailyJoinMs` by `platform`.
- p50, p75, p95 of `bothReadyToFirstRemoteFrameMs` by `platform`. Label native as `first remote media proxy`; native currently measures `remote_track_mounted`, not a guaranteed rendered frame.
- p50, p75, p95 of `dailyTokenDurationMs` and `dailyJoinDurationMs`.
- Failure table grouped by `source_action`, `reason_code`, `platform`, `attempt_count`.

Breakdowns:

- `platform`
- `event_id`
- `attempt_count` (`1` means first attempt; `2` means retry/forced entry)
- `checkpoint`
- `reason_code`

Targets:

- `bothReadyToDailyJoinMs` p50 < 1500 ms.
- `bothReadyToFirstRemoteFrameMs` is tracked separately. It depends on client media, remote participant behavior, network, and Daily rendering, so do not read it as purely backend-controlled.
- Monitor p95 for regressions. Do not page on one p95 spike without checking sample size and failure reason distribution.

What not to conclude:

- A slow first remote frame does not prove server matching failed.
- Native `video_date_first_remote_frame` is a remote-track-mounted / first-playable-media proxy, not proof that a remote frame was rendered on screen.
- A successful Daily token does not prove the user joined the call.
- Client route-entered counts can undercount if the app crashes before analytics flush.

## 5. Dashboard: Simultaneous Swipe Recovery Rate

Definition: a user hits a server/client conflict because one participant already has a pending or active `video_sessions` session, and the app recovers by hydrating or navigating to the correct existing Ready Gate/date session.

Do not count:

- Normal immediate matches.
- Persistent chat matches.
- Non-video session conflicts.

PostHog setup:

- Recovery rate: `count(simultaneous_swipe_recovery_succeeded) / count(simultaneous_swipe_conflict_detected)`.
- Median recovery time: median `duration_ms` on recovery success when emitted.
- Failure reasons: `simultaneous_swipe_recovery_failed` grouped by `reason_code`.

Breakdowns:

- `platform`
- `event_id`
- `source_action`
- `reason_code`

Backend correlation:

- Check `event_loop_observability_events` or `v_event_loop_swipe_mutual_events` for `already_matched`, `participant_has_active_session_conflict`, and returned session ids.
- Use SQL to confirm conflict volume, then PostHog to confirm client recovery UX.

What not to conclude:

- A conflict is not automatically a failed match. `already_matched` with a routable session can be a successful recovery path.
- Recovery success is client-observed. If SQL reports conflicts but PostHog has low success, inspect client hydration and route failures before changing backend promotion logic.

## 6. Dashboard: Survey To Next Ready Gate Conversion

Question: after the post-date survey completes, does the user get another date opportunity?

PostHog funnel variants:

1. `post_date_survey_complete_return`
2. `survey_next_gate_check_started`
3. `video_date_queue_drain_found`
4. `ready_gate_impression`
5. `ready_gate_both_ready`
6. `video_date_daily_join_success`

Conversion windows:

- 30 seconds
- 60 seconds
- 120 seconds

Recommended tiles:

- Survey complete -> queue drain found.
- Survey complete -> Ready Gate shown.
- Survey complete -> date joined.
- No next match reason distribution from `survey_next_gate_check_result.reason_code`.

Breakdowns:

- `platform`
- `event_id`
- `source_action`
- `reason_code`
- `outcome`

Implementation rule:

- Use the existing `useMatchQueue` survey-phase drain path with `enableSurveyPhaseDrain`.
- Do not create a separate matching loop for this metric.

What not to conclude:

- A no-op result can mean no eligible queued session at that moment, not a drain bug.
- Survey completion is client-observed. For backend queue truth, check drain/promotion SQL before tuning cadence.

## 7. Dashboard: Queue Drain Failures

Source of truth: Supabase SQL.

Use `docs/observability/event-loop-dashboard-normalization.md` before interpreting these numbers.

Preferred views:

- `v_event_loop_observability_metric_streams`
- `v_event_loop_drain_events`
- `v_event_loop_promotion_events`
- `v_event_loop_mark_lobby_promotion_normalized`

Dashboard tiles:

- Drain RPC volume.
- Drain success count.
- Drain failure/block/no-op count.
- Top `reason_code`.
- `no_queued_session` rate.
- `event_not_valid` rate.
- `partner_not_present` and `self_not_present` rates.
- `participant_has_active_session_conflict` rate.
- Repeated attempts per actor/event.
- Events with concentrated drain failures.

Counting rule:

- For drain dashboard denominators, filter to `metric_stream = 'drain_rpc_outer'` or use `v_event_loop_drain_events`.
- Do not add `promote_ready_gate_if_eligible` rows to drain rows as one number. Drain writes wrapper telemetry and promotion writes engine telemetry.

What not to conclude:

- `no_queued_session` is often expected idle drain, TTL expiry, or a race where another worker picked the queued row.
- `mark_lobby_foreground.outcome = success` means the RPC wrapper completed, not that promotion succeeded. Read `promotion_derived_outcome` in the normalized view.

## 8. Dashboard: Timer Drift Recovered By Server Truth

Definition: client timer or phase display disagrees with server-owned `video_sessions` truth, and the client corrects UI from server truth instead of continuing stale local state.

PostHog setup:

- Detections by `platform`: `video_date_timer_drift_detected`.
- Canonical recovery count: `video_date_timer_drift_recovered_by_server_truth`.
- Detection/recovery ratio: `count(video_date_timer_drift_recovered_by_server_truth) / count(video_date_timer_drift_detected)`. Today this is expected to be 1:1 because detection is emitted only for meaningful client corrections that are immediately recovered from server truth.
- Do not build a recovery-failure-rate tile yet. `video_date_timer_drift_recovery_failed` is reserved but not emitted until a real failed recovery path is instrumented.
- p50/p95 `drift_ms`.
- Sessions with repeated drift: group by `session_id` and count detections.
- Drift leading to survey recovery: filter `survey_recovered = true`.

Breakdowns:

- `platform`
- `event_id`
- `drift_bucket`
- `drift_direction`
- `recovery_source`
- `local_phase`
- `server_phase`
- `survey_recovered`
- `date_phase_restored`
- `ended_state_corrected`

What not to conclude:

- A drift detection does not prove backend time moved incorrectly. It can be app sleep, reconnect, render delay, or missed realtime.
- Use `video_sessions.date_started_at`, `date_extra_seconds`, `phase`, `state`, and `ended_at` as server truth when investigating.

## 9. SQL Query Pack

Run these from Supabase SQL Editor or an operator connection with access to the private observability views.

### 9.1 Drain Outer Outcome Distribution - Last 7/14 Days

Change the interval to `14 days` for the longer window.

```sql
SELECT
  outcome,
  COALESCE(reason_code, 'none') AS reason_code,
  count(*)::bigint AS rows,
  count(*)::numeric / nullif(sum(count(*)) OVER (), 0) AS share
FROM public.v_event_loop_observability_metric_streams
WHERE metric_stream = 'drain_rpc_outer'
  AND created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY rows DESC;
```

Fallback:

```sql
SELECT
  outcome,
  COALESCE(reason_code, 'none') AS reason_code,
  count(*)::bigint AS rows
FROM public.v_event_loop_drain_events
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY rows DESC;
```

### 9.2 Promotion Engine Outcome Distribution - Last 7/14 Days

```sql
SELECT
  outcome,
  COALESCE(reason_code, 'none') AS reason_code,
  count(*)::bigint AS rows,
  count(*)::numeric / nullif(sum(count(*)) OVER (), 0) AS share
FROM public.v_event_loop_promotion_events
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY rows DESC;
```

### 9.3 Failure Reason Code Distribution

```sql
SELECT
  COALESCE(reason_code, 'none') AS reason_code,
  outcome,
  count(*)::bigint AS rows,
  count(DISTINCT event_id)::bigint AS events,
  count(DISTINCT actor_id)::bigint AS actors
FROM public.v_event_loop_observability_metric_streams
WHERE metric_stream = 'drain_rpc_outer'
  AND created_at >= now() - interval '14 days'
  AND outcome <> 'success'
GROUP BY 1, 2
ORDER BY rows DESC;
```

### 9.4 Repeated Actor/Event Clusters

```sql
SELECT
  actor_id,
  event_id,
  count(*)::bigint AS attempts,
  min(created_at) AS first_at,
  max(created_at) AS last_at,
  array_agg(DISTINCT COALESCE(reason_code, 'none')) AS reason_codes
FROM public.v_event_loop_observability_metric_streams
WHERE metric_stream = 'drain_rpc_outer'
  AND actor_id IS NOT NULL
  AND created_at >= now() - interval '14 days'
GROUP BY 1, 2
HAVING count(*) >= 5
ORDER BY attempts DESC
LIMIT 100;
```

### 9.5 `event_not_valid` Joined To `events.status`

```sql
SELECT
  COALESCE(e.status::text, '(no events row)') AS event_status,
  o.detail->>'step' AS detail_step,
  count(*)::bigint AS rows
FROM public.event_loop_observability_events o
LEFT JOIN public.events e ON e.id = o.event_id
WHERE o.operation = 'promote_ready_gate_if_eligible'
  AND o.reason_code = 'event_not_valid'
  AND o.created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY rows DESC;
```

### 9.6 `mark_lobby` Nested Promotion Distribution

```sql
SELECT
  promotion_derived_outcome,
  COALESCE(promotion_reason, 'none') AS promotion_reason,
  count(*)::bigint AS rows
FROM public.v_event_loop_mark_lobby_promotion_normalized
WHERE created_at >= now() - interval '14 days'
GROUP BY 1, 2
ORDER BY rows DESC;
```

### 9.7 Concentrated Drain Failures By Event

```sql
SELECT
  event_id,
  count(*)::bigint AS drain_attempts,
  count(*) FILTER (WHERE outcome <> 'success')::bigint AS non_success_rows,
  count(*) FILTER (WHERE reason_code = 'no_queued_session')::bigint AS no_queued_session_rows,
  count(*) FILTER (WHERE reason_code = 'event_not_valid')::bigint AS event_not_valid_rows,
  count(*) FILTER (WHERE reason_code = 'participant_has_active_session_conflict')::bigint AS active_session_conflict_rows,
  count(*) FILTER (WHERE outcome <> 'success')::numeric / nullif(count(*), 0) AS non_success_rate
FROM public.v_event_loop_observability_metric_streams
WHERE metric_stream = 'drain_rpc_outer'
  AND created_at >= now() - interval '14 days'
GROUP BY 1
HAVING count(*) >= 10
ORDER BY non_success_rate DESC, non_success_rows DESC
LIMIT 50;
```

## 10. PostHog Dashboard Setup

Create one dashboard named `Video Date Operator Loop`.

Recommended insight groups:

1. Ready Gate latency funnel.
2. Ready Gate latency distributions.
3. Simultaneous swipe recovery.
4. Survey -> next Ready Gate conversion windows.
5. Timer drift detection/recovery.
6. Failure reason tables.

Property hygiene:

- Use `event_id`, `platform`, `source_surface`, `source_action`, `reason_code`, `outcome`, `attempt_count`, and buckets for breakdowns.
- Avoid creating dashboards on `session_id` except for repeated-drift drilldowns, because high-cardinality tiles are expensive and noisy.

## 11. Sentry Search Examples

Use Sentry to inspect traces around anomalies, not as the rate source.

```text
ready_gate_both_ready_observed
lobby_navigate_to_date
video_date_prepare_entry_failure
video_date_daily_token_failure
video_date_join_failure
video_date_remote_seen
date_timing_fetch_failed
route_hydration_date_guard
```

Useful dimensions:

- release
- environment
- platform
- device class
- app version
- network breadcrumbs near Daily join failures

## 12. Interpreting Anomalies

Ready Gate latency spike:

- First check `dailyTokenDurationMs` vs `dailyJoinDurationMs`.
- If token is fast and join is slow, inspect Daily/client network and app foreground state.
- If route-entered is slow, inspect route hydration, prepare-entry handoff, and retries.

Swipe recovery drop:

- Confirm SQL conflict volume first.
- If conflicts increased but recovery succeeded stayed flat, inspect active-session hydration and ready gate route decisions.
- Do not tune promotion cadence based only on client conflict events.

Survey conversion drop:

- Compare `survey_next_gate_check_result.reason_code`.
- If `no_queued_session` dominates, inspect queue availability and event end timing.
- If Ready Gate shown but date joined drops, inspect the Ready Gate/date latency dashboard.

Drain failure spike:

- Separate `blocked`, `no_op`, `conflict`, and `failure`.
- Join `event_not_valid` to `events.status` before assuming a regression.
- Check repeated actor/event clusters for one stuck user or one event driving the alert.

Timer drift spike:

- Split by `recovery_source`.
- `foreground_reconcile` spikes often point to app background/foreground behavior.
- `realtime` spikes can indicate missed realtime or delayed sync.
- Use server timestamps as truth; client drift only says the UI corrected itself.

## 13. Change Control Before Tuning

Before changing latency thresholds, drain cadence, Ready Gate TTLs, or reconnect sync behavior:

1. Capture the affected event ids and time window.
2. Check the SQL drain/promotion views separately from client funnels.
3. Verify whether the anomaly is platform-specific.
4. Compare first-attempt vs retry with `attempt_count`.
5. Check Sentry breadcrumbs for route/token/join failures.
6. Document whether p50, p75, or p95 moved and whether sample size is large enough.
7. Avoid shipping cadence changes based on a single client-only dashboard.

Supabase deploy guidance:

- This dashboard spec and client analytics instrumentation do not require Supabase cloud deploy.
- Run `supabase db push --linked --dry-run` only when a migration is added.
- Regenerate Supabase types only when schema changes.
