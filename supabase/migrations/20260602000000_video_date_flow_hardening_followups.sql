-- Vibe Video Date flow hardening follow-ups:
-- 1. Remove unnecessary anonymous execution from Ready Gate transitions.
-- 2. Add an operator-controlled flag to require idempotency keys on the legacy
--    credit-extension RPC once all active clients are on keyed/v2 paths.

REVOKE EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text) TO authenticated, service_role;

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES (
  'video_date.require_legacy_extension_idempotency_key',
  false,
  0,
  'When enabled for a user, legacy spend_video_date_credit_extension calls without an idempotency key are rejected so extension spends cannot be double-applied by direct RPC retries.',
  false
)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.spend_video_date_credit_extension(
  p_session_id uuid,
  p_credit_type text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sess record;
  v_add int;
  v_rows int;
  v_new_total int;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing record;
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
  v_require_key boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  v_require_key := public.evaluate_client_feature_flag(
    'video_date.require_legacy_extension_idempotency_key',
    v_uid
  );

  IF v_key IS NULL AND v_require_key THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'missing_idempotency_key',
      'retryable', false
    );
  END IF;

  v_add := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_credit_type');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_uid
      AND credit_type = v_credit_type
      AND idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'added_seconds', v_existing.added_seconds,
        'date_extra_seconds', v_existing.date_extra_seconds_after,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT * INTO v_sess FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_uid
      AND credit_type = v_credit_type
      AND idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'added_seconds', v_existing.added_seconds,
        'date_extra_seconds', v_existing.date_extra_seconds_after,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_sess.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_ended');
  END IF;

  IF v_sess.state IS DISTINCT FROM 'date'::public.video_date_state THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_in_date_phase');
  END IF;

  IF v_uid NOT IN (v_sess.participant_1_id, v_sess.participant_2_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF v_credit_type = 'extra_time' THEN
    UPDATE public.user_credits
    SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = v_uid AND extra_time_credits > 0;
  ELSE
    UPDATE public.user_credits
    SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = v_uid AND extended_vibe_credits > 0;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_credits');
  END IF;

  UPDATE public.video_sessions
  SET
    date_extra_seconds = COALESCE(date_extra_seconds, 0) + v_add,
    state_updated_at = now()
  WHERE id = p_session_id
  RETURNING date_extra_seconds INTO v_new_total;

  IF v_key IS NOT NULL THEN
    INSERT INTO public.video_date_credit_extension_spends (
      session_id,
      user_id,
      credit_type,
      idempotency_key,
      added_seconds,
      date_extra_seconds_after
    )
    VALUES (
      p_session_id,
      v_uid,
      v_credit_type,
      v_key,
      v_add,
      v_new_total
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'added_seconds', v_add,
    'date_extra_seconds', v_new_total,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.spend_video_date_credit_extension(uuid, text, text) IS
  'Spends one video-date extension credit for an active date session. Legacy null idempotency keys remain allowed until video_date.require_legacy_extension_idempotency_key is enabled for the caller.';
