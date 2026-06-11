CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT 'joined'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
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

  BEGIN
    -- ── Joined delegates to the canonical heartbeat owner (formerly the
    -- 20260607155414 lifecycle base). ──
    v_result := public.mark_video_date_daily_alive(
      p_session_id,
      p_owner_id,
      p_call_instance_id,
      v_provider_session_id,
      p_entry_attempt_id,
      COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'joined')
    );

    v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'rpc', 'mark_video_date_daily_joined',
      'joined_delegated_to_daily_alive', true,
      'provider_presence_required', true,
      'legacy_providerless_noop', v_provider_session_id IS NULL,
      'join_stamp_accepted', COALESCE((v_result->>'join_stamp_accepted')::boolean, false)
    );

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, active_entry and hot wrapper bases). ──
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

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_promotion,
      'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
    );

    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_joined',
      v_result
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true
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
          'mark_video_date_daily_joined.single_body',
          'daily_join_stamp_failed',
          'DAILY_JOIN_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_joined',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'joined'),
            'error', 'daily_join_stamp_failed',
            'reason', 'daily_join_stamp_failed',
            'code', 'DAILY_JOIN_STAMP_FAILED',
            'error_code', 'DAILY_JOIN_STAMP_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$
