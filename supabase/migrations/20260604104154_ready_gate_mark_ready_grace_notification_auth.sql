-- Definitive Ready Gate handoff hardening.
--
-- This migration keeps Daily provider work out of the mark-ready critical path.
-- It wraps the current hot-path RPC with a narrow grace layer that:
--   - preserves legitimate tap intent through short lock contention,
--   - standardizes mark-ready response fields for web/native consumers,
--   - keeps retryable command replays retryable instead of terminal/stale, and
--   - logs sentinels if old mark-ready signatures ever surface again.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_grace_extend_v1(
  p_session_id uuid,
  p_actor uuid,
  p_idempotency_key text,
  p_source text DEFAULT 'pre_call',
  p_retryable boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_grace_window interval := interval '15 seconds';
  v_grace_max_age interval := interval '45 seconds';
  v_extend_until timestamptz := v_now + interval '15 seconds';
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_started_at timestamptz;
  v_max_extend_until timestamptz;
  v_existing_command_found boolean := false;
  v_event_id uuid;
  v_previous_expires_at timestamptz;
  v_new_expires_at timestamptz;
  v_status text;
BEGIN
  PERFORM set_config('lock_timeout', '800ms', true);
  PERFORM set_config('statement_timeout', '3000ms', true);

  IF p_session_id IS NULL OR p_actor IS NULL THEN
    RETURN jsonb_build_object(
      'expiry_grace_applied', false,
      'mark_ready_started_at', v_now,
      'ready_gate_grace_source', p_source,
      'ready_gate_grace_skipped', 'missing_session_or_actor'
    );
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT vsc.created_at
    INTO v_started_at
    FROM public.video_session_commands vsc
    WHERE vsc.session_id = p_session_id
      AND vsc.actor = p_actor
      AND vsc.command_kind = 'mark_ready'
      AND vsc.idempotency_key = v_key
    ORDER BY vsc.created_at ASC
    LIMIT 1;
    v_existing_command_found := v_started_at IS NOT NULL;
  END IF;

  v_started_at := COALESCE(v_started_at, v_now);
  v_max_extend_until := v_started_at + v_grace_max_age;

  WITH candidate AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.ready_gate_expires_at,
      vs.ready_gate_status
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id
      AND p_actor IN (vs.participant_1_id, vs.participant_2_id)
      AND vs.ended_at IS NULL
      AND COALESCE(vs.state, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at <= v_extend_until
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at >= v_now - v_grace_window
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR v_started_at <= vs.ready_gate_expires_at
      )
      AND v_now < v_max_extend_until
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at < LEAST(v_extend_until, v_max_extend_until)
      )
  ),
  updated AS (
    UPDATE public.video_sessions vs
    SET
      ready_gate_expires_at = GREATEST(
        COALESCE(vs.ready_gate_expires_at, LEAST(v_extend_until, v_max_extend_until)),
        LEAST(v_extend_until, v_max_extend_until)
      ),
      state_updated_at = v_now
    FROM candidate c
    WHERE vs.id = c.id
      AND vs.ended_at IS NULL
      AND COALESCE(vs.state, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at <= v_extend_until
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at >= v_now - v_grace_window
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR v_started_at <= vs.ready_gate_expires_at
      )
      AND v_now < v_max_extend_until
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at < LEAST(v_extend_until, v_max_extend_until)
      )
    RETURNING
      c.event_id,
      c.ready_gate_expires_at AS previous_expires_at,
      vs.ready_gate_expires_at AS new_expires_at,
      vs.ready_gate_status
  )
  SELECT
    u.event_id,
    u.previous_expires_at,
    u.new_expires_at,
    u.ready_gate_status
  INTO
    v_event_id,
    v_previous_expires_at,
    v_new_expires_at,
    v_status
  FROM updated u
  LIMIT 1;

  IF v_new_expires_at IS NOT NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_session_mark_ready_v2',
      'success',
      'mark_ready_expiry_grace_applied',
      NULL,
      v_event_id,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'retryable', COALESCE(p_retryable, false),
        'existing_command_found', v_existing_command_found,
        'mark_ready_started_at', v_started_at,
        'previous_ready_gate_expires_at', v_previous_expires_at,
        'ready_gate_expires_at', v_new_expires_at,
        'ready_gate_status', v_status,
        'hot_path', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'expiry_grace_applied', v_new_expires_at IS NOT NULL,
    'mark_ready_started_at', v_started_at,
    'existing_command_found', v_existing_command_found,
    'ready_gate_grace_source', p_source,
    'ready_gate_expires_at_before', v_previous_expires_at,
    'ready_gate_expires_at_after', v_new_expires_at,
    'ready_gate_status', v_status
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'expiry_grace_applied', false,
      'mark_ready_started_at', COALESCE(v_started_at, v_now),
      'ready_gate_grace_source', p_source,
      'ready_gate_grace_error', SQLSTATE,
      'ready_gate_grace_message', left(SQLERRM, 240)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean) IS
  'Internal Ready Gate mark-ready grace extender. Extends only active ready_gate rows for the participant and never performs provider work.';

DROP FUNCTION IF EXISTS public.video_session_mark_ready_v2_20260604104154_grace_base(uuid, text, text);
ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  RENAME TO video_session_mark_ready_v2_20260604104154_grace_base;
REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260604104154_grace_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
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
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    COALESCE(p_session_id::text, 'missing-session') || ':phase3:mark_ready'
  );
  v_preflight jsonb := '{}'::jsonb;
  v_postflight jsonb := '{}'::jsonb;
  v_result jsonb := '{}'::jsonb;
  v_started_at timestamptz := v_now;
  v_expiry_grace_applied boolean := false;
  v_retryable boolean := false;
  v_terminal boolean := false;
  v_event_id uuid;
  v_legacy_signal text;
  v_message text;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT vs.event_id
    INTO v_event_id
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;
  END IF;

  IF v_actor IS NOT NULL THEN
    v_preflight := public.video_session_mark_ready_grace_extend_v1(
      p_session_id,
      v_actor,
      v_key,
      'pre_call',
      false
    );
    v_started_at := COALESCE((v_preflight->>'mark_ready_started_at')::timestamptz, v_started_at);
    v_expiry_grace_applied := COALESCE((v_preflight->>'expiry_grace_applied')::boolean, false);
  END IF;

  v_result := COALESCE(
    public.video_session_mark_ready_v2_20260604104154_grace_base(
      p_session_id,
      p_idempotency_key,
      p_request_hash
    ),
    '{}'::jsonb
  );

  v_retryable := COALESCE((v_result->>'retryable')::boolean, false);
  v_terminal := COALESCE((v_result->>'terminal')::boolean, false);

  IF v_actor IS NOT NULL AND v_retryable AND NOT v_terminal THEN
    v_postflight := public.video_session_mark_ready_grace_extend_v1(
      p_session_id,
      v_actor,
      v_key,
      'post_retryable',
      true
    );
    v_expiry_grace_applied :=
      v_expiry_grace_applied
      OR COALESCE((v_postflight->>'expiry_grace_applied')::boolean, false);
  END IF;

  v_legacy_signal := lower(COALESCE(
    v_result->>'reason',
    v_result->>'error',
    v_result->>'code',
    v_result->>'source',
    ''
  ));
  IF v_legacy_signal IN ('ready_gate_transition_timeout', 'pre_ready_room_metadata_repaired')
     OR v_result::text ILIKE '%ready_gate_transition_timeout%'
     OR v_result::text ILIKE '%pre_ready_room_metadata_repaired%' THEN
    PERFORM public.record_event_loop_observability(
      'video_session_mark_ready_v2',
      'error',
      'legacy_mark_ready_signature_detected',
      NULL,
      v_event_id,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'legacy_signal', v_legacy_signal,
        'hot_path', true,
        'retryable', v_retryable,
        'terminal', v_terminal,
        'result_excerpt', left(v_result::text, 600)
      )
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'hot_path', true,
    'mark_ready_started_at', v_started_at,
    'expiry_grace_applied', v_expiry_grace_applied,
    'expiry_grace_preflight', v_preflight,
    'expiry_grace_postflight', v_postflight,
    'retryable_command_reopened',
      CASE
        WHEN jsonb_typeof(v_result->'retryable_command_reopened') = 'boolean'
          THEN (v_result->>'retryable_command_reopened')::boolean
        ELSE false
      END,
    'ready_gate_expires_at',
      COALESCE(
        v_postflight->>'ready_gate_expires_at_after',
        v_preflight->>'ready_gate_expires_at_after',
        v_result->>'ready_gate_expires_at'
      ),
    'server_now_ms', COALESCE((v_result->>'server_now_ms')::bigint, v_server_now_ms),
    'serverNowMs', COALESCE((v_result->>'serverNowMs')::bigint, v_server_now_ms)
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'retryable', true,
      'terminal', false,
      'error', 'mark_ready_wrapper_failed',
      'reason', 'mark_ready_wrapper_failed',
      'code', 'MARK_READY_WRAPPER_FAILED',
      'error_code', 'MARK_READY_WRAPPER_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'commandStatus', 'rejected',
      'hot_path', true,
      'mark_ready_started_at', v_started_at,
      'expiry_grace_applied', v_expiry_grace_applied,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Ready Gate mark-ready hot path with short expiry grace, retryable replay preservation, standardized response fields, and legacy-signal sentinels.';

COMMIT;
