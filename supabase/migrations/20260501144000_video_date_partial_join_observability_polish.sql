-- Post-merge polish for the partial Daily join timeout path:
-- 1) Give the private delegated phase-cleanup helper a deliberate short name
--    instead of relying on Postgres' 63-byte identifier truncation.
-- 2) Surface per-session stale-cleanup observability rows in the operator
--    timeline now that partial joins emit session-scoped cleanup events.

DO $$
BEGIN
  IF to_regprocedure('public.expire_stale_video_date_phases_bounded_20260501143000_partial_j(integer)') IS NOT NULL
     AND to_regprocedure('public.expire_vd_phases_base_20260501133000(integer)') IS NULL THEN
    ALTER FUNCTION public.expire_stale_video_date_phases_bounded_20260501143000_partial_j(integer)
      RENAME TO expire_vd_phases_base_20260501133000;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_vd_phases_base_20260501133000(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_vd_phases_base_20260501133000(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_vd_phases_base_20260501133000(integer) IS
  'Private delegated stale video-date phase cleanup from 20260501133000. Called by expire_stale_video_date_phases_bounded after partial-join overlay migrations.';

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_base jsonb;
  v_partial jsonb;
  v_base_total int := 0;
  v_partial_total int := 0;
BEGIN
  v_base := public.expire_vd_phases_base_20260501133000(v_limit);
  v_partial := public.expire_stale_video_date_partial_joins_bounded(v_limit);
  v_base_total := COALESCE((v_base->>'total')::int, 0);
  v_partial_total := COALESCE((v_partial->>'total')::int, 0);

  RETURN v_base || jsonb_build_object(
    'partial_join_peer_timeout', COALESCE((v_partial->>'partial_join_peer_timeout')::int, 0),
    'total', v_base_total + v_partial_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) IS
  'Bounded stale video-date phase cleanup. Delegates no-evidence cleanup to the 20260501133000 base helper and adds backend-owned partial_join_peer_timeout for exactly-one-joined Daily handshakes.';

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
        'expire_stale_video_sessions',
        'post_date_half_verdict_saved',
        'post_date_half_verdict_pending',
        'post_date_pending_verdict_completed',
        'post_date_pending_verdict_stale',
        'post_date_pending_verdict_reminder_sent',
        'post_date_pending_verdict_reminder_failed',
        'post_date_half_verdict_timeout',
        'create_date_room_attempt',
        'create_date_room_reused_existing_db_room',
        'create_date_room_provider_already_exists',
        'create_date_room_provider_created',
        'create_date_room_provider_recovered_or_recreated',
        'create_date_room_token_issued',
        'create_date_room_blocked_session_ended',
        'create_date_room_blocked_access_denied',
        'create_date_room_provider_error'
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
  'Service-role-only operator timeline for a video session. Includes Ready Gate, video date transitions, stale cleanup, Daily provider room/token lifecycle observability, and current video_sessions milestone timestamps.';
