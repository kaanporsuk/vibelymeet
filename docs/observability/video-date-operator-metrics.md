# Video Date Operator Metrics v1

This pack defines the first operator-grade read model for the Vibely video-date loop. It uses existing backend truth first, plus one additive client analytics event for timer reconciliation.

## Access Model

- Supabase event-loop read models are operator/service-role only. The relevant migrations revoke `anon` and `authenticated` access and grant `service_role`.
- Current admin web surfaces use authenticated Supabase clients, so they cannot read `event_loop_observability_events` or `v_event_loop_*` directly.
- v1 therefore ships docs/query pack + shared metric definitions + timer-drift analytics. A service-role Edge Function or backend operator API is the v2 path for an in-app admin panel.
- No Supabase migration is required for this v1.

Read this together with `docs/observability/event-loop-dashboard-normalization.md` before mixing drain, promotion, and mark-lobby aggregates.

## Metric Catalog

| Metric ID | Label | Source | Healthy Direction | Notes |
| --- | --- | --- | --- | --- |
| `ready_gate_open_to_date_join_latency` | Ready Gate open to date join latency | `event_loop_observability_events` + `video_sessions` | lower | Ready Gate open is derived from promotion rows, not a dedicated timestamp column. |
| `simultaneous_swipe_collision_rate` | Simultaneous swipe collision rate | `v_event_loop_swipe_mutual_events` | lower | Existing truth counts collision-like outcomes. Deploy `20260501092000_handle_swipe_presence_and_already_matched_session.sql` before treating `already_matched + video_session_id` as recovered/routable. |
| `survey_to_next_ready_gate_conversion` | Survey to next Ready Gate conversion | PostHog continuity events, plus DB approximation | higher | PostHog is the clean source for route decisions; DB approximation is useful for spot checks. |
| `queue_drain_failure_rate` | Queue drain failure rate | `v_event_loop_drain_events` or `v_event_loop_observability_metric_streams` | lower | Use `metric_stream = 'drain_rpc_outer'` to avoid double-counting inner promotions. |
| `timer_drift_recovered_by_server_truth` | Timer drift recovered by server truth | PostHog event `video_date_timer_drift_recovered_by_server_truth` | lower | Added in this branch; emitted only for meaningful date-phase corrections. |

Default threshold helpers live in `shared/observability/videoDateOperatorMetrics.ts`.

## 1. Ready Gate Open To Date Join Latency

Source:

- Ready Gate opened: `event_loop_observability_events`
- Date joined: `video_sessions.participant_1_joined_at`, `video_sessions.participant_2_joined_at`

SQL:

```sql
with ready_gate_open as (
  select
    session_id,
    event_id,
    min(created_at) as ready_gate_opened_at
  from public.event_loop_observability_events
  where created_at >= now() - interval '7 days'
    and session_id is not null
    and (
      (operation = 'handle_swipe' and outcome = 'success' and reason_code = 'match_immediate')
      or (operation = 'promote_ready_gate_if_eligible' and outcome = 'success')
    )
  group by session_id, event_id
),
join_times as (
  select
    id as session_id,
    (
      select min(joined_at)
      from (values (participant_1_joined_at), (participant_2_joined_at)) as joins(joined_at)
      where joined_at is not null
    ) as first_joined_at,
    (
      select max(joined_at)
      from (values (participant_1_joined_at), (participant_2_joined_at)) as joins(joined_at)
      where joined_at is not null
    ) as last_joined_at
  from public.video_sessions
)
select
  r.event_id,
  count(*) as sessions_with_join,
  percentile_cont(0.5) within group (
    order by extract(epoch from (j.first_joined_at - r.ready_gate_opened_at)) * 1000
  ) as p50_first_join_ms,
  percentile_cont(0.95) within group (
    order by extract(epoch from (j.first_joined_at - r.ready_gate_opened_at)) * 1000
  ) as p95_first_join_ms,
  percentile_cont(0.95) within group (
    order by extract(epoch from (j.last_joined_at - r.ready_gate_opened_at)) * 1000
  ) as p95_both_join_ms
from ready_gate_open r
join join_times j on j.session_id = r.session_id
where j.first_joined_at is not null
  and j.first_joined_at >= r.ready_gate_opened_at
group by r.event_id
order by p95_first_join_ms desc;
```

Operational read:

- Healthy: p95 under 10 seconds.
- Warning: p95 10-20 seconds.
- Critical: p95 over 20 seconds.

## 2. Simultaneous Swipe Collision Rate

Source:

- `v_event_loop_swipe_mutual_events`
- Fallback: `event_loop_observability_events` where `operation = 'handle_swipe'`

SQL:

```sql
select
  event_id,
  count(*) as swipe_mutual_rows,
  count(*) filter (
    where reason_code in ('already_matched', 'participant_has_active_session_conflict', 'active_session_conflict')
  ) as collision_rows,
  count(*) filter (
    where reason_code in ('already_matched', 'participant_has_active_session_conflict', 'active_session_conflict')
  )::numeric / nullif(count(*), 0) as collision_rate
from public.v_event_loop_swipe_mutual_events
where created_at >= now() - interval '24 hours'
group by event_id
order by collision_rate desc nulls last;
```

Limitation:

This measures collision-like backend outcomes. After `20260501092000_handle_swipe_presence_and_already_matched_session.sql` is deployed, `already_matched` rows with a non-null `session_id` / returned `video_session_id` represent recovered same-pair sessions that clients can route back into. Rows without a session id, or `participant_has_active_session_conflict`, should still be treated as non-recovered collision/conflict signals.

## 3. Survey To Next Ready Gate Conversion

Primary source:

- PostHog events:
  - `post_date_continuity_survey_complete`
  - `post_date_continuity_next_action_decided`
  - `post_date_continuity_route_taken`

PostHog insight:

```text
Funnel:
1. post_date_continuity_survey_complete
2. post_date_continuity_next_action_decided where action = ready_gate
3. post_date_continuity_route_taken where route = ready_gate

Breakdowns:
- platform
- route
- next_action
- event_id

Window:
- within 10 minutes
```

DB spot-check approximation:

```sql
with survey as (
  select
    df.user_id,
    vs.event_id,
    df.session_id as ended_session_id,
    df.created_at as survey_completed_at
  from public.date_feedback df
  join public.video_sessions vs on vs.id = df.session_id
  where df.created_at >= now() - interval '7 days'
),
next_ready_gate as (
  select
    s.user_id,
    s.event_id,
    s.ended_session_id,
    min(o.created_at) as next_ready_gate_opened_at
  from survey s
  join public.event_loop_observability_events o
    on o.event_id = s.event_id
   and o.actor_id = s.user_id
   and o.created_at >= s.survey_completed_at
   and o.created_at < s.survey_completed_at + interval '10 minutes'
   and (
     (o.operation = 'handle_swipe' and o.outcome = 'success' and o.reason_code = 'match_immediate')
     or (o.operation = 'promote_ready_gate_if_eligible' and o.outcome = 'success')
   )
  group by s.user_id, s.event_id, s.ended_session_id
)
select
  s.event_id,
  count(*) as surveys,
  count(n.next_ready_gate_opened_at) as next_ready_gate_opens,
  count(n.next_ready_gate_opened_at)::numeric / nullif(count(*), 0) as conversion_rate
from survey s
left join next_ready_gate n
  on n.user_id = s.user_id
 and n.event_id = s.event_id
 and n.ended_session_id = s.ended_session_id
group by s.event_id
order by conversion_rate asc nulls last;
```

The DB query is a correlation aid. Use PostHog for the exact client route decision because the continuity bridge can route to Ready Gate, fresh deck, last-chance, or empty states based on multiple backend-derived inputs.

## 4. Queue Drain Failure Rate

Source:

- Preferred: `v_event_loop_observability_metric_streams`
- Fallback: `v_event_loop_drain_events`

SQL:

```sql
with drain as (
  select
    event_id,
    outcome,
    coalesce(reason_code, 'none') as reason_code
  from public.v_event_loop_observability_metric_streams
  where created_at >= now() - interval '24 hours'
    and metric_stream = 'drain_rpc_outer'
),
summary as (
  select
    event_id,
    count(*) as drain_attempts,
    count(*) filter (where outcome <> 'success') as drain_failures,
    count(*) filter (where outcome <> 'success')::numeric / nullif(count(*), 0) as drain_failure_rate
  from drain
  group by event_id
),
reasons as (
  select
    event_id,
    jsonb_object_agg(reason_code, reason_count order by reason_count desc) as reasons
  from (
    select event_id, reason_code, count(*) as reason_count
    from drain
    group by event_id, reason_code
  ) reason_counts
  group by event_id
)
select
  s.event_id,
  s.drain_attempts,
  s.drain_failures,
  s.drain_failure_rate,
  r.reasons
from summary s
left join reasons r on r.event_id = s.event_id
order by drain_failure_rate desc nulls last;
```

If the normalized view is unavailable in a local or stale environment, use `public.v_event_loop_drain_events` directly and do not add promotion-engine rows to the same denominator.

## 5. Timer Drift Recovered By Server Truth

Source:

- PostHog event: `video_date_timer_drift_recovered_by_server_truth`
- Payload dimensions:
  - `platform`
  - `session_id`
  - `event_id`
  - `drift_ms`
  - `drift_bucket`
  - `drift_direction`
  - `recovery_source`
  - `phase`

PostHog insight:

```text
Event: video_date_timer_drift_recovered_by_server_truth

Charts:
- count by hour
- count / video_date_join_success by hour
- p95(drift_ms) by platform

Breakdowns:
- platform
- drift_bucket
- drift_direction
- recovery_source
- event_id
```

Implementation notes:

- The event fires only in the date phase.
- The event does not fire on the first handshake-to-date timer establishment.
- Corrections under 3 seconds are ignored to avoid normal render/tick noise.
- No user text, names, emails, or profile fields are included.

## Operator Checklist

1. Open Supabase SQL editor with service role or equivalent operator access.
2. Run the queue drain query first; high drain failure usually explains weak Ready Gate conversion.
3. Run Ready Gate open to join latency for the same event window.
4. Use PostHog continuity funnel for survey to Ready Gate routing.
5. Use timer drift events as a client health signal, not as server truth. Server truth remains `video_sessions.date_started_at` plus `date_extra_seconds`.
6. Confirm `20260501092000_handle_swipe_presence_and_already_matched_session.sql` is deployed before labeling `already_matched + video_session_id` as recovered/routable.
