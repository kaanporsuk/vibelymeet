-- Video Date identifier hygiene.
--
-- PostgreSQL silently truncates identifiers beyond 63 bytes. A few historical
-- wrapper-base names were intentionally descriptive enough to hit that limit,
-- which made Supabase lint noisy and hid the actual stored names. Keep behavior
-- unchanged while moving those internal bases to short explicit identifiers and
-- replacing inherited wrapper bodies that still reference the long names.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ready_gate_transition_20260505140000_pre_ready_room_metadata_ba(uuid,text,text)') IS NOT NULL
     AND to_regprocedure('public.rgt_pre_ready_room_meta_base_v1(uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.ready_gate_transition_20260505140000_pre_ready_room_metadata_ba(uuid, text, text)
      RENAME TO rgt_pre_ready_room_meta_base_v1;
  END IF;

  IF to_regprocedure('public.ready_gate_transition_20260505154500_preserve_after_ready_room_(uuid,text,text)') IS NOT NULL
     AND to_regprocedure('public.rgt_preserve_warmup_base_v1(uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.ready_gate_transition_20260505154500_preserve_after_ready_room_(uuid, text, text)
      RENAME TO rgt_preserve_warmup_base_v1;
  END IF;

  IF to_regprocedure('public.confirm_video_date_entry_prepared_20260501200000_event_inactive(uuid,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.confirm_vde_event_inactive_base_v1(uuid,text,text,text)') IS NULL THEN
    ALTER FUNCTION public.confirm_video_date_entry_prepared_20260501200000_event_inactive(uuid, text, text, text)
      RENAME TO confirm_vde_event_inactive_base_v1;
  END IF;

  IF to_regprocedure('public.repair_stale_video_date_prepare_entries_20260501170000_both_joi(integer)') IS NOT NULL
     AND to_regprocedure('public.repair_stale_vd_prepare_both_join_v1(integer)') IS NULL THEN
    ALTER FUNCTION public.repair_stale_video_date_prepare_entries_20260501170000_both_joi(integer)
      RENAME TO repair_stale_vd_prepare_both_join_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rgt_pre_ready_room_meta_base_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rgt_preserve_warmup_base_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.confirm_vde_event_inactive_base_v1(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_vde_event_inactive_base_v1(uuid, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.repair_stale_vd_prepare_both_join_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_stale_vd_prepare_both_join_v1(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.rgt_preserve_warmup_base_v1(
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
  v_session public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_terminal boolean;
  v_repair_count integer := 0;
BEGIN
  IF v_actor IS NOT NULL AND p_action IN ('mark_ready', 'snooze') THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
       AND v_session.ended_at IS NULL
       AND v_session.state = 'ready_gate'::public.video_date_state
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
       AND v_session.handshake_started_at IS NULL
       AND v_session.date_started_at IS NULL
       AND v_session.participant_1_joined_at IS NULL
       AND v_session.participant_2_joined_at IS NULL
       AND (
         v_session.daily_room_name IS NOT NULL
         OR v_session.daily_room_url IS NOT NULL
         OR v_session.daily_room_verified_at IS NOT NULL
         OR v_session.daily_room_expires_at IS NOT NULL
         OR v_session.daily_room_provider_verify_reason IS NOT NULL
       ) THEN
      UPDATE public.video_sessions
      SET
        daily_room_name = NULL,
        daily_room_url = NULL,
        daily_room_verified_at = NULL,
        daily_room_expires_at = NULL,
        daily_room_provider_verify_reason = NULL,
        state_updated_at = now()
      WHERE id = p_session_id
        AND ended_at IS NULL
        AND state = 'ready_gate'::public.video_date_state
        AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
        AND handshake_started_at IS NULL
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          daily_room_name IS NOT NULL
          OR daily_room_url IS NOT NULL
          OR daily_room_verified_at IS NOT NULL
          OR daily_room_expires_at IS NOT NULL
          OR daily_room_provider_verify_reason IS NOT NULL
        )
      RETURNING * INTO v_session;

      GET DIAGNOSTICS v_repair_count = ROW_COUNT;

      IF v_repair_count > 0 THEN
        PERFORM public.record_event_loop_observability(
          'ready_gate_transition',
          'success',
          'pre_ready_room_metadata_repaired',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', p_action,
            'p_reason', p_reason,
            'repaired_daily_room_metadata', true
          )
        );
      END IF;
    END IF;
  END IF;

  v_result := public.rgt_pre_ready_room_meta_base_v1(
    p_session_id,
    p_action,
    p_reason
  );

  IF v_actor IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN v_result;
  END IF;

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
  v_terminal := CASE
    WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
    ELSE v_session.ended_at IS NOT NULL
      OR v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'ready_participant_1_at', v_session.ready_participant_1_at,
    'ready_participant_2_at', v_session.ready_participant_2_at,
    'status', v_status,
    'ready_gate_status', v_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'snoozed_by', v_session.snoozed_by,
    'snooze_expires_at', v_session.snooze_expires_at,
    'terminal', v_terminal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rgt_preserve_warmup_base_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rgt_preserve_warmup_base_v1(uuid, text, text) IS
  'Internal Ready Gate base. Repairs stale pre-ready Daily room metadata and delegates to the pre-room-metadata base without truncated identifier references.';

CREATE OR REPLACE FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(
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
  v_now timestamptz := now();
  v_before public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_status text;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_can_restore boolean := false;
  v_restored public.video_sessions%ROWTYPE;
BEGIN
  IF v_actor IS NOT NULL AND p_action = 'mark_ready' THEN
    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_can_restore := FOUND
      AND (v_before.participant_1_id = v_actor OR v_before.participant_2_id = v_actor)
      AND v_before.ended_at IS NULL
      AND v_before.state = 'ready_gate'::public.video_date_state
      AND v_before.ready_gate_status IN ('ready_a', 'ready_b')
      AND (v_before.ready_participant_1_at IS NOT NULL OR v_before.ready_participant_2_at IS NOT NULL)
      AND v_before.handshake_started_at IS NULL
      AND v_before.date_started_at IS NULL
      AND v_before.participant_1_joined_at IS NULL
      AND v_before.participant_2_joined_at IS NULL
      AND v_before.daily_room_name = v_expected_room_name
      AND v_before.daily_room_url IS NOT NULL
      AND v_before.daily_room_url LIKE ('%/' || v_expected_room_name)
      AND v_before.daily_room_verified_at IS NOT NULL
      AND v_before.daily_room_verified_at >= v_now - interval '90 seconds'
      AND v_before.daily_room_expires_at IS NOT NULL
      AND v_before.daily_room_expires_at > v_now + interval '60 seconds';
  END IF;

  v_result := public.rgt_preserve_warmup_base_v1(
    p_session_id,
    p_action,
    p_reason
  );

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

  IF v_can_restore
     AND COALESCE((v_result->>'success')::boolean, false)
     AND v_status = 'both_ready' THEN
    UPDATE public.video_sessions
    SET
      daily_room_name = v_before.daily_room_name,
      daily_room_url = v_before.daily_room_url,
      daily_room_verified_at = v_before.daily_room_verified_at,
      daily_room_expires_at = v_before.daily_room_expires_at,
      daily_room_provider_verify_reason = COALESCE(
        v_before.daily_room_provider_verify_reason,
        'ready_gate_after_ready_room_warmup'
      ),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
    RETURNING * INTO v_restored;

    IF FOUND THEN
      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        'success',
        'after_ready_room_metadata_preserved_for_both_ready',
        NULL,
        v_restored.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
          'daily_room_name', v_restored.daily_room_name,
          'daily_room_verified_at', v_restored.daily_room_verified_at,
          'daily_room_expires_at', v_restored.daily_room_expires_at,
          'provider_verify_skip_eligible', true
        )
      );

      RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'daily_room_name', v_restored.daily_room_name,
        'daily_room_url', v_restored.daily_room_url,
        'daily_room_verified_at', v_restored.daily_room_verified_at,
        'daily_room_expires_at', v_restored.daily_room_expires_at,
        'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text) IS
  'Internal Ready Gate base. Preserves fresh after-ready Daily room warmup proof while delegating to the short pre-ready repair base.';

CREATE OR REPLACE FUNCTION public.confirm_vde_prepared_202605031300_base(
  p_session_id uuid,
  p_room_name text,
  p_room_url text,
  p_entry_attempt_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_already_entry boolean := false;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.ended_at IS NOT NULL THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  v_already_entry := (
    v_session.handshake_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
    OR v_session.daily_room_name IS NOT NULL
    OR v_session.daily_room_url IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
    OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
  );

  IF NOT v_already_entry THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NOT NULL THEN
      v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'confirm_prepare_entry_event_inactive',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'entry_attempt_id', p_entry_attempt_id,
          'inactive_reason', v_inactive_reason,
          'cleanup', v_cleanup
        )
      );

      RETURN jsonb_build_object(
        'success', false,
        'error', 'Event is no longer active',
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'EVENT_NOT_ACTIVE',
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'state', COALESCE(v_session.state::text, 'ended'),
        'phase', COALESCE(v_session.phase, 'ended'),
        'event_id', v_session.event_id,
        'participant_1_id', v_session.participant_1_id,
        'participant_2_id', v_session.participant_2_id,
        'handshake_started_at', v_session.handshake_started_at,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'terminal', v_session.ended_at IS NOT NULL
      );
    END IF;
  END IF;

  RETURN public.confirm_vde_event_inactive_base_v1(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text) IS
  'Internal confirm_prepare_entry base. Blocks inactive events before delegating to the short provider-atomic base.';

CREATE OR REPLACE FUNCTION public.repair_stale_video_date_prepare_entries(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  n integer := 0;
  v_base integer := 0;
  v_registration_rows integer := 0;
BEGIN
  v_base := public.repair_stale_vd_prepare_both_join_v1(v_limit);

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at, state_updated_at, ready_gate_expires_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NOT NULL
      AND daily_room_url IS NOT NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND COALESCE(state_updated_at, ready_gate_expires_at, started_at) < v_now - interval '5 minutes'
    ORDER BY COALESCE(state_updated_at, ready_gate_expires_at, started_at), id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'prepare_entry_daily_join_missing',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'repair_stale_video_date_prepare_entries',
      CASE WHEN v_registration_rows = 0 THEN 'deferred' ELSE 'success' END,
      'stale_prepare_entry_no_daily_join',
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'ended_reason', 'prepare_entry_daily_join_missing',
        'handshake_timer', 'never_started',
        'registration_rows', v_registration_rows
      )
    );
    n := n + 1;
  END LOOP;

  RETURN COALESCE(v_base, 0) + n;
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_stale_video_date_prepare_entries(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_stale_video_date_prepare_entries(integer)
  TO service_role;

COMMENT ON FUNCTION public.repair_stale_video_date_prepare_entries(integer) IS
  'Repairs stale provider-prepared video dates. Delegates to the short both-join base, then closes rows where room metadata persisted but neither participant confirmed Daily join.';

COMMIT;
