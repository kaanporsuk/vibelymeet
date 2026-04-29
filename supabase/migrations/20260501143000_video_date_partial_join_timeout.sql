-- Handshake partial-join timeout:
-- preserve the existing no-evidence Ready Gate / handshake expiry behavior, but
-- add a backend-owned terminal path for exactly one persisted Daily join.

DROP FUNCTION IF EXISTS public.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base(integer);

ALTER FUNCTION public.expire_stale_video_date_phases_bounded(integer)
  RENAME TO expire_stale_video_date_phases_bounded_20260501143000_partial_join_base;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_partial_joins_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_partial int := 0;
  v_rowcnt int := 0;
  v_timeout_anchor timestamptz;
  v_joined_participant_id uuid;
  v_missing_participant_id uuid;
  v_joined_slot text;
BEGIN
  FOR r IN
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      started_at,
      handshake_started_at,
      ended_reason,
      participant_1_joined_at,
      participant_2_joined_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL))
      AND GREATEST(
        COALESCE(participant_1_joined_at, '-infinity'::timestamptz),
        COALESCE(participant_2_joined_at, '-infinity'::timestamptz),
        COALESCE(handshake_started_at, '-infinity'::timestamptz),
        COALESCE(started_at, '-infinity'::timestamptz)
      ) + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY GREATEST(
      COALESCE(participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(handshake_started_at, '-infinity'::timestamptz),
      COALESCE(started_at, '-infinity'::timestamptz)
    ), id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_timeout_anchor := GREATEST(
      COALESCE(r.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(r.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(r.handshake_started_at, '-infinity'::timestamptz),
      COALESCE(r.started_at, '-infinity'::timestamptz)
    );
    v_joined_participant_id :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN r.participant_1_id
        ELSE r.participant_2_id
      END;
    v_missing_participant_id :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN r.participant_2_id
        ELSE r.participant_1_id
      END;
    v_joined_slot :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN 'participant_1'
        ELSE 'participant_2'
      END;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'partial_join_peer_timeout',
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(handshake_started_at, started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL));

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      'partial_join_peer_timeout',
      NULL,
      r.event_id,
      v_joined_participant_id,
      r.id,
      jsonb_build_object(
        'action', 'partial_join_peer_timeout',
        'transition', 'handshake_to_ended',
        'timeout_source', 'expire_stale_video_date_phases_bounded',
        'watchdog_source', 'server_cleanup',
        'event_id', r.event_id,
        'session_id', r.id,
        'actor_user_id', v_joined_participant_id,
        'joined_participant_id', v_joined_participant_id,
        'missing_participant_id', v_missing_participant_id,
        'joined_slot', v_joined_slot,
        'prior_state', 'handshake',
        'prior_reason', r.ended_reason,
        'next_state', 'ended',
        'next_reason', 'partial_join_peer_timeout',
        'timeout_anchor', v_timeout_anchor,
        'timeout_seconds', 90,
        'elapsed_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_timeout_anchor)))::int),
        'joined_evidence', jsonb_build_object(
          'participant_1_joined', r.participant_1_joined_at IS NOT NULL,
          'participant_2_joined', r.participant_2_joined_at IS NOT NULL,
          'participant_1_joined_at', r.participant_1_joined_at,
          'participant_2_joined_at', r.participant_2_joined_at
        )
      )
    );

    v_partial := v_partial + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'partial_join_peer_timeout', v_partial,
    'limit', v_limit,
    'total', v_partial
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_partial_joins_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_partial_joins_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_partial_joins_bounded(integer) IS
  'Bounded cleanup for handshakes where exactly one participant has persisted Daily joined evidence and the peer never arrived. Emits per-session observability and ends with partial_join_peer_timeout.';

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
  v_base := public.expire_stale_video_date_phases_bounded_20260501143000_partial_join_base(v_limit);
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
  'Bounded stale video-date phase cleanup. Preserves no-evidence Ready Gate/handshake expiry semantics and adds backend-owned partial_join_peer_timeout for exactly-one-joined Daily handshakes.';
