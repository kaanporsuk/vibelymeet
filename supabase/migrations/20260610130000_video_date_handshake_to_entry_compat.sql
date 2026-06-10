-- Phase B: additive handshake -> entry compatibility layer (behavior-preserving).
--
-- Adds entry-vocabulary surfaces that mirror/delegate to the existing handshake
-- ones. Nothing is renamed or dropped: the DB keeps writing handshake_* columns,
-- the legacy handshake actions, and the handshake-named functions. This is the
-- compat layer for the later enum/column rename (Phase D).
--
--   * entry_started_at / entry_grace_expires_at: STORED generated columns that
--     always equal handshake_started_at / handshake_grace_expires_at (read-only;
--     no dual-write logic, cannot desync).
--   * video_session_entry_auto_promote_v2 / video_session_continue_entry_v2 /
--     finalize_video_date_entry_deadline / expire_due_joined_video_date_entries_bounded:
--     thin wrappers delegating to the handshake-named functions, same grants.
--   * video_date_transition: accepts 'complete_entry' / 'continue_entry' as
--     aliases for 'complete_handshake' / 'continue_handshake' (old actions
--     unchanged).

-- 1) Mirror columns (generated, read-only, auto-synced with the canonical columns).
ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS entry_started_at timestamptz
    GENERATED ALWAYS AS (handshake_started_at) STORED;
ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS entry_grace_expires_at timestamptz
    GENERATED ALWAYS AS (handshake_grace_expires_at) STORED;

COMMENT ON COLUMN public.video_sessions.entry_started_at IS
  'Entry-vocabulary mirror of handshake_started_at (generated STORED, read-only). Phase B handshake -> entry compat.';
COMMENT ON COLUMN public.video_sessions.entry_grace_expires_at IS
  'Entry-vocabulary mirror of handshake_grace_expires_at (generated STORED, read-only). Phase B handshake -> entry compat.';

-- 2) Entry-named RPC wrappers delegating to the existing handshake functions.
CREATE OR REPLACE FUNCTION public.video_session_entry_auto_promote_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.video_session_handshake_auto_promote_v2(p_session_id, p_idempotency_key, p_request_hash);
END;
$function$;
REVOKE ALL ON FUNCTION public.video_session_entry_auto_promote_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_entry_auto_promote_v2(uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.video_session_entry_auto_promote_v2(uuid, text, text) IS
  'Entry-vocabulary wrapper delegating to video_session_handshake_auto_promote_v2. Phase B compat.';

CREATE OR REPLACE FUNCTION public.video_session_continue_entry_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.video_session_continue_handshake_v2(p_session_id, p_idempotency_key, p_request_hash);
END;
$function$;
REVOKE ALL ON FUNCTION public.video_session_continue_entry_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_continue_entry_v2(uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.video_session_continue_entry_v2(uuid, text, text) IS
  'Entry-vocabulary wrapper delegating to video_session_continue_handshake_v2. Phase B compat.';

CREATE OR REPLACE FUNCTION public.finalize_video_date_entry_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.finalize_video_date_handshake_deadline(p_session_id, p_actor, p_source, p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION public.finalize_video_date_entry_deadline(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_entry_deadline(uuid, uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.finalize_video_date_entry_deadline(uuid, uuid, text, text) IS
  'Entry-vocabulary wrapper delegating to finalize_video_date_handshake_deadline. Phase B compat.';

CREATE OR REPLACE FUNCTION public.expire_due_joined_video_date_entries_bounded(
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.expire_due_joined_video_date_handshakes_bounded(p_limit);
END;
$function$;
REVOKE ALL ON FUNCTION public.expire_due_joined_video_date_entries_bounded(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_joined_video_date_entries_bounded(integer) TO service_role;
COMMENT ON FUNCTION public.expire_due_joined_video_date_entries_bounded(integer) IS
  'Entry-vocabulary wrapper delegating to expire_due_joined_video_date_handshakes_bounded. Phase B compat.';

-- 3) video_date_transition: accept entry-named actions as aliases (additive).
CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_delegate_action text;
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- Phase B compat: accept entry-vocabulary actions as aliases for the
  -- legacy handshake actions. Old actions pass through unchanged.
  v_delegate_action := CASE v_action
    WHEN 'complete_entry' THEN 'complete_handshake'
    WHEN 'continue_entry' THEN 'continue_handshake'
    ELSE p_action
  END;

  IF v_action = 'enter_handshake' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_date_transition',
      'action', v_action,
      'error', 'standalone_enter_handshake_removed',
      'reason', 'standalone_enter_handshake_removed',
      'message', 'Standalone enter_handshake is removed. Use prepare_entry via prepare_date_entry.',
      'code', 'ENTER_HANDSHAKE_REMOVED',
      'error_code', 'ENTER_HANDSHAKE_REMOVED',
      'retryable', false,
      'terminal', false,
      'removed_public_action', true,
      'supported_action', 'prepare_entry',
      'entry_command', 'prepare_date_entry',
      'prepare_entry_required', true,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  BEGIN
    v_result := public.vd_transition_20260609202707_enter_hs_base(
      p_session_id,
      v_delegate_action,
      p_reason
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_date_transition.enter_handshake_removed_shell',
          'video_date_transition_failed',
          'VIDEO_DATE_TRANSITION_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'standalone_enter_handshake_removed_shell', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'video_date_transition',
            'action', v_action,
            'reason_detail', left(btrim(COALESCE(p_reason, '')), 180),
            'error', 'video_date_transition_failed',
            'reason', 'video_date_transition_failed',
            'code', 'VIDEO_DATE_TRANSITION_FAILED',
            'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
            'retryable', true,
            'terminal', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'standalone_enter_handshake_removed_shell', true,
            'last_resort_payload', true,
            'sqlstate', SQLSTATE,
            'sql_message', left(COALESCE(v_message, ''), 500),
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'hot_path_no_throw_shell', true,
    'standalone_enter_handshake_removed_shell', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_date_transition',
      'action', v_action,
      'reason_detail', left(btrim(COALESCE(p_reason, '')), 180),
      'error', 'video_date_transition_failed',
      'reason', 'video_date_transition_failed',
      'code', 'VIDEO_DATE_TRANSITION_FAILED',
      'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
      'retryable', true,
      'terminal', false,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'standalone_enter_handshake_removed_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'sqlstate', SQLSTATE,
      'sql_message', left(COALESCE(v_message, ''), 500),
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date lifecycle transition. Standalone enter_handshake removed; complete_entry/continue_entry accepted as Phase B aliases for complete_handshake/continue_handshake. Clients must use prepare_date_entry/prepare_entry for date entry.';
