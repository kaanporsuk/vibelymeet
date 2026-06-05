-- Video Date early confirmed-encounter promotion.
--
-- Latest production evidence showed both users entered the same Daily room and
-- both clients recorded remote media, but the session remained in handshake
-- until a deadline finalizer ended it. Confirmed bilateral media is the
-- authoritative cross-platform signal that the date has started; the deadline
-- is now only a fallback for sessions without that proof.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_promote_confirmed_encounter_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_confirmed_encounter_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_room_repair jsonb := '{}'::jsonb;
  v_expected_room_url text;
  v_participant_1_latest_evidence_at timestamptz;
  v_participant_2_latest_evidence_at timestamptz;
  v_first_confirmed_encounter_at timestamptz;
  v_has_explicit_pass boolean := false;
  v_both_decided boolean := false;
  v_confirmed_encounter boolean := false;
  v_active_confirmed_encounter boolean := false;
  v_previous_handshake_started_at timestamptz;
  v_date_started_at timestamptz;
  v_event jsonb := '{}'::jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  v_room_repair := public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    COALESCE(NULLIF(p_source, ''), 'confirmed_encounter_promotion') || ':preflight'
  );
  v_expected_room_url := COALESCE(
    NULLIF(v_room_repair->>'room_url', ''),
    'https://vibelyapp.daily.co/' || v_expected_room_name
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF p_require_participant AND p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  IF p_require_participant
     AND p_actor IS DISTINCT FROM v_session.participant_1_id
     AND p_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  IF v_session.state::text = 'date'
     OR v_session.phase = 'date'
     OR v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'already_in_date',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR v_session.phase = 'ended' THEN
    PERFORM public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      COALESCE(NULLIF(p_source, ''), 'confirmed_encounter_promotion') || ':terminal_room_repair'
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'state', 'ended',
      'phase', 'ended',
      'reason', COALESCE(v_session.ended_reason, 'already_ended'),
      'survey_required', public.video_date_session_is_post_date_survey_eligible_v2(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at,
        v_session.participant_1_remote_seen_at,
        v_session.participant_2_remote_seen_at
      ),
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.state IS DISTINCT FROM 'handshake'::public.video_date_state
     OR COALESCE(v_session.phase, '') <> 'handshake'
     OR v_session.handshake_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'state', COALESCE(v_session.state::text, 'unknown'),
      'phase', COALESCE(v_session.phase, 'unknown'),
      'reason', 'not_active_handshake',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_previous_handshake_started_at := v_session.handshake_started_at;
  v_has_explicit_pass := (
    (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
    OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
  );
  v_both_decided := v_session.participant_1_decided_at IS NOT NULL
    AND v_session.participant_2_decided_at IS NOT NULL;

  v_participant_1_latest_evidence_at := GREATEST(
    COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz)
  );
  v_participant_2_latest_evidence_at := GREATEST(
    COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
  );
  v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );
  v_active_confirmed_encounter := v_confirmed_encounter
    AND (
      v_session.participant_1_away_at IS NULL
      OR v_session.participant_1_away_at <= v_participant_1_latest_evidence_at
    )
    AND (
      v_session.participant_2_away_at IS NULL
      OR v_session.participant_2_away_at <= v_participant_2_latest_evidence_at
    );

  IF v_has_explicit_pass
     OR v_both_decided
     OR NOT v_active_confirmed_encounter THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'confirmed_encounter_promotion_not_ready',
      NULL,
      v_session.event_id,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'p_reason', p_reason,
        'has_explicit_pass', v_has_explicit_pass,
        'both_decided', v_both_decided,
        'confirmed_encounter', v_confirmed_encounter,
        'active_confirmed_encounter', v_active_confirmed_encounter,
        'participant_1_joined_at', v_session.participant_1_joined_at,
        'participant_2_joined_at', v_session.participant_2_joined_at,
        'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
        'participant_1_away_at', v_session.participant_1_away_at,
        'participant_2_away_at', v_session.participant_2_away_at,
        'participant_1_latest_evidence_at', NULLIF(v_participant_1_latest_evidence_at, '-infinity'::timestamptz),
        'participant_2_latest_evidence_at', NULLIF(v_participant_2_latest_evidence_at, '-infinity'::timestamptz)
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'reason', CASE
        WHEN v_has_explicit_pass THEN 'explicit_pass_present'
        WHEN v_both_decided THEN 'both_decided_before_promotion'
        WHEN NOT v_confirmed_encounter THEN 'confirmed_encounter_not_ready'
        ELSE 'confirmed_encounter_not_active'
      END,
      'confirmed_encounter', v_confirmed_encounter,
      'active_confirmed_encounter', v_active_confirmed_encounter,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_date_started_at := v_now;
  v_first_confirmed_encounter_at := GREATEST(
    COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
  );

  UPDATE public.video_sessions
  SET
    state = 'date'::public.video_date_state,
    phase = 'date',
    date_started_at = v_date_started_at,
    ended_at = NULL,
    ended_reason = NULL,
    reconnect_grace_ends_at = NULL,
    handshake_grace_expires_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    daily_room_name = v_expected_room_name,
    daily_room_url = v_expected_room_url,
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'confirmed_encounter_promotion_room_restored'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'handshake'::public.video_date_state
    AND COALESCE(phase, '') = 'handshake'
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
    'confirmed_encounter_promoted_to_date',
    'participants',
    p_actor,
    jsonb_build_object(
      'action', 'complete_handshake',
      'source', p_source,
      'p_reason', p_reason,
      'previous_handshake_started_at', v_previous_handshake_started_at,
      'date_started_at', v_date_started_at,
      'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
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
      'date_started_at', v_date_started_at,
      'reason', 'confirmed_encounter_early_promotion'
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
    'confirmed_encounter_promoted_to_date',
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
      'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'event_result', v_event
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'promoted', true,
    'state', 'date',
    'phase', 'date',
    'date_started_at', v_session.date_started_at,
    'reason', 'confirmed_encounter_early_promotion',
    'confirmed_encounter', true,
    'active_confirmed_encounter', true,
    'event_result', v_event,
    'session_seq', COALESCE(v_session.session_seq, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean) IS
  'Promotes an active handshake to date as soon as both participants have same-room Daily joins and bilateral remote-media evidence. Shared by web/native/mobile RPC entrypoints.';

DROP FUNCTION IF EXISTS public.mark_video_date_remote_seen_20260605115657_base(uuid);

ALTER FUNCTION public.mark_video_date_remote_seen(uuid)
  RENAME TO mark_video_date_remote_seen_20260605115657_base;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen_20260605115657_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen_20260605115657_base(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_ok boolean := false;
BEGIN
  v_result := public.mark_video_date_remote_seen_20260605115657_base(p_session_id);
  v_ok := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF NOT v_ok THEN
    RETURN v_result;
  END IF;

  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    v_actor,
    'mark_video_date_remote_seen',
    'remote_media_observed',
    true
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_result || jsonb_build_object(
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_promotion->'date_started_at',
      'early_confirmed_encounter_promoted', true,
      'promotion_reason', v_promotion->>'reason',
      'session_seq', v_promotion->'session_seq'
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Marks canonical remote-media evidence and immediately promotes an active handshake to date once bilateral Daily join plus remote-media proof exists.';

DROP FUNCTION IF EXISTS public.vs_handshake_auto_promote_20260605115657_base(uuid, text, text);

ALTER FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  RENAME TO vs_handshake_auto_promote_20260605115657_base;

REVOKE ALL ON FUNCTION public.vs_handshake_auto_promote_20260605115657_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vs_handshake_auto_promote_20260605115657_base(uuid, text, text)
  TO service_role;

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
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2',
    COALESCE(NULLIF(p_request_hash, ''), NULLIF(p_idempotency_key, ''), 'client_auto_promote'),
    true
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  IF COALESCE(v_promotion->>'error', '') IN ('not_participant', 'session_not_found') THEN
    RETURN v_promotion;
  END IF;

  v_result := public.vs_handshake_auto_promote_20260605115657_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text) IS
  'Client handshake auto-promote. Confirmed bilateral Daily media bypasses the deadline; otherwise existing deadline/idempotency semantics are delegated unchanged.';

DROP FUNCTION IF EXISTS public.finalize_vd_handshake_deadline_20260605115657_base(uuid, uuid, text, text);

ALTER FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  RENAME TO finalize_vd_handshake_deadline_20260605115657_base;

REVOKE ALL ON FUNCTION public.finalize_vd_handshake_deadline_20260605115657_base(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_vd_handshake_deadline_20260605115657_base(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    p_actor,
    COALESCE(NULLIF(p_source, ''), 'finalize_video_date_handshake_deadline'),
    p_reason,
    false
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  v_result := public.finalize_vd_handshake_deadline_20260605115657_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason
  );

  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'finalize_video_date_handshake_deadline:post_base_room_repair'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text) IS
  'Handshake deadline finalizer. Confirmed bilateral Daily media starts the date before deadline fallback; terminal fallback preserves canonical room metadata for survey recovery.';

COMMIT;
