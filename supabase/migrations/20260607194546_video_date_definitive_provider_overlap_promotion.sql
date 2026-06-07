-- Video Date definitive provider-overlap promotion.
--
-- The 2026-06-07 production run reached Ready Gate, the same Daily room, and
-- provider-backed media, but the server stayed in handshake because the stable
-- copresence guard required perfectly ordered post-join heartbeats and one
-- participant's remote-seen RPC did not persist. This follow-up makes current
-- provider-backed overlap the shared promotion authority for web, native, and
-- mobile, while keeping bilateral remote-seen as the strongest signal.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_session_has_confirmed_encounter(
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz,
  p_participant_1_remote_seen_at timestamptz,
  p_participant_2_remote_seen_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT (
      p_participant_1_remote_seen_at IS NOT NULL
      AND p_participant_2_remote_seen_at IS NOT NULL
      AND (
        p_date_started_at IS NOT NULL
        OR (
          p_participant_1_joined_at IS NOT NULL
          AND p_participant_2_joined_at IS NOT NULL
        )
      )
    )
    OR (
      p_date_started_at IS NOT NULL
      AND p_participant_1_joined_at IS NOT NULL
      AND p_participant_2_joined_at IS NOT NULL
      AND (
        COALESCE(p_state, '') IN ('date', 'ended')
        OR COALESCE(p_phase, '') IN ('date', 'ended', 'verdict')
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_has_confirmed_encounter(
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_session_has_confirmed_encounter(
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) TO service_role;

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
    AND v_latest_joined_at <= v_now - v_skew_grace;

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

CREATE OR REPLACE FUNCTION public.video_date_promote_provider_overlap_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_provider_overlap_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_has_explicit_pass boolean := false;
  v_both_decided boolean := false;
  v_expected_room_name text;
  v_expected_room_url text;
  v_room_repair jsonb := '{}'::jsonb;
  v_event jsonb := '{}'::jsonb;
  v_previous_handshake_started_at timestamptz;
  v_date_started_at timestamptz;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF p_require_participant AND p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF p_require_participant
     AND p_actor IS DISTINCT FROM v_session.participant_1_id
     AND p_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  v_expected_room_name := 'date-' || replace(p_session_id::text, '-', '');
  v_room_repair := public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    COALESCE(NULLIF(p_source, ''), 'provider_overlap_promotion') || ':preflight'
  );
  v_expected_room_url := COALESCE(
    NULLIF(v_room_repair->>'room_url', ''),
    NULLIF(v_session.daily_room_url, ''),
    'https://vibelyapp.daily.co/' || v_expected_room_name
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR v_session.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', 'ended',
      'phase', 'ended',
      'reason', COALESCE(v_session.ended_reason, 'already_ended'),
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'already_in_date',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.ready_gate_status IS DISTINCT FROM 'both_ready'
     AND v_session.state IS DISTINCT FROM 'handshake'::public.video_date_state
     AND COALESCE(v_session.phase, '') <> 'handshake'
     AND v_session.handshake_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', COALESCE(v_session.state::text, 'unknown'),
      'phase', COALESCE(v_session.phase, 'unknown'),
      'reason', 'not_routeable_for_provider_overlap',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_has_explicit_pass := (
    (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
    OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
  );
  v_both_decided := v_session.participant_1_decided_at IS NOT NULL
    AND v_session.participant_2_decided_at IS NOT NULL;

  IF v_has_explicit_pass OR v_both_decided THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'reason', CASE
        WHEN v_has_explicit_pass THEN 'explicit_pass_present'
        ELSE 'both_decided_before_provider_overlap_promotion'
      END,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);

  IF NOT v_stable_copresence THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'provider_overlap_promotion_waiting',
      NULL,
      v_session.event_id,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'p_reason', p_reason,
        'stable_copresence', v_stable
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'reason', COALESCE(v_stable->>'reason', 'stable_copresence_not_ready'),
      'waiting_for_stable_copresence', true,
      'stable_copresence', v_stable,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_previous_handshake_started_at := v_session.handshake_started_at;
  v_date_started_at := v_now;

  UPDATE public.video_sessions
  SET
    handshake_started_at = COALESCE(handshake_started_at, v_now),
    state = 'date'::public.video_date_state,
    phase = 'date',
    date_started_at = v_date_started_at,
    ended_at = NULL,
    ended_reason = NULL,
    reconnect_grace_ends_at = NULL,
    handshake_grace_expires_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    daily_room_name = COALESCE(NULLIF(daily_room_name, ''), v_expected_room_name),
    daily_room_url = COALESCE(NULLIF(daily_room_url, ''), v_expected_room_url),
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'provider_overlap_promotion_room_restored'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND date_started_at IS NULL
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', COALESCE(v_session.state::text, 'unknown'),
      'phase', COALESCE(v_session.phase, 'unknown'),
      'reason', 'promotion_lost_race',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_date',
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  v_event := public.append_video_session_event_v2(
    p_session_id,
    'provider_overlap_promoted_to_date',
    'participants',
    p_actor,
    jsonb_build_object(
      'action', 'complete_handshake',
      'source', p_source,
      'p_reason', p_reason,
      'previous_handshake_started_at', v_previous_handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'stable_copresence', v_stable,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url
    ),
    jsonb_build_object(
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'provider_overlap_promotion'
    ),
    true,
    gen_random_uuid()
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'provider_overlap_promoted_to_date',
    NULL,
    v_session.event_id,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'action', 'complete_handshake',
      'source', p_source,
      'p_reason', p_reason,
      'previous_handshake_started_at', v_previous_handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'stable_copresence', v_stable,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'event_result', v_event
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'promoted', true,
    'provider_overlap_promoted_to_date', true,
    'state', 'date',
    'phase', 'date',
    'date_started_at', v_session.date_started_at,
    'reason', 'provider_overlap_promotion',
    'stable_copresence', v_stable,
    'event_result', v_event,
    'session_seq', COALESCE(v_session.session_seq, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_promote_provider_overlap_v1(
  uuid, uuid, text, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_provider_overlap_v1(
  uuid, uuid, text, text, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.mark_video_date_daily_alive_20260607155414_lifecycle_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  );
  v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

  IF COALESCE((v_enriched->>'retryable')::boolean, true)
     OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
    v_promotion := public.video_date_promote_provider_overlap_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      'provider_backed_alive',
      true
    );
  END IF;

  RETURN v_enriched || jsonb_build_object(
    'provider_overlap_promotion', v_promotion,
    'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
    'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      'daily_alive_stamp_failed',
      'DAILY_ALIVE_STAMP_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.mark_video_date_daily_joined_20260607155414_lifecycle_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
  );
  v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

  IF COALESCE((v_enriched->>'retryable')::boolean, true)
     OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
    v_promotion := public.video_date_promote_provider_overlap_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_joined',
      'provider_backed_joined',
      true
    );
  END IF;

  RETURN v_enriched || jsonb_build_object(
    'provider_overlap_promotion', v_promotion,
    'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
    'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_joined',
      'daily_join_stamp_failed',
      'DAILY_JOIN_STAMP_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := public.mark_video_date_remote_seen_20260607155414_lifecycle_base(
    p_session_id
  );
  v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

  IF COALESCE((v_enriched->>'retryable')::boolean, true)
     OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
    v_promotion := public.video_date_promote_provider_overlap_v1(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      'remote_media_or_provider_overlap',
      true
    );
  END IF;

  RETURN v_enriched || jsonb_build_object(
    'provider_overlap_promotion', v_promotion,
    'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
    'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      'remote_seen_failed',
      'REMOTE_SEEN_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_provider_promotion jsonb := '{}'::jsonb;
  v_confirmed_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_provider_promotion := public.video_date_promote_provider_overlap_v1(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2',
    COALESCE(NULLIF(p_request_hash, ''), NULLIF(p_idempotency_key, ''), 'client_auto_promote'),
    true
  );

  IF COALESCE((v_provider_promotion->>'provider_overlap_promoted_to_date')::boolean, false) THEN
    RETURN v_provider_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', false,
      'retryable', false
    );
  END IF;

  v_confirmed_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2',
    COALESCE(NULLIF(p_request_hash, ''), NULLIF(p_idempotency_key, ''), 'client_auto_promote'),
    true
  );

  IF COALESCE((v_confirmed_promotion->>'promoted')::boolean, false) THEN
    RETURN v_confirmed_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'provider_overlap_promotion', v_provider_promotion,
      'retryable', false
    );
  END IF;

  IF COALESCE(v_confirmed_promotion->>'error', '') IN ('not_participant', 'session_not_found') THEN
    RETURN v_confirmed_promotion || jsonb_build_object(
      'provider_overlap_promotion', v_provider_promotion
    );
  END IF;

  v_result := public.vs_handshake_auto_promote_20260605115657_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'provider_overlap_promotion', v_provider_promotion,
    'provider_overlap_promoted_to_date', COALESCE((v_provider_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
    'promotion_reason', COALESCE(v_provider_promotion->>'reason', v_confirmed_promotion->>'reason'),
    'active_confirmed_encounter', COALESCE((v_confirmed_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_server_now_ms bigint;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_deadline_at timestamptz;
  v_actor_role text;
  v_partner_id uuid;
  v_ready_gate_status text;
  v_i_am_ready boolean := false;
  v_partner_ready boolean := false;
  v_is_participant boolean := false;
  v_is_blocked boolean := false;
  v_inactive_reason text := NULL;
  v_can_mark_ready boolean := false;
  v_can_enter_date boolean := false;
  v_terminal boolean := false;
  v_retryable boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_is_participant :=
    v_uid = v_session.participant_1_id
    OR v_uid = v_session.participant_2_id;

  IF NOT v_is_participant THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'error_code', 'NOT_PARTICIPANT',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');

  BEGIN
    v_is_blocked := public.is_blocked(v_session.participant_1_id, v_session.participant_2_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'blocked_pair_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'safety_check_unavailable',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'auxiliary_errors', v_auxiliary_errors,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF v_is_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'viewer_role', CASE
        WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
        ELSE 'participant_2'
      END,
      'partner_id', CASE
        WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END,
      'error', 'blocked_pair',
      'error_code', 'BLOCKED_PAIR',
      'reason', 'blocked_pair',
      'ended_reason', 'blocked_pair',
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'can_mark_ready', false,
      'can_enter_date', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'event_active_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      v_inactive_reason := NULL;
  END;

  v_actor_role := CASE
    WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
    WHEN v_uid = v_session.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_partner_id := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;
  v_i_am_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_1_at IS NOT NULL
    ELSE v_session.ready_participant_2_at IS NOT NULL
  END;
  v_partner_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_2_at IS NOT NULL
    ELSE v_session.ready_participant_1_at IS NOT NULL
  END;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_deadline_at := COALESCE(
    v_deadline_row_at,
    CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END
  );

  v_terminal :=
    v_session.ended_at IS NOT NULL
    OR v_session.state::text = 'ended'
    OR v_ready_gate_status IN ('expired', 'forfeited', 'cancelled', 'ended');

  v_can_mark_ready :=
    v_inactive_reason IS NULL
    AND v_session.ended_at IS NULL
    AND v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      v_session.ready_gate_expires_at IS NULL
      OR v_session.ready_gate_expires_at > v_now
      OR v_ready_gate_status = 'snoozed'
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snooze_expires_at IS NULL
      OR v_session.snooze_expires_at > v_now
    );

  v_can_enter_date :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_session.date_started_at IS NOT NULL
      OR v_session.state::text = 'date'
      OR v_ready_gate_status = 'both_ready'
    )
    AND v_session.daily_room_name IS NOT NULL
    AND v_session.daily_room_url IS NOT NULL;

  v_retryable :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_phase IN ('handshake', 'date')
    );

  v_allowed := CASE
    WHEN v_can_mark_ready THEN ARRAY['mark_ready', 'forfeit']::text[]
    WHEN v_can_enter_date THEN ARRAY['enter_date']::text[]
    WHEN v_ready_gate_status = 'both_ready' THEN ARRAY['enter_date']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN
    jsonb_build_object(
      'ok', true,
      'success', true,
      'snapshot', true,
      'source', 'get_video_date_start_snapshot_v1',
      'session_id', v_session.id,
      'sessionId', v_session.id,
      'event_id', v_session.event_id,
      'eventId', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'partnerId', v_partner_id,
      'viewer_id', v_uid,
      'viewerId', v_uid,
      'actor_role', v_actor_role,
      'actorRole', v_actor_role,
      'viewer_role', v_actor_role,
      'viewerRole', v_actor_role,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'state', v_session.state,
      'phase', v_session.phase,
      'normalized_phase', v_phase,
      'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
      'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
      'seq', COALESCE(v_session.session_seq, 0),
      'session_seq', COALESCE(v_session.session_seq, 0)
    )
    || jsonb_build_object(
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at,
      'i_am_ready', v_i_am_ready,
      'iAmReady', v_i_am_ready,
      'partner_ready', v_partner_ready,
      'partnerReady', v_partner_ready,
      'is_both_ready', v_ready_gate_status = 'both_ready',
      'isBothReady', v_ready_gate_status = 'both_ready',
      'handshake_started_at', v_session.handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
    )
    || jsonb_build_object(
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'room', CASE
        WHEN v_session.daily_room_url IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', v_session.daily_room_name,
          'url', v_session.daily_room_url,
          'tokenRequired', true
        )
      END,
      'ended_at', v_session.ended_at,
      'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END,
      'ended_reason', v_session.ended_reason,
      'endedReason', v_session.ended_reason,
      'inactive_reason', v_inactive_reason,
      'inactiveReason', v_inactive_reason
    )
    || jsonb_build_object(
      'can_mark_ready', v_can_mark_ready,
      'canMarkReady', v_can_mark_ready,
      'can_enter_date', v_can_enter_date,
      'canEnterDate', v_can_enter_date,
      'terminal', v_terminal,
      'retryable', v_retryable,
      'allowedActions', to_jsonb(v_allowed),
      'auxiliary_errors', v_auxiliary_errors,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms,
      'serverNow', v_server_now_ms
    );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'start_snapshot_failed',
      'error_code', 'START_SNAPSHOT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_start_snapshot_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_session_has_confirmed_encounter(
  timestamptz, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) IS
  'Returns true for bilateral remote-media proof or a server-started provider-backed date with both Daily joins.';
COMMENT ON FUNCTION public.video_date_stable_copresence_v1(uuid) IS
  'Provider-authoritative stable copresence check with two-second join/heartbeat skew tolerance and one-sided remote-seen provider overlap recovery.';
COMMENT ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean) IS
  'Shared provider-backed overlap promoter for web, native, and mobile date-entry RPCs. Starts date truth once current Daily provider evidence proves the encounter.';
COMMENT ON FUNCTION public.get_video_date_start_snapshot_v1(uuid) IS
  'Participant-safe Video Date startup snapshot. both_ready is active routeable truth, not terminal.';

NOTIFY pgrst, 'reload schema';

COMMIT;
