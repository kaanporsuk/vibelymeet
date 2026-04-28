-- Observability v2: make Daily provider room/token lifecycle visible in the
-- existing service-role-only video date session timeline.
--
-- Product semantics are unchanged. Edge Function writes still use the existing
-- fail-safe logger; if an observability insert fails, the room/token flow must
-- continue.

GRANT EXECUTE ON FUNCTION public.record_event_loop_observability(text, text, text, integer, uuid, uuid, uuid, jsonb)
  TO service_role;

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
  'Service-role-only operator timeline for a video session. Includes Ready Gate, video date transitions, Daily provider room/token lifecycle observability, and current video_sessions milestone timestamps.';
