-- Require one-sided remote-seen evidence to be current for the latest provider
-- session before provider-overlap promotion can start a date.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_stable_copresence_v1(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_p1_provider jsonb := '{}'::jsonb;
  v_p2_provider jsonb := '{}'::jsonb;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_participant_1_active_since_at timestamptz;
  v_participant_2_active_since_at timestamptz;
  v_latest_joined_at timestamptz;
  v_heartbeat_floor_at timestamptz;
  v_participant_1_first_heartbeat_at timestamptz;
  v_participant_1_heartbeat_at timestamptz;
  v_participant_2_first_heartbeat_at timestamptz;
  v_participant_2_heartbeat_at timestamptz;
  v_latest_heartbeat_at timestamptz;
  v_copresence_since_at timestamptz;
  v_remote_seen boolean := false;
  v_one_remote_seen boolean := false;
  v_heartbeat_overlap boolean := false;
  v_heartbeat_fresh boolean := false;
  v_one_remote_seen_provider_current boolean := false;
  v_stable boolean := false;
  v_waiting boolean := true;
  v_reason text := 'missing_session';
  v_skew_grace interval := interval '2 seconds';
  v_freshness_grace interval := interval '25 seconds';
BEGIN
  SELECT * INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'stable_copresence', false,
      'waiting_for_stable_copresence', true,
      'reason', v_reason,
      'retry_after_ms', 750
    );
  END IF;

  v_p1_provider := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_row.participant_1_id
  );
  v_p2_provider := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_row.participant_2_id
  );

  v_participant_1_active := COALESCE((v_p1_provider->>'active')::boolean, false);
  v_participant_2_active := COALESCE((v_p2_provider->>'active')::boolean, false);
  v_participant_1_active_since_at := NULLIF(v_p1_provider->>'active_since_at', '')::timestamptz;
  v_participant_2_active_since_at := NULLIF(v_p2_provider->>'active_since_at', '')::timestamptz;

  IF v_participant_1_active_since_at IS NOT NULL
     AND v_participant_2_active_since_at IS NOT NULL THEN
    v_latest_joined_at := GREATEST(
      v_participant_1_active_since_at,
      v_participant_2_active_since_at
    );
    v_heartbeat_floor_at := v_latest_joined_at - v_skew_grace;
  END IF;

  IF v_heartbeat_floor_at IS NOT NULL THEN
    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_1_first_heartbeat_at, v_participant_1_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_1_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_heartbeat_floor_at
      AND (
        vpe.event_type = 'owner_heartbeat'
        OR (
          vpe.provider_session_id IS NOT NULL
          AND vpe.owner_state = 'joined'
        )
      );

    SELECT min(vpe.occurred_at), max(vpe.occurred_at)
    INTO v_participant_2_first_heartbeat_at, v_participant_2_heartbeat_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_row.participant_2_id
      AND vpe.event_type IN ('owner_heartbeat', 'client_daily_alive')
      AND vpe.occurred_at >= v_heartbeat_floor_at
      AND (
        vpe.event_type = 'owner_heartbeat'
        OR (
          vpe.provider_session_id IS NOT NULL
          AND vpe.owner_state = 'joined'
        )
      );
  END IF;

  IF v_participant_1_heartbeat_at IS NOT NULL
     AND v_participant_2_heartbeat_at IS NOT NULL THEN
    v_latest_heartbeat_at := GREATEST(
      v_participant_1_heartbeat_at,
      v_participant_2_heartbeat_at
    );
    v_copresence_since_at := GREATEST(
      v_participant_1_first_heartbeat_at,
      v_participant_2_first_heartbeat_at
    );
    v_heartbeat_overlap := true;
    v_heartbeat_fresh :=
      v_participant_1_heartbeat_at >= v_now - v_freshness_grace
      AND v_participant_2_heartbeat_at >= v_now - v_freshness_grace;
  END IF;

  v_remote_seen :=
    v_participant_1_active
    AND v_participant_2_active
    AND v_row.participant_1_remote_seen_at IS NOT NULL
    AND v_row.participant_2_remote_seen_at IS NOT NULL
    AND (
      v_participant_1_active_since_at IS NULL
      OR v_row.participant_1_remote_seen_at >= v_participant_1_active_since_at - interval '5 seconds'
    )
    AND (
      v_participant_2_active_since_at IS NULL
      OR v_row.participant_2_remote_seen_at >= v_participant_2_active_since_at - interval '5 seconds'
    );

  v_one_remote_seen :=
    (v_row.participant_1_remote_seen_at IS NOT NULL)
    <> (v_row.participant_2_remote_seen_at IS NOT NULL);
  v_one_remote_seen_provider_current :=
    v_participant_1_active
    AND v_participant_2_active
    AND v_one_remote_seen
    AND v_latest_joined_at IS NOT NULL
    AND v_latest_joined_at <= v_now - v_skew_grace
    AND (
      (
        v_row.participant_1_remote_seen_at IS NOT NULL
        AND (
          v_participant_1_active_since_at IS NULL
          OR v_row.participant_1_remote_seen_at >= v_participant_1_active_since_at - interval '5 seconds'
        )
      )
      OR (
        v_row.participant_2_remote_seen_at IS NOT NULL
        AND (
          v_participant_2_active_since_at IS NULL
          OR v_row.participant_2_remote_seen_at >= v_participant_2_active_since_at - interval '5 seconds'
        )
      )
    );

  IF NOT v_participant_1_active OR NOT v_participant_2_active THEN
    v_reason := CASE
      WHEN v_row.date_started_at IS NOT NULL
        OR v_row.state = 'date'::public.video_date_state
        OR v_row.phase = 'date'
        THEN 'already_date_provider_missing'
      ELSE 'provider_presence_missing'
    END;
  ELSIF v_row.date_started_at IS NOT NULL
        OR v_row.state = 'date'::public.video_date_state
        OR v_row.phase = 'date' THEN
    v_stable := true;
    v_reason := 'already_date_provider_current';
  ELSIF v_remote_seen THEN
    v_stable := true;
    v_reason := 'remote_seen_provider_current';
  ELSIF v_one_remote_seen_provider_current THEN
    v_stable := true;
    v_reason := 'one_remote_seen_provider_current';
  ELSIF v_latest_joined_at IS NULL THEN
    v_reason := 'missing_provider_joined_evidence';
  ELSIF NOT v_heartbeat_overlap THEN
    v_reason := 'missing_owner_heartbeat_near_provider_overlap';
  ELSIF NOT v_heartbeat_fresh THEN
    v_reason := 'owner_heartbeat_stale';
  ELSIF v_copresence_since_at <= v_now - v_skew_grace THEN
    v_stable := true;
    v_reason := 'stable_provider_owner_heartbeat_overlap';
  ELSE
    v_reason := 'owner_heartbeat_stabilizing';
  END IF;

  v_waiting := NOT v_stable;

  RETURN jsonb_build_object(
    'stable_copresence', v_stable,
    'waiting_for_stable_copresence', v_waiting,
    'reason', v_reason,
    'retry_after_ms', CASE WHEN v_waiting THEN 750 ELSE 0 END,
    'latest_joined_at', v_latest_joined_at,
    'heartbeat_floor_at', v_heartbeat_floor_at,
    'heartbeat_skew_grace_ms', EXTRACT(MILLISECONDS FROM v_skew_grace)::integer,
    'heartbeat_freshness_grace_ms', EXTRACT(MILLISECONDS FROM v_freshness_grace)::integer,
    'latest_owner_heartbeat_at', v_latest_heartbeat_at,
    'stable_copresence_since_at', v_copresence_since_at,
    'heartbeat_overlap', v_heartbeat_overlap,
    'heartbeat_fresh', v_heartbeat_fresh,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_1_active', v_participant_1_active,
    'participant_1_active_since_at', v_participant_1_active_since_at,
    'participant_1_provider_presence', v_p1_provider,
    'participant_1_first_owner_heartbeat_at', v_participant_1_first_heartbeat_at,
    'participant_1_owner_heartbeat_at', v_participant_1_heartbeat_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_2_active', v_participant_2_active,
    'participant_2_active_since_at', v_participant_2_active_since_at,
    'participant_2_provider_presence', v_p2_provider,
    'participant_2_first_owner_heartbeat_at', v_participant_2_first_heartbeat_at,
    'participant_2_owner_heartbeat_at', v_participant_2_heartbeat_at,
    'remote_seen', v_remote_seen,
    'one_remote_seen', v_one_remote_seen,
    'one_remote_seen_provider_current', v_one_remote_seen_provider_current,
    'provider_presence_required', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_stable_copresence_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_stable_copresence_v1(uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_stable_copresence_v1(uuid) IS
  'Returns provider-backed stable copresence diagnostics. One-sided remote-seen evidence must be current for the active provider session; stale one-sided media proof cannot promote a rejoin-churn session.';

NOTIFY pgrst, 'reload schema';

COMMIT;
