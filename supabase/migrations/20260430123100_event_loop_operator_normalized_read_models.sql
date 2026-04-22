-- Operator read-model additions: normalized interpretation of promotion vs drain vs mark_lobby.
-- Additive only — does not replace existing v_event_loop_* views or write paths.

-- ---------------------------------------------------------------------------
-- mark_lobby_foreground: nested promotion outcome as first-class columns + derived bucket
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_event_loop_mark_lobby_promotion_normalized
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome AS rpc_completed_observability_outcome,
  reason_code AS nested_promotion_reason_echo,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  promotion,
  promotion_promoted,
  promotion_reason,
  (promotion_promoted = 'true') AS promotion_succeeded,
  CASE
    WHEN promotion_promoted = 'true' THEN 'success'
    WHEN promotion_reason IS NULL THEN 'unknown'
    WHEN promotion_reason IN ('no_queued_session', 'session_not_promotable') THEN 'no_op'
    WHEN promotion_reason = 'participant_has_active_session_conflict' THEN 'conflict'
    WHEN promotion_reason IN (
      'event_not_valid',
      'registration_missing',
      'admission_not_confirmed',
      'self_not_present',
      'partner_not_present'
    ) THEN 'blocked'
    ELSE 'other'
  END AS promotion_derived_outcome
FROM public.v_event_loop_mark_lobby_events;

COMMENT ON VIEW public.v_event_loop_mark_lobby_promotion_normalized IS
  'mark_lobby_foreground rows with derived promotion_derived_outcome aligned to event-loop outcome taxonomy (success|no_op|blocked|conflict|other|unknown). rpc_completed_observability_outcome is almost always success because the RPC finished — use promotion_* columns for queue truth.';

COMMENT ON COLUMN public.v_event_loop_mark_lobby_promotion_normalized.rpc_completed_observability_outcome IS
  'Wrapper RPC observability outcome (typically success when mark_lobby completes). Not promotion success.';
COMMENT ON COLUMN public.v_event_loop_mark_lobby_promotion_normalized.nested_promotion_reason_echo IS
  'reason_code column stores promote_ready_gate_if_eligible reason string when not promoted (legacy echo); prefer promotion_reason + promotion_derived_outcome.';
COMMENT ON COLUMN public.v_event_loop_mark_lobby_promotion_normalized.promotion_derived_outcome IS
  'Maps nested detail.promotion JSON to the same coarse outcome families as promote_ready_gate_if_eligible observability rows.';

-- ---------------------------------------------------------------------------
-- Base table rows + metric_stream label for operator dashboards (dedupe guidance)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_event_loop_observability_metric_streams
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  operation,
  outcome,
  reason_code,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  CASE operation
    WHEN 'promote_ready_gate_if_eligible' THEN 'promotion_engine_inner'
    WHEN 'drain_match_queue' THEN 'drain_rpc_outer'
    WHEN 'mark_lobby_foreground' THEN 'mark_lobby_rpc'
    WHEN 'expire_stale_video_sessions' THEN 'expire_cleanup'
    WHEN 'handle_swipe' THEN 'handle_swipe'
    ELSE 'other'
  END AS metric_stream
FROM public.event_loop_observability_events
WHERE operation IN (
  'promote_ready_gate_if_eligible',
  'drain_match_queue',
  'mark_lobby_foreground',
  'expire_stale_video_sessions',
  'handle_swipe'
);

COMMENT ON VIEW public.v_event_loop_observability_metric_streams IS
  'Adds metric_stream for filtering. promotion_engine_inner is logged for every promote_ready_gate_if_eligible call, including those invoked inside drain_match_queue and mark_lobby_foreground — do not sum row counts across streams without dedupe rules (see docs/observability/event-loop-dashboard-normalization.md).';

COMMENT ON COLUMN public.v_event_loop_observability_metric_streams.metric_stream IS
  'promotion_engine_inner = inner helper telemetry; drain_rpc_outer = drain_match_queue RPC envelope; mark_lobby_rpc = foreground heartbeat + nested promotion JSON.';

-- ---------------------------------------------------------------------------
-- Clarify hourly rollup semantics (COMMENT only — definition unchanged)
-- ---------------------------------------------------------------------------

COMMENT ON VIEW public.v_event_loop_promotion_outcomes_hourly IS
  'Promotion success vs block vs conflict vs no-op rates and latency by hour (UTC). Counts promote_ready_gate_if_eligible rows only (engine inner path). drain_match_queue invokes that helper — each drain attempt typically produces BOTH a promotion_engine_inner row AND a drain_rpc_outer row; do not add these hourly totals without dedupe guidance. See docs/observability/event-loop-dashboard-normalization.md.';

COMMENT ON VIEW public.v_event_loop_drain_outcomes_hourly IS
  'Drain outcomes per hour for drain_match_queue RPC only (outer envelope). Inner promote_ready_gate_if_eligible outcomes are aggregated separately in v_event_loop_promotion_outcomes_hourly — see dedupe doc.';

COMMENT ON VIEW public.v_event_loop_guard_outcomes_hourly IS
  'Conflict / block / error rows by operation and reason_code. Operations include promote_ready_gate_if_eligible and drain_match_queue — remember drain wraps promote; prefer reason_code-level triage over summing operations.';

-- ---------------------------------------------------------------------------
-- Permissions (match existing operator posture: service_role SELECT only)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.v_event_loop_mark_lobby_promotion_normalized FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_observability_metric_streams FROM PUBLIC;

REVOKE ALL ON TABLE public.v_event_loop_mark_lobby_promotion_normalized FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_observability_metric_streams FROM anon, authenticated;

GRANT SELECT ON TABLE public.v_event_loop_mark_lobby_promotion_normalized TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_observability_metric_streams TO service_role;
