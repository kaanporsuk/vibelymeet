-- Observability v1: add per-session Ready Gate transition rows and a
-- service-role-only timeline read model. Product transition semantics remain
-- delegated to the current ready_gate_transition implementation.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260501135000_observability_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260501135000_observability_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260501135000_observability_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_success boolean := false;
  v_status_after text;
  v_outcome text;
  v_reason_code text;
BEGIN
  SELECT * INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_result := public.ready_gate_transition_20260501135000_observability_base(
    p_session_id,
    p_action,
    p_reason
  );

  SELECT * INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_success := COALESCE(v_result @> '{"success": true}'::jsonb, false);
  v_status_after := COALESCE(v_after.ready_gate_status, v_result->>'status');

  v_reason_code := CASE
    WHEN NOT v_success THEN COALESCE(v_result->>'error', v_result->>'code', 'unknown_error')
    WHEN p_action = 'sync' AND v_status_after = 'expired' THEN 'sync_expired'
    WHEN p_action = 'sync' THEN 'sync'
    WHEN p_action = 'mark_ready' AND v_status_after = 'both_ready' THEN 'both_ready'
    WHEN p_action = 'mark_ready' THEN 'mark_ready'
    WHEN p_action = 'snooze' THEN 'snooze'
    WHEN p_action = 'forfeit' THEN 'forfeit'
    ELSE COALESCE(p_action, 'unknown_action')
  END;

  v_outcome := CASE
    WHEN v_success THEN 'success'
    WHEN v_reason_code IN ('unauthorized', 'session_not_found', 'access_denied', 'unknown_action') THEN 'blocked'
    ELSE 'error'
  END;

  PERFORM public.record_event_loop_observability(
    'ready_gate_transition',
    v_outcome,
    v_reason_code,
    NULL,
    COALESCE(v_after.event_id, v_before.event_id),
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'p_reason', p_reason,
      'success', v_success,
      'result_status', v_result->>'status',
      'result_error', v_result->>'error',
      'status_before', v_before.ready_gate_status,
      'status_after', v_status_after,
      'state_before', v_before.state::text,
      'state_after', v_after.state::text,
      'phase_before', v_before.phase,
      'phase_after', v_after.phase,
      'ready_gate_expires_at_before', v_before.ready_gate_expires_at,
      'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
      'ready_participant_1_at_before', v_before.ready_participant_1_at,
      'ready_participant_1_at_after', v_after.ready_participant_1_at,
      'ready_participant_2_at_before', v_before.ready_participant_2_at,
      'ready_participant_2_at_after', v_after.ready_participant_2_at,
      'snoozed_by_before', v_before.snoozed_by,
      'snoozed_by_after', v_after.snoozed_by,
      'snooze_expires_at_before', v_before.snooze_expires_at,
      'snooze_expires_at_after', v_after.snooze_expires_at,
      'ended_reason_after', v_after.ended_reason,
      'observed_at', now()
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Delegates unchanged transition semantics to the observability base function, then emits a fail-safe ready_gate_transition observability row.';

DROP FUNCTION IF EXISTS public.get_video_date_session_timeline(uuid);

CREATE OR REPLACE FUNCTION public.get_video_date_session_timeline(p_session_id uuid)
RETURNS TABLE (
  timeline_seq bigint,
  occurred_at timestamptz,
  source text,
  operation text,
  outcome text,
  reason_code text,
  event_id uuid,
  actor_id uuid,
  session_id uuid,
  detail jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH session_row AS (
    SELECT *
    FROM public.video_sessions
    WHERE id = p_session_id
  ),
  timeline_rows AS (
    SELECT
      eo.created_at AS occurred_at,
      'event_loop_observability_events'::text AS source,
      eo.operation,
      eo.outcome,
      eo.reason_code,
      eo.event_id,
      eo.actor_id,
      eo.session_id,
      eo.detail,
      10 AS sort_order
    FROM public.event_loop_observability_events eo
    WHERE eo.session_id = p_session_id
      AND eo.operation IN (
        'handle_swipe',
        'ready_gate_transition',
        'video_date_transition',
        'repair_stale_video_date_prepare_entries',
        'post_date_half_verdict_saved',
        'post_date_half_verdict_pending',
        'post_date_pending_verdict_completed',
        'post_date_pending_verdict_stale',
        'post_date_pending_verdict_reminder_sent',
        'post_date_pending_verdict_reminder_failed',
        'post_date_half_verdict_timeout'
      )

    UNION ALL

    SELECT
      sr.started_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      'session_started',
      sr.event_id,
      NULL::uuid,
      sr.id,
      jsonb_build_object(
        'state', sr.state::text,
        'phase', sr.phase,
        'ready_gate_status', sr.ready_gate_status
      ),
      20
    FROM session_row sr

    UNION ALL

    SELECT
      milestone.occurred_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      milestone.reason_code,
      sr.event_id,
      milestone.actor_id,
      sr.id,
      milestone.detail,
      milestone.sort_order
    FROM session_row sr
    CROSS JOIN LATERAL (
      VALUES
        (
          sr.ready_participant_1_at,
          'participant_1_ready'::text,
          sr.participant_1_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          30
        ),
        (
          sr.ready_participant_2_at,
          'participant_2_ready'::text,
          sr.participant_2_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          31
        ),
        (
          sr.handshake_started_at,
          'handshake_started'::text,
          NULL::uuid,
          jsonb_build_object('state', sr.state::text, 'phase', sr.phase),
          40
        ),
        (
          sr.participant_1_joined_at,
          'participant_1_daily_joined'::text,
          sr.participant_1_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          50
        ),
        (
          sr.participant_2_joined_at,
          'participant_2_daily_joined'::text,
          sr.participant_2_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          51
        ),
        (
          sr.date_started_at,
          'date_started'::text,
          NULL::uuid,
          jsonb_build_object('date_extra_seconds', sr.date_extra_seconds),
          60
        ),
        (
          sr.ended_at,
          COALESCE(sr.ended_reason, 'session_ended'),
          NULL::uuid,
          jsonb_build_object(
            'state', sr.state::text,
            'phase', sr.phase,
            'ended_reason', sr.ended_reason,
            'duration_seconds', sr.duration_seconds
          ),
          70
        )
    ) AS milestone(occurred_at, reason_code, actor_id, detail, sort_order)
    WHERE milestone.occurred_at IS NOT NULL
  )
  SELECT
    row_number() OVER (ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC) AS timeline_seq,
    tr.occurred_at,
    tr.source,
    tr.operation,
    tr.outcome,
    tr.reason_code,
    tr.event_id,
    tr.actor_id,
    tr.session_id,
    tr.detail
  FROM timeline_rows tr
  WHERE tr.occurred_at IS NOT NULL
  ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_session_timeline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_session_timeline(uuid) TO service_role;

COMMENT ON FUNCTION public.get_video_date_session_timeline(uuid) IS
  'Service-role-only operator timeline for a video session. Combines event_loop_observability_events rows with current video_sessions milestone timestamps; not exposed to anon/authenticated users.';
