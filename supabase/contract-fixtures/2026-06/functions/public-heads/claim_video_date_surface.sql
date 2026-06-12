CREATE OR REPLACE FUNCTION public.claim_video_date_surface(p_session_id uuid, p_surface text, p_client_instance_id text, p_takeover boolean DEFAULT false, p_ttl_seconds integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := now();
  v_surface text := lower(btrim(COALESCE(p_surface, '')));
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_ttl_seconds integer := GREATEST(5, LEAST(COALESCE(p_ttl_seconds, 12), 60));
  v_session public.video_sessions%ROWTYPE;
  v_existing public.video_date_surface_claims%ROWTYPE;
  v_surface_allowed boolean := false;
  v_result jsonb;
  v_result_code text;
  v_ok boolean;
  v_blocked boolean;
  v_retryable boolean;
  v_term record;
  v_updated integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Core claim machine (formerly the 20260604093000 failsoft base). ──
    BEGIN
      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
      ELSIF v_surface NOT IN ('ready_gate', 'video_date', 'post_date_survey') THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_SURFACE', 'error', 'invalid_surface');
      ELSIF length(v_client_instance_id) < 8 THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_CLIENT_INSTANCE', 'error', 'invalid_client_instance');
      ELSE
        SELECT * INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF v_session.id IS NULL THEN
          v_result := jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
        ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
          AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
          v_result := jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
        ELSE
          v_surface_allowed := CASE v_surface
            WHEN 'ready_gate' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND v_session.state = 'ready_gate'::public.video_date_state
            WHEN 'video_date' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND (
                v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
              )
            WHEN 'post_date_survey' THEN
              public.video_date_session_is_post_date_survey_eligible_v2(
                v_session.ended_at,
                v_session.ended_reason,
                v_session.date_started_at,
                v_session.state::text,
                v_session.phase,
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at,
                v_session.participant_1_remote_seen_at,
                v_session.participant_2_remote_seen_at
              )
            ELSE false
          END;

          IF NOT v_surface_allowed THEN
            v_result := jsonb_build_object(
              'success', false,
              'code', 'SURFACE_NOT_CLAIMABLE',
              'error', 'surface_not_claimable',
              'state', v_session.state,
              'phase', v_session.phase,
              'ended_reason', v_session.ended_reason
            );
          ELSE
            UPDATE public.video_date_surface_claims
            SET released_at = COALESCE(released_at, v_now), updated_at = v_now
            WHERE profile_id = v_actor
              AND released_at IS NULL
              AND expires_at <= v_now;

            SELECT * INTO v_existing
            FROM public.video_date_surface_claims
            WHERE profile_id = v_actor
            FOR UPDATE;

            IF v_existing.profile_id IS NOT NULL
               AND v_existing.released_at IS NULL
               AND v_existing.expires_at > v_now
               AND (
                 v_existing.session_id IS DISTINCT FROM p_session_id
                 OR v_existing.client_instance_id IS DISTINCT FROM v_client_instance_id
               )
               AND NOT p_takeover THEN
              v_result := jsonb_build_object(
                'success', false,
                'code', 'SURFACE_CLAIM_CONFLICT',
                'error', 'surface_claim_conflict',
                'conflict_session_id', v_existing.session_id,
                'conflict_surface', v_existing.surface,
                'expires_at', v_existing.expires_at
              );
            ELSE
              INSERT INTO public.video_date_surface_claims (
                profile_id,
                session_id,
                surface,
                client_instance_id,
                claimed_at,
                expires_at,
                released_at,
                updated_at
              )
              VALUES (
                v_actor,
                p_session_id,
                v_surface,
                v_client_instance_id,
                v_now,
                v_now + make_interval(secs => v_ttl_seconds),
                NULL,
                v_now
              )
              ON CONFLICT (profile_id)
              DO UPDATE SET
                session_id = EXCLUDED.session_id,
                surface = EXCLUDED.surface,
                client_instance_id = EXCLUDED.client_instance_id,
                claimed_at = EXCLUDED.claimed_at,
                expires_at = EXCLUDED.expires_at,
                released_at = NULL,
                updated_at = EXCLUDED.updated_at;

              v_result := jsonb_build_object(
                'success', true,
                'session_id', p_session_id,
                'surface', v_surface,
                'expires_at', v_now + make_interval(secs => v_ttl_seconds),
                'takeover', p_takeover
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        -- Raw diagnostics go to server-side observability, never into
        -- authenticated client payloads (formerly the outer/single_owner
        -- fail-soft shells, which leaked sqlstate/message/detail/hint).
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'claim_video_date_surface.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'surface_claim_failed',
          'code', 'SURFACE_CLAIM_FAILED',
          'error_code', 'SURFACE_CLAIM_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Surface-claim event ledger (formerly the 20260607155414 lifecycle
    -- base). Best effort; never blocks the claim result. ──
    v_result_code := public.video_date_client_stuck_safe_text(
      COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error', v_result->>'reason'),
      120
    );
    v_ok := CASE lower(COALESCE(v_result->>'ok', v_result->>'success', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;
    v_blocked := CASE lower(COALESCE(v_result->>'blocked', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE CASE
        WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN true
        ELSE NULL
      END
    END;
    v_retryable := CASE lower(COALESCE(v_result->>'retryable', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;

    BEGIN
      INSERT INTO public.video_date_surface_claim_events (
        session_id,
        actor_id,
        surface,
        client_instance_id,
        action,
        takeover,
        ttl_seconds,
        ok,
        blocked,
        retryable,
        result_code,
        detail
      ) VALUES (
        p_session_id,
        v_actor,
        public.video_date_client_stuck_safe_text(p_surface, 80),
        public.video_date_client_stuck_safe_text(p_client_instance_id, 160),
        'claim',
        COALESCE(p_takeover, false),
        CASE
          WHEN p_ttl_seconds IS NULL THEN NULL
          ELSE LEAST(3600, GREATEST(1, p_ttl_seconds))
        END,
        v_ok,
        v_blocked,
        v_retryable,
        v_result_code,
        jsonb_strip_nulls(jsonb_build_object(
          'result', v_result,
          'source', 'claim_video_date_surface',
          'ok_source', CASE
            WHEN v_result ? 'ok' THEN 'ok'
            WHEN v_result ? 'success' THEN 'success'
            ELSE NULL
          END,
          'blocked_source', CASE
            WHEN v_result ? 'blocked' THEN 'blocked'
            WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN 'code'
            ELSE NULL
          END
        ))
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    -- ── Lifecycle enrichment + sanitization (formerly the 20260608080938
    -- last-resort and vd_claim_surface_terminal_truth bases). ──
    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'claim_video_date_surface',
      v_result
    );

    -- ── Terminal-truth audit stamping (formerly vd_claim_surface
    -- 20260609130139 hot base). ──
    SELECT
      vs.id,
      vs.event_id,
      vs.terminal_generation,
      vs.state_updated_at,
      vs.ended_at,
      vs.ended_reason,
      vs.terminal_audit_at,
      vs.terminal_audit_reason
    INTO v_term
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    IF FOUND THEN
      UPDATE public.video_date_surface_claim_events e
      SET
        session_terminal_generation = v_term.terminal_generation,
        session_state_updated_at = v_term.state_updated_at,
        session_ended_at = v_term.ended_at,
        session_ended_reason = v_term.ended_reason,
        detail = COALESCE(e.detail, '{}'::jsonb)
          || jsonb_build_object(
            'session_terminal_generation', v_term.terminal_generation,
            'session_state_updated_at', v_term.state_updated_at,
            'session_ended_at', v_term.ended_at,
            'session_ended_reason', v_term.ended_reason,
            'terminal_audit_at', v_term.terminal_audit_at,
            'terminal_audit_reason', v_term.terminal_audit_reason
          )
      WHERE e.id IN (
        SELECT recent.id
        FROM public.video_date_surface_claim_events recent
        WHERE recent.session_id = p_session_id
          AND recent.surface = COALESCE(NULLIF(p_surface, ''), recent.surface)
          AND (
            p_client_instance_id IS NULL
            OR recent.client_instance_id = p_client_instance_id
          )
        ORDER BY recent.created_at DESC, recent.id DESC
        LIMIT 3
      );

      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO public.video_date_surface_claim_events (
          session_id,
          surface,
          actor_id,
          client_instance_id,
          action,
          takeover,
          ttl_seconds,
          ok,
          blocked,
          retryable,
          result_code,
          detail,
          session_terminal_generation,
          session_state_updated_at,
          session_ended_at,
          session_ended_reason
        ) VALUES (
          p_session_id,
          COALESCE(NULLIF(p_surface, ''), 'video_date'),
          v_actor,
          NULLIF(p_client_instance_id, ''),
          'claim_terminal_audit',
          COALESCE(p_takeover, false),
          p_ttl_seconds,
          lower(COALESCE(v_result->>'ok', v_result->>'success', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'blocked', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'retryable', 'false')) IN ('true', 't', '1', 'yes'),
          COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error'),
          COALESCE(v_result, '{}'::jsonb)
            || jsonb_build_object(
              'session_terminal_generation', v_term.terminal_generation,
              'session_state_updated_at', v_term.state_updated_at,
              'session_ended_at', v_term.ended_at,
              'session_ended_reason', v_term.ended_reason,
              'terminal_audit_at', v_term.terminal_audit_at,
              'terminal_audit_reason', v_term.terminal_audit_reason
            ),
          v_term.terminal_generation,
          v_term.state_updated_at,
          v_term.ended_at,
          v_term.ended_reason
        );
      END IF;

      v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'session_terminal_generation', v_term.terminal_generation,
        'session_state_updated_at', v_term.state_updated_at,
        'session_ended_at', v_term.ended_at,
        'session_ended_reason', v_term.ended_reason
      );
    END IF;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
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
          'claim_video_date_surface.single_body',
          'surface_claim_wrapper_failed',
          'SURFACE_CLAIM_WRAPPER_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'claim_video_date_surface',
            'surface', left(btrim(COALESCE(p_surface, '')), 80),
            'client_instance_id', NULLIF(left(btrim(COALESCE(p_client_instance_id, '')), 180), ''),
            'error', 'surface_claim_failed',
            'reason', 'surface_claim_failed',
            'code', 'SURFACE_CLAIM_FAILED',
            'error_code', 'SURFACE_CLAIM_FAILED',
            'retryable', true,
            'terminal', false,
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
