-- Provider-backed Daily joined confirmation and post-encounter provider
-- absence terminal recovery.
--
-- The previous recovery made mark_video_date_daily_alive provider-authoritative,
-- but /date still called mark_video_date_daily_joined with only p_session_id.
-- That left a second legacy join-stamp path and made post-encounter provider
-- absence depend on generic reconnect expiry. This migration makes the joined
-- RPC a compatibility facade over the provider-backed alive contract, and lets
-- Daily webhook/provider absence truth drive the short reconnect grace and
-- terminal survey transition.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_video_date_daily_webhook_events_provider_latest
  ON public.video_date_daily_webhook_events (
    session_id,
    provider_user_id,
    event_type,
    occurred_at DESC,
    created_at DESC
  )
  WHERE event_type IN ('participant.joined', 'participant.left');

CREATE OR REPLACE FUNCTION public.video_date_reconcile_provider_absence_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_p1 jsonb := '{}'::jsonb;
  v_p2 jsonb := '{}'::jsonb;
  v_p1_active boolean := false;
  v_p2_active boolean := false;
  v_p1_left_at timestamptz;
  v_p2_left_at timestamptz;
  v_latest_left_at timestamptz;
  v_confirmed boolean := false;
  v_confirmed_after_at timestamptz;
  v_grace_until timestamptz;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_rows_changed integer := 0;
  v_source text := NULLIF(left(btrim(COALESCE(p_source, '')), 120), '');
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_id_required');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', true,
      'already_ended', true,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  v_confirmed := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  IF NOT v_confirmed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', false,
      'reason', 'confirmed_encounter_required'
    );
  END IF;

  v_p1 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_1_id
  );
  v_p2 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_2_id
  );

  v_p1_active := COALESCE((v_p1->>'active')::boolean, false);
  v_p2_active := COALESCE((v_p2->>'active')::boolean, false);

  v_p1_left_at := CASE
    WHEN v_p1->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p1->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p1->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;
  v_p2_left_at := CASE
    WHEN v_p2->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p2->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p2->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;

  IF v_p1_active OR v_p2_active OR v_p1_left_at IS NULL OR v_p2_left_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'active_provider_present_or_missing_left_pair',
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_latest_left_at := GREATEST(v_p1_left_at, v_p2_left_at);
  v_confirmed_after_at := GREATEST(
    COALESCE(v_session.date_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.handshake_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.started_at, '-infinity'::timestamptz)
  );

  IF v_latest_left_at < v_confirmed_after_at - interval '5 seconds' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'provider_left_before_confirmed_encounter',
      'latest_left_at', v_latest_left_at,
      'confirmed_after_at', v_confirmed_after_at
    );
  END IF;

  v_grace_until := v_latest_left_at + interval '12 seconds';

  IF v_now < v_grace_until THEN
    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = v_grace_until,
      participant_1_away_at = CASE
        WHEN v_p1_left_at IS NULL THEN participant_1_away_at
        ELSE GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at)
      END,
      participant_2_away_at = CASE
        WHEN v_p2_left_at IS NULL THEN participant_2_away_at
        ELSE GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at)
      END,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (
        reconnect_grace_ends_at IS DISTINCT FROM v_grace_until
        OR participant_1_away_at IS DISTINCT FROM CASE
          WHEN v_p1_left_at IS NULL THEN participant_1_away_at
          ELSE GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at)
        END
        OR participant_2_away_at IS DISTINCT FROM CASE
          WHEN v_p2_left_at IS NULL THEN participant_2_away_at
          ELSE GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at)
        END
      );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(p_session_id);
      PERFORM public.record_event_loop_observability(
        'video_date_provider_absence',
        'success',
        'provider_absence_reconnect_grace_started',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
          'latest_left_at', v_latest_left_at,
          'reconnect_grace_ends_at', v_grace_until,
          'participant_1_provider_presence', v_p1,
          'participant_2_provider_presence', v_p2
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'provider_absence_grace_started', true,
      'reconnect_grace_ends_at', v_grace_until,
      'latest_left_at', v_latest_left_at,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
    v_now,
    'provider_absence_after_confirmed_encounter',
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;

  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

  UPDATE public.video_sessions
  SET
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = v_now,
    ended_reason = 'provider_absence_after_confirmed_encounter',
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = COALESCE(participant_1_away_at, v_p1_left_at),
    participant_2_away_at = COALESCE(participant_2_away_at, v_p2_left_at),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;
  GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

  IF v_rows_changed = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', true,
      'already_terminalized', true
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
    current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
    current_partner_id = CASE
      WHEN v_should_open_survey AND profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      WHEN v_should_open_survey AND profile_id = v_session.participant_2_id THEN v_session.participant_1_id
      ELSE NULL
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  UPDATE public.video_date_surface_claims
  SET released_at = COALESCE(released_at, v_now),
      updated_at = v_now
  WHERE session_id = p_session_id
    AND surface = 'video_date'
    AND released_at IS NULL;

  PERFORM public.bump_video_session_seq(p_session_id);
  PERFORM public.record_event_loop_observability(
    'video_date_provider_absence',
    'success',
    CASE
      WHEN v_should_open_survey THEN 'provider_absence_terminal_survey'
      ELSE 'provider_absence_terminal_no_survey'
    END,
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
      'ended_reason', 'provider_absence_after_confirmed_encounter',
      'survey_required', v_should_open_survey,
      'queue_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
      'latest_left_at', v_latest_left_at,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'terminal', true,
    'terminalized', true,
    'provider_presence_terminal', true,
    'ended_reason', 'provider_absence_after_confirmed_encounter',
    'survey_required', v_should_open_survey,
    'queue_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
    'latest_left_at', v_latest_left_at,
    'participant_1_provider_presence', v_p1,
    'participant_2_provider_presence', v_p2
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text) IS
  'Provider-authoritative post-encounter absence reconciler. Starts a short reconnect grace when Daily shows both participants left, preserves brief leave/rejoin, and terminalizes to survey when both remain provider-absent after grace.';

DROP FUNCTION IF EXISTS public.mark_video_date_daily_joined(uuid);

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
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_result jsonb;
BEGIN
  v_result := public.mark_video_date_daily_alive(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    v_provider_session_id,
    p_entry_attempt_id,
    COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'joined')
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'rpc', 'mark_video_date_daily_joined',
    'joined_delegated_to_daily_alive', true,
    'provider_presence_required', true,
    'legacy_providerless_noop', v_provider_session_id IS NULL,
    'join_stamp_accepted', COALESCE((v_result->>'join_stamp_accepted')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(
  uuid, text, text, text, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Compatibility facade for Daily joined confirmation. Provider-backed callers delegate to mark_video_date_daily_alive; providerless old-client calls are bounded telemetry and cannot create joined evidence.';

DO $$
BEGIN
  IF to_regprocedure('public.record_vd_daily_webhook_v2_202606071031_base(text,text,text,text,text,timestamptz,jsonb,timestamptz)') IS NULL
     AND to_regprocedure('public.record_video_date_daily_webhook_event_v2(text,text,text,text,text,timestamptz,jsonb,timestamptz)') IS NOT NULL THEN
    ALTER FUNCTION public.record_video_date_daily_webhook_event_v2(
      text, text, text, text, text, timestamptz, jsonb, timestamptz
    ) RENAME TO record_vd_daily_webhook_v2_202606071031_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.record_vd_daily_webhook_v2_202606071031_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vd_daily_webhook_v2_202606071031_base(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_daily_webhook_event_v2(
  p_provider_event_id text,
  p_event_type text,
  p_room_name text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_provider_user_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_signature_timestamp timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base jsonb;
  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');
  v_event_kind text := replace(replace(lower(btrim(COALESCE(p_event_type, ''))), '_', '.'), '-', '.');
  v_session_id uuid;
  v_reconcile jsonb := NULL;
BEGIN
  v_base := public.record_vd_daily_webhook_v2_202606071031_base(
    p_provider_event_id,
    p_event_type,
    p_room_name,
    p_provider_participant_id,
    p_provider_user_id,
    p_occurred_at,
    p_payload,
    p_signature_timestamp
  );

  IF COALESCE(v_base->>'state', '') = 'processed'
     AND v_room_name IS NOT NULL
     AND v_event_kind IN ('participant.joined', 'participant.join', 'participant.left', 'participant.leave') THEN
    SELECT vs.id
    INTO v_session_id
    FROM public.video_sessions vs
    WHERE vs.daily_room_name = v_room_name
    ORDER BY vs.started_at DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
      v_reconcile := public.video_date_reconcile_provider_absence_v1(
        v_session_id,
        'daily_webhook_' || v_event_kind
      );
    END IF;
  END IF;

  RETURN v_base || jsonb_strip_nulls(jsonb_build_object(
    'provider_absence_reconciliation', v_reconcile
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_daily_webhook_event_v2(
  text, text, text, text, text, timestamptz, jsonb, timestamptz
) IS
  'Daily webhook wrapper. Preserves the previous provider presence repairs, then reconciles confirmed post-encounter provider absence from Daily joined/left truth.';

DO $$
BEGIN
  IF to_regprocedure('public.expire_vd_reconnect_graces_202606071031_base()') IS NULL
     AND to_regprocedure('public.expire_video_date_reconnect_graces()') IS NOT NULL THEN
    ALTER FUNCTION public.expire_video_date_reconnect_graces()
      RENAME TO expire_vd_reconnect_graces_202606071031_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.expire_vd_reconnect_graces_202606071031_base()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_vd_reconnect_graces_202606071031_base()
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r record;
  v_reconcile jsonb;
  v_provider_absence_terminalized integer := 0;
  v_base_count integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= now()
    ORDER BY id
    LIMIT 100
  LOOP
    v_reconcile := public.video_date_reconcile_provider_absence_v1(
      r.id,
      'expire_video_date_reconnect_graces_provider_absence'
    );
    IF COALESCE((v_reconcile->>'terminalized')::boolean, false) THEN
      v_provider_absence_terminalized := v_provider_absence_terminalized + 1;
    END IF;
  END LOOP;

  v_base_count := public.expire_vd_reconnect_graces_202606071031_base();
  RETURN v_provider_absence_terminalized + v_base_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_video_date_reconnect_graces()
  TO service_role;

COMMENT ON FUNCTION public.expire_video_date_reconnect_graces() IS
  'Expires Video Date reconnect graces after first honoring provider-authoritative post-encounter Daily absence. Generic lifecycle suppression remains delegated to the prior base for non-provider-terminal cases.';

NOTIFY pgrst, 'reload schema';

COMMIT;
