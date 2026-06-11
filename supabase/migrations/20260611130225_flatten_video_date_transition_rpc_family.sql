BEGIN;

CREATE SCHEMA IF NOT EXISTS private_video_date;

COMMENT ON SCHEMA private_video_date IS
  'Private compatibility implementation details for flattened Video Date RPC public contracts. Not part of the client/PostgREST surface.';

REVOKE ALL ON SCHEMA private_video_date FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private_video_date TO service_role;

DO $$
DECLARE
  v_helpers text[][] := ARRAY[
    ARRAY['video_date_transition_20260430180000_last_chance_grace_10s', 'vdt_core_legacy_01'],
    ARRAY['video_date_transition_20260501091000_pre_date_end_cleanup', 'vdt_pre_date_end_cleanup'],
    ARRAY['video_date_transition_20260501103000_prepare_entry_queue_guard', 'vdt_prepare_entry_prewarm'],
    ARRAY['video_date_transition_20260501110000_provider_atomic_base', 'vdt_provider_atomic_entry'],
    ARRAY['video_date_transition_20260501145000_peer_missing_end_base', 'vdt_peer_missing_end'],
    ARRAY['video_date_transition_20260501200000_event_inactive_base', 'vdt_event_inactive'],
    ARRAY['video_date_transition_20260502143000_handshake_deadline_base', 'vdt_deadline'],
    ARRAY['video_date_transition_20260503110000_survey_continuity_base', 'vdt_survey_continuity'],
    ARRAY['video_date_transition_20260503130000_prepare_lease_base', 'vdt_prepare_lease'],
    ARRAY['video_date_transition_20260505153000_prepare_payload_base', 'vdt_prepare_payload'],
    ARRAY['video_date_transition_20260603090000_remote_seen_base', 'vdt_remote_seen'],
    ARRAY['video_date_transition_20260604093000_failsoft_base', 'vdt_failsoft_base'],
    ARRAY['video_date_transition_20260604170438_warmup_stability_base', 'vdt_warmup_stability'],
    ARRAY['video_date_transition_20260604193140_latest_presence_base', 'vdt_latest_presence'],
    ARRAY['video_date_transition_20260605200729_lifecycle_base', 'vdt_lifecycle_presence'],
    ARRAY['video_date_transition_20260605232304_single_owner_base', 'vdt_single_owner'],
    ARRAY['video_date_transition_20260607123952_routeable_entry_base', 'vdt_routeable_entry'],
    ARRAY['video_date_transition_20260607155414_lifecycle_base', 'vdt_terminal_lifecycle'],
    ARRAY['video_date_transition_20260607222923_definitive_base', 'vdt_definitive_owner'],
    ARRAY['video_date_transition_20260608080938_last_resort_base', 'vdt_last_resort'],
    ARRAY['vd_transition_partial_base', 'vdt_partial_ready_gate'],
    ARRAY['vd_transition_both_ready_owner_base', 'vdt_both_ready_owner'],
    ARRAY['video_date_transition_20260609105249_active_entry_base', 'vdt_active_entry_failsoft'],
    ARRAY['vd_transition_20260609130139_hot_base', 'vdt_hot_path_no_throw'],
    ARRAY['vd_transition_20260609202707_enter_hs_base', 'vdt_current_base']
  ];
  v_item text[];
  v_ref text[];
  v_old text;
  v_new text;
  v_def text;
  v_reg regprocedure;
BEGIN
  FOREACH v_item SLICE 1 IN ARRAY v_helpers LOOP
    v_old := v_item[1];
    v_new := v_item[2];
    v_reg := to_regprocedure(format('public.%I(uuid,text,text)', v_old));

    IF v_reg IS NULL THEN
      RAISE EXCEPTION 'Required video_date_transition helper % is missing; aborting flatten migration', v_old;
    END IF;

    SELECT pg_get_functiondef(v_reg)
    INTO v_def;

    v_def := replace(
      v_def,
      format('FUNCTION public.%I', v_old),
      format('FUNCTION private_video_date.%I', v_new)
    );

    FOREACH v_ref SLICE 1 IN ARRAY v_helpers LOOP
      v_def := replace(
        v_def,
        format('public.%I', v_ref[1]),
        format('private_video_date.%I', v_ref[2])
      );
    END LOOP;

    EXECUTE v_def;
    EXECUTE format(
      'REVOKE ALL ON FUNCTION private_video_date.%I(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role',
      v_new
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION private_video_date.%I(uuid, text, text) TO service_role',
      v_new
    );
  END LOOP;
END
$$;

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

  -- Entry-vocabulary actions remain aliases while the DB internals are still
  -- physically backed by the legacy handshake state machine.
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
    v_result := private_video_date.vdt_current_base(
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
          'video_date_transition.flattened_shell',
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
          'standalone_enter_handshake_removed_shell', true,
          'flattened_public_shell', true
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
            'flattened_public_shell', true,
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
    'standalone_enter_handshake_removed_shell', true,
    'flattened_public_shell', true
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
      'flattened_public_shell', true,
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
  'Flattened public Video Date lifecycle transition RPC. Active callers use this stable signature; timestamped helper generations are no longer public/PostgREST RPCs.';

COMMENT ON FUNCTION private_video_date.vdt_current_base(uuid, text, text) IS
  'Private current Video Date transition implementation copied from the prior deployed helper stack to preserve behavior while flattening the public RPC catalog.';

DROP FUNCTION IF EXISTS public.vd_transition_20260609202707_enter_hs_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.vd_transition_20260609130139_hot_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260609105249_active_entry_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.vd_transition_both_ready_owner_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.vd_transition_partial_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260608080938_last_resort_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260607222923_definitive_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260607155414_lifecycle_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260607123952_routeable_entry_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260605232304_single_owner_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260605200729_lifecycle_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260604193140_latest_presence_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260604170438_warmup_stability_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260604093000_failsoft_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260603090000_remote_seen_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260505153000_prepare_payload_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260503130000_prepare_lease_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260503110000_survey_continuity_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260502143000_handshake_deadline_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260501200000_event_inactive_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260501145000_peer_missing_end_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260501110000_provider_atomic_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260501103000_prepare_entry_queue_guard(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260501091000_pre_date_end_cleanup(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_date_transition_20260430180000_last_chance_grace_10s(uuid, text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
