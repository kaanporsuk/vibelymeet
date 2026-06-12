-- VD rebuild PR 8.5 follow-up: consolidate post-date survey eligibility onto
-- the v2 (confirmed-encounter) semantics and drop the v1 (exposure) helper.
--
-- v1 considered a session survey-eligible from bilateral *joins* (exposure);
-- v2 additionally requires bilateral *remote-seen* stamps (confirmed
-- encounter). Live inventory (2026-06-12) found exactly six v1 callers, all
-- reading public.video_sessions rows that carry the remote_seen columns:
--   check_mutual_vibe_and_match, claim_video_date_surface,
--   finalize_video_date_entry_deadline (x2 call sites),
--   get_video_date_sprint7_ops_health, resolve_post_date_next_surface,
--   submit_video_date_safety_report_v2.
-- Each call below is the live body with the call retargeted to v2 plus the
-- two remote_seen arguments; CREATE OR REPLACE preserves existing ACLs.

-- ── check_mutual_vibe_and_match ──
CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT public.video_date_session_is_post_date_survey_eligible_v2(
    v_session.ended_at,
    v_session.ended_reason,
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'mutual', false
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
       OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutual', false,
      'reported_pair', true
    );
  END IF;

  SELECT liked INTO v_user1_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_1_id;

  SELECT liked INTO v_user2_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_2_id;

  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
    v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    SELECT id INTO v_existing_match
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2;

    IF v_existing_match IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_p1, v_p2, v_session.event_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      END IF;

      SELECT id INTO v_existing_match
      FROM public.matches
      WHERE profile_id_1 = v_p1
        AND profile_id_2 = v_p2;

      RETURN jsonb_build_object(
        'success', true,
        'mutual', true,
        'match_id', v_existing_match,
        'already_matched', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'mutual', true,
      'match_id', v_existing_match,
      'already_matched', true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;

-- ── claim_video_date_surface ──
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
$function$;

-- ── finalize_video_date_entry_deadline ──
CREATE OR REPLACE FUNCTION public.finalize_video_date_entry_deadline(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- Stage A: rescue-only early confirmed-encounter promotion (head).
  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    p_actor,
    COALESCE(NULLIF(p_source, ''), 'finalize_video_date_entry_deadline'),
    p_reason,
    false
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  <<base>>
  BEGIN
    -- Stage B (fold of finalize_vd_*_20260605115657): preflight repair,
    -- already-in-date short-circuit, active-confirmed-encounter rescue
    -- promotion, and the v2 launch-evidence deadline extension.
    DECLARE
    v_now timestamptz := clock_timestamp();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_latest_webhook_join_at timestamptz;
    v_latest_launch_evidence_at timestamptz;
    v_participant_1_latest_evidence_at timestamptz;
    v_participant_2_latest_evidence_at timestamptz;
    v_first_confirmed_encounter_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_due boolean := false;
    v_confirmed_encounter boolean := false;
    v_active_confirmed_encounter boolean := false;
    v_previous_entry_started_at timestamptz;
    v_date_started_at timestamptz;
    v_seconds_remaining integer;
    v_event jsonb := '{}'::jsonb;
    BEGIN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        'confirmed_encounter_deadline_preflight'
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      -- (fold) session row missing: fall through to the core stage below

      IF v_session.state::text = 'date'
         OR v_session.phase = 'date'
         OR v_session.date_started_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_session.date_started_at,
          'reason', 'already_in_date',
          'session_seq', COALESCE(v_session.session_seq, 0)
        );
        EXIT base;
      END IF;

      IF v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL THEN
        v_previous_entry_started_at := v_session.entry_started_at;
        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
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

        v_first_confirmed_encounter_at := GREATEST(
          COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_active_confirmed_encounter THEN
          v_date_started_at := v_now;

          UPDATE public.video_sessions
          SET
            state = 'date'::public.video_date_state,
            phase = 'date',
            date_started_at = v_date_started_at,
            ended_at = NULL,
            ended_reason = NULL,
            reconnect_grace_ends_at = NULL,
            entry_grace_expires_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            daily_room_name = COALESCE(daily_room_name, v_expected_room_name),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
            AND date_started_at IS NULL
          RETURNING * INTO v_session;

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
            'confirmed_encounter_deadline_promoted_to_date',
            'participants',
            p_actor,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'date_started_at', v_date_started_at,
              'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
            ),
            jsonb_build_object(
              'state', 'date',
              'phase', 'date',
              'date_started_at', v_date_started_at,
              'reason', 'confirmed_encounter_deadline_rescue'
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
            'confirmed_encounter_deadline_promoted_to_date',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'date_started_at', v_date_started_at,
              'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'participant_1_away_at', v_session.participant_1_away_at,
              'participant_2_away_at', v_session.participant_2_away_at,
              'event_result', v_event
            )
          );

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'date',
            'phase', 'date',
            'date_started_at', v_session.date_started_at,
            'reason', 'confirmed_encounter_deadline_rescue',
            'recovered_confirmed_encounter', true,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

        v_latest_launch_evidence_at := GREATEST(
          COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = v_now,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
            AND date_started_at IS NULL
          RETURNING * INTO v_session;

          v_seconds_remaining := GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM ((v_now + interval '60 seconds') - clock_timestamp())))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence_v2',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'extension_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'entry',
            'phase', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true,
            'extension_started_at', v_session.entry_started_at,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to launch-evidence v1 stage
    END;

    -- Stage C (fold of finalize_vd_*_20260605085010): both-joined v1
    -- launch-evidence deadline extension.
    DECLARE
    v_now timestamptz := now();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_latest_webhook_join_at timestamptz;
    v_latest_launch_evidence_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_due boolean := false;
    v_seconds_remaining integer;
    BEGIN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        'entry_deadline_preflight'
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL
         AND v_session.participant_1_joined_at IS NOT NULL
         AND v_session.participant_2_joined_at IS NOT NULL THEN

        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_has_explicit_pass := (
          (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
          OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
        );
        v_both_decided := v_session.participant_1_decided_at IS NOT NULL
          AND v_session.participant_2_decided_at IS NOT NULL;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

        v_latest_launch_evidence_at := GREATEST(
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_latest_launch_evidence_at IS NOT NULL
           AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = LEAST(v_now, v_latest_launch_evidence_at),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          v_seconds_remaining := GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((LEAST(v_now, v_latest_launch_evidence_at) + interval '60 seconds') - v_now)))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to the terminal core stage
    END;

    -- Stage D (fold of *_20260603215948_handoff + *_20260603090000): the
    -- terminal deadline core plus the unconfirmed-date guard and v2
    -- survey continuity.
    DECLARE


    v_session public.video_sessions%ROWTYPE;

    v_should_open_survey boolean := false;

    v_event_live boolean := false;

    v_resume_status text := 'idle';
    v_now timestamptz := now();

    v_ev uuid;

    v_p1 uuid;

    v_p2 uuid;

    v_is_p1 boolean := false;

    v_is_p2 boolean := false;

    v_actor_decided_at timestamptz;

    v_partner_decided_at timestamptz;

    v_waiting_for_self boolean := false;

    v_waiting_for_partner boolean := false;

    v_p1_decided boolean := false;

    v_p2_decided boolean := false;

    v_p1_explicit_pass boolean := false;

    v_p2_explicit_pass boolean := false;

    v_due boolean := false;

    v_seconds_remaining integer;

    v_state_before text;

    v_reason_code text;

    v_terminal_reason text;
    BEGIN
      <<term_core>>
      BEGIN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'session_not_found',
            NULL,
            NULL,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
          EXIT term_core;
        END IF;

        v_ev := v_session.event_id;
        v_p1 := v_session.participant_1_id;
        v_p2 := v_session.participant_2_id;
        v_state_before := v_session.state::text;
        v_is_p1 := p_actor IS NOT NULL AND v_p1 = p_actor;
        v_is_p2 := p_actor IS NOT NULL AND v_p2 = p_actor;

        IF p_actor IS NOT NULL AND NOT v_is_p1 AND NOT v_is_p2 THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'access_denied',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'state_before', v_state_before,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
          EXIT term_core;
        END IF;

        v_p1_decided := v_session.participant_1_decided_at IS NOT NULL;
        v_p2_decided := v_session.participant_2_decided_at IS NOT NULL;
        v_p1_explicit_pass := v_p1_decided AND v_session.participant_1_liked IS FALSE;
        v_p2_explicit_pass := v_p2_decided AND v_session.participant_2_liked IS FALSE;
        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;
        v_due := v_session.entry_started_at IS NOT NULL
          AND v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_seconds_remaining := CASE
          WHEN v_session.entry_started_at IS NULL THEN NULL
          ELSE GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((v_session.entry_started_at + interval '60 seconds') - v_now)))::int
          )
        END;

        IF v_session.ended_at IS NOT NULL THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at,
            v_session.participant_1_remote_seen_at,
            v_session.participant_2_remote_seen_at
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'session_already_ended',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'survey_required', v_should_open_survey,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object(
            'success', true,
            'state', 'ended',
            'already_ended', true,
            'reason', v_session.ended_reason,
            'survey_required', v_should_open_survey,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner
          );
          EXIT term_core;
        END IF;

        IF v_session.state = 'date'::public.video_date_state
           OR v_session.phase = 'date'
           OR v_session.date_started_at IS NOT NULL THEN
          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF v_p1_decided
           AND v_p2_decided
           AND v_session.participant_1_liked IS TRUE
           AND v_session.participant_2_liked IS TRUE THEN
          UPDATE public.video_sessions
          SET
            state = 'date'::public.video_date_state,
            phase = 'date',
            date_started_at = COALESCE(date_started_at, v_now),
            entry_grace_expires_at = NULL,
            reconnect_grace_ends_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          UPDATE public.event_registrations
          SET
            queue_status = 'in_date',
            current_room_id = p_session_id,
            current_partner_id = CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END,
            last_active_at = v_now
          WHERE event_id = v_ev
            AND profile_id IN (v_p1, v_p2);

          SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'entry_deadline_completed_mutual',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', false,
              'waiting_for_partner', false,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF NOT v_due THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_not_due',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'seconds_remaining', v_seconds_remaining,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', false,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'seconds_remaining', v_seconds_remaining
          );
          EXIT term_core;
        END IF;

        IF v_p1_explicit_pass OR v_p2_explicit_pass OR (v_p1_decided AND v_p2_decided) THEN
          v_terminal_reason := 'entry_not_mutual';
          v_reason_code := 'entry_deadline_not_mutual';
        ELSE
          v_terminal_reason := 'entry_timeout';
          v_reason_code := 'entry_deadline_timeout';
        END IF;

        UPDATE public.video_sessions
        SET
          state = 'ended'::public.video_date_state,
          phase = 'ended',
          ended_at = COALESCE(ended_at, v_now),
          ended_reason = v_terminal_reason,
          entry_grace_expires_at = NULL,
          reconnect_grace_ends_at = NULL,
          participant_1_away_at = NULL,
          participant_2_away_at = NULL,
          duration_seconds = COALESCE(
            duration_seconds,
            GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.entry_started_at, v_session.started_at))))::int)
          ),
          state_updated_at = v_now
        WHERE id = p_session_id
          AND ended_at IS NULL;

        SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

        v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
          v_session.ended_at,
          v_session.ended_reason,
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        );

        UPDATE public.event_registrations
        SET
          queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'idle' END,
          current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
          current_partner_id = CASE
            WHEN v_should_open_survey THEN CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END
            ELSE NULL
          END,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);

        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          v_reason_code,
          NULL,
          v_ev,
          p_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'complete_entry',
            'source', p_source,
            'participant_1_liked', v_session.participant_1_liked,
            'participant_2_liked', v_session.participant_2_liked,
            'participant_1_decided_at', v_session.participant_1_decided_at,
            'participant_2_decided_at', v_session.participant_2_decided_at,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'state_before', v_state_before,
            'state_after', v_session.state::text,
            'deadline_due', true,
            'entry_deadline_seconds', 60,
            'entry_grace_removed', true,
            'survey_required', v_should_open_survey,
            'entry_grace_expires_at', v_session.entry_grace_expires_at,
            'p_reason', p_reason
          )
        );

        v_result := jsonb_build_object(
          'success', true,
          'state', 'ended',
          'reason', v_terminal_reason,
          'survey_required', v_should_open_survey,
          'waiting_for_self', v_waiting_for_self,
          'waiting_for_partner', v_waiting_for_partner,
          'local_decision_persisted', NOT v_waiting_for_self,
          'partner_decision_persisted', NOT v_waiting_for_partner
        );
        EXIT term_core;  END;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'date' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND NOT public.video_date_session_has_confirmed_encounter(
             v_session.date_started_at,
             v_session.state::text,
             v_session.phase,
             v_session.participant_1_joined_at,
             v_session.participant_2_joined_at,
             v_session.participant_1_remote_seen_at,
             v_session.participant_2_remote_seen_at
           ) THEN
          v_result := public.end_unconfirmed_video_date_start(
            p_session_id,
            p_actor,
            'deadline_' || COALESCE(NULLIF(p_source, ''), 'unknown'),
            p_reason
          );
          EXIT base;
        END IF;
      END IF;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'ended' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at,
            v_session.participant_1_remote_seen_at,
            v_session.participant_2_remote_seen_at
          );

          IF v_should_open_survey THEN
            UPDATE public.event_registrations
            SET
              queue_status = 'in_survey',
              current_room_id = p_session_id,
              current_partner_id = CASE
                WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
                ELSE v_session.participant_1_id
              END,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);
          ELSE
            SELECT EXISTS (
              SELECT 1
              FROM public.events ev
              WHERE ev.id = v_session.event_id
                AND ev.status = 'live'
                AND ev.archived_at IS NULL
            ) INTO v_event_live;
            v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

            UPDATE public.event_registrations
            SET
              queue_status = v_resume_status,
              current_room_id = NULL,
              current_partner_id = NULL,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
              AND (current_room_id = p_session_id OR current_room_id IS NULL);
          END IF;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            CASE WHEN v_should_open_survey THEN 'deadline_confirmed_encounter_survey' ELSE 'deadline_unconfirmed_encounter_no_survey' END,
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'source', p_source,
              'reason', p_reason,
              'ended_reason', v_session.ended_reason,
              'date_started_at', v_session.date_started_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'survey_required', v_should_open_survey,
              'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END
            )
          );
        END IF;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey);
        EXIT base;
      END IF;

      v_result := v_result;
      EXIT base;    END;
  END;

  -- Head tail: post-base canonical room repair + promotion metadata merge.
  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'finalize_video_date_entry_deadline:post_base_room_repair'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

-- ── get_video_date_sprint7_ops_health ──
CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_windows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  WITH windows(window_id, window_label, window_interval) AS (
    VALUES
      ('24h'::text, '24h'::text, interval '24 hours'),
      ('7d'::text, '7d'::text, interval '7 days')
  ),
  session_window AS (
    SELECT
      w.window_id,
      w.window_interval,
      vs.*
    FROM windows w
    JOIN public.video_sessions vs
      ON (
        vs.started_at >= now() - w.window_interval
        OR vs.state_updated_at >= now() - w.window_interval
        OR vs.ended_at >= now() - w.window_interval
        OR vs.ended_at IS NULL
      )
    WHERE p_event_id IS NULL OR vs.event_id = p_event_id
  ),
  session_rollup AS (
    SELECT
      sw.window_id,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
          AND COALESCE(sw.ready_gate_expires_at, sw.started_at + interval '3 minutes') < now()
      )::integer AS stuck_ready_gate_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND (
            COALESCE(sw.phase, '') IN ('entry', 'entry', 'warmup')
            OR sw.state::text IN ('entry', 'entry')
          )
          AND COALESCE(sw.state_updated_at, sw.entry_started_at, sw.started_at) < now() - interval '2 minutes'
      )::integer AS stuck_entry_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.phase = 'date'
          AND sw.date_started_at IS NOT NULL
          AND sw.date_started_at
              + ((COALESCE(sw.duration_seconds, 300)
                  + COALESCE(sw.date_extra_seconds, 0)
                  + 60) * interval '1 second') < now()
      )::integer AS overdue_date_count,
      COALESCE(sum(
        CASE
          WHEN sw.date_started_at IS NOT NULL
           AND sw.ended_at IS NOT NULL
           AND sw.ended_at >= now() - sw.window_interval
           AND public.video_date_session_is_post_date_survey_eligible_v2(
             sw.ended_at,
             sw.ended_reason,
             sw.date_started_at,
             sw.state::text,
             sw.phase,
             sw.participant_1_joined_at,
             sw.participant_2_joined_at,
             sw.participant_1_remote_seen_at,
             sw.participant_2_remote_seen_at
           )
          THEN
            (CASE WHEN NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df
              WHERE df.session_id = sw.id
                AND df.user_id = sw.participant_1_id
            ) THEN 1 ELSE 0 END)
            +
            (CASE WHEN NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df
              WHERE df.session_id = sw.id
                AND df.user_id = sw.participant_2_id
            ) THEN 1 ELSE 0 END)
          ELSE 0
        END
      ), 0)::integer AS pending_survey_recovery_count
    FROM session_window sw
    GROUP BY sw.window_id
  ),
  event_rollup AS (
    SELECT
      w.window_id,
      COALESCE(e.prepare_entry_failure_count, 0)::integer AS prepare_entry_failure_count,
      COALESCE(e.daily_join_failure_count, 0)::integer AS daily_join_failure_count,
      COALESCE(e.client_stuck_observed_count, 0)::integer AS client_stuck_observed_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (
          WHERE eo.operation = 'video_date_launch_latency_checkpoint'
            AND (
              eo.reason_code IN ('prepare_entry_failure', 'prepare_date_entry_failure')
              OR eo.detail->>'checkpoint' IN ('prepare_entry_failure', 'prepare_date_entry_failure')
            )
        )::integer AS prepare_entry_failure_count,
        count(*) FILTER (
          WHERE eo.operation = 'video_date_launch_latency_checkpoint'
            AND (
              eo.reason_code IN ('daily_join_failure', 'daily_call_join_failure')
              OR eo.detail->>'checkpoint' IN ('daily_join_failure', 'daily_call_join_failure')
            )
        )::integer AS daily_join_failure_count,
        count(*) FILTER (
          WHERE eo.operation = 'video_date_client_stuck_state'
        )::integer AS client_stuck_observed_count
      FROM public.event_loop_observability_events eo
      WHERE eo.created_at >= now() - w.window_interval
        AND eo.operation IN (
          'video_date_launch_latency_checkpoint',
          'video_date_client_stuck_state'
        )
        AND (p_event_id IS NULL OR eo.event_id = p_event_id)
    ) e ON true
  ),
  safety_rollup AS (
    SELECT
      w.window_id,
      COALESCE(r.report_count, 0)::integer AS report_count,
      COALESCE(r.pending_report_count, 0)::integer AS pending_report_count,
      COALESCE(r.report_with_block_count, 0)::integer AS report_with_block_count,
      COALESCE(b.block_count, 0)::integer AS block_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS report_count,
        count(*) FILTER (WHERE ur.status = 'pending')::integer AS pending_report_count,
        count(*) FILTER (WHERE COALESCE(ur.also_blocked, false))::integer AS report_with_block_count
      FROM public.user_reports ur
      WHERE ur.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                (vs.participant_1_id = ur.reporter_id AND vs.participant_2_id = ur.reported_id)
                OR (vs.participant_2_id = ur.reporter_id AND vs.participant_1_id = ur.reported_id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.event_registrations er_reporter
            JOIN public.event_registrations er_reported
              ON er_reported.event_id = er_reporter.event_id
             AND er_reported.profile_id = ur.reported_id
            WHERE er_reporter.event_id = p_event_id
              AND er_reporter.profile_id = ur.reporter_id
          )
        )
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS block_count
      FROM public.blocked_users bu
      WHERE bu.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                (vs.participant_1_id = bu.blocker_id AND vs.participant_2_id = bu.blocked_id)
                OR (vs.participant_2_id = bu.blocker_id AND vs.participant_1_id = bu.blocked_id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.event_registrations er_blocker
            JOIN public.event_registrations er_blocked
              ON er_blocked.event_id = er_blocker.event_id
             AND er_blocked.profile_id = bu.blocked_id
            WHERE er_blocker.event_id = p_event_id
              AND er_blocker.profile_id = bu.blocker_id
          )
        )
    ) b ON true
  ),
  webhook_rollup AS (
    SELECT
      w.window_id,
      COALESCE(sum(d.error_rows), 0)::integer AS webhook_dlq_count,
      COALESCE(sum(d.unresolved_rows), 0)::integer AS unresolved_webhook_dlq_count,
      COALESCE(sum(d.retryable_rows), 0)::integer AS retryable_webhook_dlq_count,
      COALESCE(
        jsonb_object_agg(d.error_class, d.error_rows ORDER BY d.error_rows DESC)
          FILTER (WHERE d.error_class IS NOT NULL),
        '{}'::jsonb
      ) AS webhook_dlq_error_classes
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        min(id) AS id,
        error_class,
        count(*)::integer AS error_rows,
        count(*) FILTER (WHERE state IN ('pending', 'retrying'))::integer AS unresolved_rows,
        count(*) FILTER (WHERE retryable)::integer AS retryable_rows
      FROM public.video_date_webhook_dlq dlq
      WHERE dlq.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND vs.daily_room_name IS NOT NULL
              AND vs.daily_room_name = dlq.room_name
          )
        )
      GROUP BY error_class
    ) d ON true
    GROUP BY w.window_id
  ),
  orphan_rollup AS (
    SELECT
      w.window_id,
      COALESCE(o.orphan_room_cleanup_rows, 0)::integer AS orphan_room_cleanup_rows,
      COALESCE(o.orphan_room_cleanup_failed_count, 0)::integer AS orphan_room_cleanup_failed_count,
      COALESCE(o.orphan_room_destructive_candidate_count, 0)::integer AS orphan_room_destructive_candidate_count,
      COALESCE(o.orphan_room_safety_interlock_skip_count, 0)::integer AS orphan_room_safety_interlock_skip_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS orphan_room_cleanup_rows,
        count(*) FILTER (WHERE oa.action = 'delete_failed')::integer AS orphan_room_cleanup_failed_count,
        count(*) FILTER (WHERE oa.action IN ('delete_candidate', 'deleted', 'dry_run_delete'))::integer AS orphan_room_destructive_candidate_count,
        count(*) FILTER (WHERE oa.action = 'skipped_safety_review')::integer AS orphan_room_safety_interlock_skip_count
      FROM public.video_date_orphan_room_cleanup_audit oa
      WHERE oa.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                vs.id = oa.session_id
                OR (
                  oa.session_id IS NULL
                  AND vs.daily_room_name IS NOT NULL
                  AND vs.daily_room_name = oa.room_name
                )
              )
          )
        )
    ) o ON true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'window_id', w.window_id,
      'window_label', w.window_label,
      'event_id', p_event_id,
      'status', CASE
        WHEN COALESCE(sr.stuck_ready_gate_count, 0)
           + COALESCE(sr.stuck_entry_count, 0)
           + COALESCE(sr.overdue_date_count, 0)
           + COALESCE(wh.unresolved_webhook_dlq_count, 0)
           + COALESCE(orh.orphan_room_cleanup_failed_count, 0) > 0 THEN 'critical'
        WHEN COALESCE(sr.pending_survey_recovery_count, 0)
           + COALESCE(er.prepare_entry_failure_count, 0)
           + COALESCE(er.daily_join_failure_count, 0)
           + COALESCE(er.client_stuck_observed_count, 0)
           + COALESCE(sa.pending_report_count, 0) > 0 THEN 'warning'
        ELSE 'healthy'
      END,
      'stuck_ready_gate_count', COALESCE(sr.stuck_ready_gate_count, 0),
      'stuck_entry_count', COALESCE(sr.stuck_entry_count, 0),
      'stuck_entry_count', COALESCE(sr.stuck_entry_count, 0),
      'overdue_date_count', COALESCE(sr.overdue_date_count, 0),
      'pending_survey_recovery_count', COALESCE(sr.pending_survey_recovery_count, 0),
      'prepare_entry_failure_count', COALESCE(er.prepare_entry_failure_count, 0),
      'daily_join_failure_count', COALESCE(er.daily_join_failure_count, 0),
      'client_stuck_observed_count', COALESCE(er.client_stuck_observed_count, 0),
      'report_count', COALESCE(sa.report_count, 0),
      'pending_report_count', COALESCE(sa.pending_report_count, 0),
      'report_with_block_count', COALESCE(sa.report_with_block_count, 0),
      'block_count', COALESCE(sa.block_count, 0),
      'webhook_dlq_count', COALESCE(wh.webhook_dlq_count, 0),
      'unresolved_webhook_dlq_count', COALESCE(wh.unresolved_webhook_dlq_count, 0),
      'retryable_webhook_dlq_count', COALESCE(wh.retryable_webhook_dlq_count, 0),
      'webhook_dlq_error_classes', COALESCE(wh.webhook_dlq_error_classes, '{}'::jsonb),
      'orphan_room_cleanup_rows', COALESCE(orh.orphan_room_cleanup_rows, 0),
      'orphan_room_cleanup_failed_count', COALESCE(orh.orphan_room_cleanup_failed_count, 0),
      'orphan_room_destructive_candidate_count', COALESCE(orh.orphan_room_destructive_candidate_count, 0),
      'orphan_room_safety_interlock_skip_count', COALESCE(orh.orphan_room_safety_interlock_skip_count, 0)
    )
    ORDER BY CASE w.window_id WHEN '24h' THEN 1 ELSE 2 END
  )
  INTO v_windows
  FROM windows w
  LEFT JOIN session_rollup sr ON sr.window_id = w.window_id
  LEFT JOIN event_rollup er ON er.window_id = w.window_id
  LEFT JOIN safety_rollup sa ON sa.window_id = w.window_id
  LEFT JOIN webhook_rollup wh ON wh.window_id = w.window_id
  LEFT JOIN orphan_rollup orh ON orh.window_id = w.window_id;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'event_id', p_event_id,
    'privacy_contract', jsonb_build_object(
      'scope', 'service_role_only',
      'payload_shape', 'counts_enum_reasons_and_operational_ids_only',
      'excludes', jsonb_build_array(
        'daily_tokens',
        'provider_secrets',
        'auth_headers',
        'profile_text',
        'profile_names',
        'emails',
        'phone_numbers',
        'media_urls',
        'freeform_report_details'
      )
    ),
    'windows', COALESCE(v_windows, '[]'::jsonb)
  );
END;
$function$;

-- ── resolve_post_date_next_surface ──
CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_target_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_event_active boolean := false;
  v_event_reason text := 'unknown';
  v_event_ends_at timestamptz;
  v_seconds_until_event_end integer;
  v_has_feedback boolean := false;
  v_pair_blocked_or_reported boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_target_id := CASE
    WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  SELECT
    public.is_blocked(v_uid, v_target_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_uid AND ur.reported_id = v_target_id)
         OR (ur.reporter_id = v_target_id AND ur.reported_id = v_uid)
    )
  INTO v_pair_blocked_or_reported;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) INTO v_has_feedback;

  IF public.video_date_session_is_post_date_survey_eligible_v2(
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
    AND NOT v_has_feedback
    AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'reason', 'survey_required'
    );
  END IF;

  IF v_session.event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'home',
      'route', 'home',
      'session_id', p_session_id,
      'target_id', v_target_id,
      'reason', 'no_event_context'
    );
  END IF;

  v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
  v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

  IF NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    SELECT id INTO v_match_id
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2
    LIMIT 1;
  END IF;

  SELECT state.is_active, state.reason
  INTO v_event_active, v_event_reason
  FROM public.get_event_lobby_active_state(v_session.event_id, v_now) AS state
  LIMIT 1;

  SELECT e.event_date + (COALESCE(e.duration_minutes, 60) * interval '1 minute')
  INTO v_event_ends_at
  FROM public.events e
  WHERE e.id = v_session.event_id;

  IF v_event_ends_at IS NOT NULL THEN
    v_seconds_until_event_end := floor(EXTRACT(EPOCH FROM (v_event_ends_at - v_now)))::integer;
  END IF;

  IF COALESCE(v_event_active, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'lobby',
      'route', 'event_lobby',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'seconds_until_event_end', v_seconds_until_event_end,
      'reason', CASE
        WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
        WHEN v_seconds_until_event_end IS NOT NULL AND v_seconds_until_event_end <= 300 THEN 'last_chance'
        ELSE 'event_active'
      END
    );
  END IF;

  IF v_match_id IS NOT NULL AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'chat',
      'route', 'chat',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'event_active', false,
      'reason', 'event_closed_mutual_match'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'wrap_up',
    'route', 'event_wrap_up',
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'event_active', false,
    'event_reason', v_event_reason,
    'reason', CASE
      WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
      ELSE 'event_not_active'
    END
  );
END;
$function$;

-- ── submit_video_date_safety_report_v2 ──
CREATE OR REPLACE FUNCTION public.submit_video_date_safety_report_v2(p_session_id uuid, p_reason text, p_details text DEFAULT NULL::text, p_also_block boolean DEFAULT false, p_end_session boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();

  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');

  v_result jsonb;

  v_session public.video_sessions%ROWTYPE;

  v_after public.video_sessions%ROWTYPE;

  v_target uuid;

  v_reason text := lower(btrim(COALESCE(p_reason, '')));

  v_details text := NULLIF(left(btrim(COALESCE(p_details, '')), 4000), '');

  v_details_hash text;

  v_recent int;

  v_report_id uuid;

  v_block_result jsonb;

  v_transition jsonb := '{}'::jsonb;

  v_begin jsonb;

  v_command_id bigint;

  v_request jsonb;

  v_success boolean := true;

  v_delete_room_name text;

  v_was_ended boolean := false;

  v_ended boolean := false;

  v_survey_required boolean := false;
BEGIN
  -- (fold of *_20260522011000_error_base)
  <<report>>
  BEGIN
    IF v_actor IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_authenticated');
      EXIT report;
    END IF;

    IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
      EXIT report;
    END IF;

    IF v_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
      EXIT report;
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
      EXIT report;
    END IF;

    IF v_actor IS DISTINCT FROM v_session.participant_1_id
       AND v_actor IS DISTINCT FROM v_session.participant_2_id THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_participant');
      EXIT report;
    END IF;

    v_target := CASE
      WHEN v_session.participant_1_id = v_actor THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END;
    v_was_ended := COALESCE(
      v_session.ended_at IS NOT NULL
        OR v_session.state::text = 'ended'
        OR v_session.phase = 'ended',
      false
    );
    v_details_hash := CASE WHEN v_details IS NULL THEN NULL ELSE md5(v_details) END;

    v_request := jsonb_build_object(
      'reason', v_reason,
      'has_details', v_details IS NOT NULL,
      'details_hash', v_details_hash,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false),
      'reported_id', v_target
    );

    v_begin := public.video_session_command_begin_v2(
      p_session_id,
      v_actor,
      'safety_report',
      v_key,
      v_request,
      NULL
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
        'commandStatus', v_begin->>'status',
        'requestHash', v_begin->>'requestHash'
      );
      EXIT report;
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      v_result := COALESCE(v_begin->'result', '{}'::jsonb)
        || jsonb_build_object(
          'idempotent', true,
          'requestHash', v_begin->>'requestHash',
          'commandStatus', v_begin->>'status'
        );
      EXIT report;
    END IF;

    IF v_begin->>'status' = 'in_progress' THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'command_in_progress',
        'commandStatus', 'in_progress',
        'requestHash', v_begin->>'requestHash'
      );
      EXIT report;
    END IF;

    v_command_id := (v_begin->>'commandId')::bigint;

    SELECT count(*)::int
    INTO v_recent
    FROM public.user_reports
    WHERE reporter_id = v_actor
      AND created_at > now() - interval '1 hour';

    IF v_recent >= 20 THEN
      v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      v_result := v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
      EXIT report;
    END IF;

    INSERT INTO public.user_reports (
      reporter_id,
      reported_id,
      reason,
      details,
      also_blocked
    )
    VALUES (
      v_actor,
      v_target,
      v_reason,
      v_details,
      COALESCE(p_also_block, false)
    )
    RETURNING id INTO v_report_id;

    PERFORM public.record_event_profile_impression_v2(
      v_session.event_id,
      v_actor,
      v_target,
      'reported',
      'video_date_safety_v2',
      p_session_id,
      jsonb_build_object('report_id', v_report_id)
    );

    PERFORM public.append_video_session_event_v2(
      p_session_id,
      'video_date_safety_report_recorded',
      'safety_review',
      v_actor,
      jsonb_build_object(
        'report_id', v_report_id,
        'reporter_id', v_actor,
        'reported_id', v_target,
        'reason', v_reason,
        'has_details', v_details IS NOT NULL,
        'details_hash', v_details_hash,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      jsonb_build_object(
        'report_recorded', true,
        'report_id', v_report_id,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      false,
      gen_random_uuid()
    );

    PERFORM public.append_video_session_event_v2(
      p_session_id,
      'video_date_safety_report_submitted',
      'actor_only',
      v_actor,
      jsonb_build_object(
        'report_id', v_report_id,
        'reported_id', v_target,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      jsonb_build_object(
        'report_recorded', true,
        'report_id', v_report_id,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      false,
      gen_random_uuid()
    );

    IF COALESCE(p_also_block, false) THEN
      PERFORM public.record_event_profile_impression_v2(
        v_session.event_id,
        v_actor,
        v_target,
        'blocked',
        'video_date_safety_v2',
        p_session_id,
        jsonb_build_object('report_id', v_report_id)
      );

      v_block_result := public.block_user_with_cleanup(
        v_target,
        'Reported during video date',
        NULL
      );
    ELSIF COALESCE(p_end_session, false) AND v_session.ended_at IS NULL THEN
      v_transition := public.video_date_transition(p_session_id, 'end', 'ended_from_client');
      IF COALESCE((v_transition->>'success')::boolean, false) IS FALSE THEN
        v_success := false;
      END IF;
    END IF;

    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_ended := COALESCE(v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended', false);
    v_survey_required := COALESCE((v_transition->>'survey_required')::boolean, false);
    IF NOT v_survey_required
       AND COALESCE(p_end_session, false)
       AND NOT COALESCE(p_also_block, false)
       AND v_ended THEN
      v_survey_required := public.video_date_session_is_post_date_survey_eligible_v2(
        v_after.ended_at,
        v_after.ended_reason,
        v_after.date_started_at,
        v_after.state::text,
        v_after.phase,
        v_after.participant_1_joined_at,
        v_after.participant_2_joined_at,
        v_after.participant_1_remote_seen_at,
        v_after.participant_2_remote_seen_at
      );

      IF v_survey_required THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_after.participant_1_id THEN v_after.participant_2_id
            ELSE v_after.participant_1_id
          END,
          last_active_at = now()
        WHERE event_id = v_after.event_id
          AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id);
      END IF;
    END IF;
    v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_session.daily_room_name, ''));

    IF (COALESCE(p_end_session, false) OR COALESCE(p_also_block, false))
       AND v_ended
       AND NOT v_was_ended THEN
      PERFORM public.append_video_session_event_v2(
        p_session_id,
        'video_date_ended',
        'participants',
        v_actor,
        jsonb_build_object(
          'source', 'participant_end',
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        jsonb_build_object(
          'source', 'participant_end',
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        true,
        gen_random_uuid()
      );

      IF v_delete_room_name IS NOT NULL THEN
        PERFORM public.video_date_outbox_enqueue_v2(
          p_session_id,
          'daily.delete_video_date_room',
          jsonb_build_object(
            'roomName', v_delete_room_name,
            'sessionId', p_session_id::text,
            'source', 'submit_video_date_safety_report_v2'
          ),
          'phase3:safety_delete_room:' || p_session_id::text,
          now()
        );
      END IF;
    END IF;

    v_result := jsonb_build_object(
      'success', v_success,
      'safety_report_recorded', true,
      'report_id', v_report_id,
      'reported_id', v_target,
      'also_blocked', COALESCE(p_also_block, false),
      'ended', v_ended,
      'survey_required', v_survey_required,
      'state', v_after.state::text,
      'phase', v_after.phase,
      'ended_at', v_after.ended_at,
      'block', v_block_result
    );

    PERFORM public.video_session_command_finish_v2(
      v_command_id,
      v_actor,
      CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'idempotent', false,
      'requestHash', v_begin->>'requestHash',
      'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END
    );
    EXIT report;  END;

  IF COALESCE((v_result->>'success')::boolean, false) IS FALSE
     AND NOT (v_result ? 'error') THEN
    v_result := v_result || jsonb_build_object('error', 'safety_end_transition_rejected');

    IF v_actor IS NOT NULL AND v_key IS NOT NULL THEN
      UPDATE public.video_session_commands
      SET result_payload = COALESCE(result_payload, '{}'::jsonb)
        || jsonb_build_object('error', 'safety_end_transition_rejected')
      WHERE actor = v_actor
        AND idempotency_key = v_key
        AND session_id = p_session_id
        AND command_kind = 'safety_report'
        AND status = 'rejected'
        AND NOT (COALESCE(result_payload, '{}'::jsonb) ? 'error');
    END IF;
  END IF;

  RETURN v_result;END;
$function$;

-- Single-path: no callers remain; drop the v1 helper.
DROP FUNCTION IF EXISTS public.video_date_session_is_post_date_survey_eligible(
  timestamptz, text, timestamptz, text, text, timestamptz, timestamptz
);
