CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text, p_evidence_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_eligibility jsonb := '{}'::jsonb;
  v_source text := NULLIF(left(btrim(COALESCE(p_evidence_source, '')), 80), '');
  v_allowed_sources text[] := ARRAY[
    'loadeddata',
    'playing',
    'remote_track_mounted',
    'first_remote_frame',
    'request_video_frame_callback'
  ];
  v_row public.video_sessions%ROWTYPE;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_owner_id text := NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), '');
  v_call_instance_id text := NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), '');
  v_entry_attempt_id text := NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), '');
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_latest_alive_owner_id text;
  v_latest_alive_call_instance_id text;
  v_latest_alive_provider_session_id text;
  v_latest_alive_at timestamptz;
  v_provider_backed_current boolean := false;
  v_owner_call_current boolean := false;
  v_retryable boolean := false;
  v_rejection_code text := 'REMOTE_SEEN_PROVIDER_NOT_CURRENT';
  -- stamp core state (formerly the 20260605115657 base)
  v_now timestamptz;
  v_previous_remote_seen_at timestamptz;
  v_latest_remote_seen_at timestamptz;
  v_core_ok boolean := false;
  -- promotion / grace state (formerly outer / lifecycle / provider bases)
  v_ce_promotion jsonb := '{}'::jsonb;
  v_base_reconnect_grace_cleared boolean := false;
  v_latest_away_at timestamptz;
  v_grace_latest_remote_seen_at timestamptz;
  v_rows_changed integer := 0;
  v_enriched jsonb;
  v_overlap jsonb := '{}'::jsonb;
  v_result jsonb;
  v_payload jsonb;
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
    -- ── Lifecycle eligibility precheck (head layer). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_remote_seen',
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'render_evidence_required', true,
        'remote_seen_stamp_accepted', false,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      );
    END IF;

    -- ── Render-evidence source allow-list (head layer). ──
    IF v_source IS NULL OR NOT (v_source = ANY (v_allowed_sources)) THEN
      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'remote_seen_render_evidence_required',
        'code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
        'error_code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED',
        'retryable', true,
        'retry_after_ms', 1500,
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'render_evidence_required', true,
        'remote_seen_stamp_accepted', false,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      );
    END IF;

    -- ── Provider-proof matrix (formerly vd_remote_seen_render_base). ──
    IF v_actor IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'unauthorized',
        'code', 'UNAUTHORIZED',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    SELECT *
    INTO v_row
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'not_found',
        'code', 'NOT_FOUND',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    IF v_actor IS DISTINCT FROM v_row.participant_1_id
       AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'forbidden',
        'code', 'FORBIDDEN',
        'retryable', false
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    IF v_row.ended_at IS NOT NULL THEN
      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'session_ended',
        'code', 'SESSION_ENDED',
        'retryable', false,
        'terminal', true,
        'session_ended', true,
        'ended_at', v_row.ended_at,
        'ended_reason', v_row.ended_reason,
        'provider_session_id', v_provider_session_id,
        'owner_state', v_owner_state
      );
      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    SELECT
      vde.event_type,
      vde.occurred_at,
      public.video_date_daily_provider_session_id_from_event_v1(
        vde.provider_participant_id,
        vde.payload
      )
    INTO
      v_latest_provider_event_type,
      v_latest_provider_event_at,
      v_latest_provider_session_id
    FROM public.video_date_daily_webhook_events vde
    WHERE vde.session_id = p_session_id
      AND vde.provider_user_id = v_actor::text
      AND vde.event_type IN ('participant.joined', 'participant.left')
    ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
    LIMIT 1;

    SELECT
      vpe.owner_id,
      vpe.call_instance_id,
      vpe.provider_session_id,
      vpe.occurred_at
    INTO
      v_latest_alive_owner_id,
      v_latest_alive_call_instance_id,
      v_latest_alive_provider_session_id,
      v_latest_alive_at
    FROM public.video_date_presence_events vpe
    WHERE vpe.session_id = p_session_id
      AND vpe.actor_id = v_actor
      AND vpe.event_type = 'client_daily_alive'
      AND vpe.owner_state = 'joined'
    ORDER BY vpe.occurred_at DESC NULLS LAST, vpe.created_at DESC
    LIMIT 1;

    v_owner_call_current := COALESCE(
      v_owner_id IS NOT NULL
      AND v_call_instance_id IS NOT NULL
      AND v_latest_alive_owner_id = v_owner_id
      AND v_latest_alive_call_instance_id = v_call_instance_id
      AND v_latest_alive_provider_session_id = v_provider_session_id
      AND v_latest_alive_at >= now() - interval '15 seconds',
      false
    );

    v_provider_backed_current := COALESCE(
      v_owner_state = 'joined'
      AND v_provider_session_id IS NOT NULL
      AND v_latest_provider_event_type = 'participant.joined'
      AND v_latest_provider_session_id = v_provider_session_id
      AND v_owner_call_current,
      false
    );

    IF v_provider_backed_current IS NOT TRUE THEN
      v_retryable := COALESCE(
        v_provider_session_id IS NOT NULL
        AND v_owner_state = 'joined'
        AND v_owner_id IS NOT NULL
        AND v_call_instance_id IS NOT NULL
        AND (
          v_latest_provider_event_type IS NULL
          OR (
            v_latest_provider_event_type = 'participant.left'
            AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
          )
          OR v_latest_alive_at IS NULL
          OR v_latest_alive_at < now() - interval '15 seconds'
        ),
        false
      );

      v_rejection_code := CASE
        WHEN v_owner_id IS NULL THEN 'REMOTE_SEEN_OWNER_MISSING'
        WHEN v_call_instance_id IS NULL THEN 'REMOTE_SEEN_CALL_INSTANCE_MISSING'
        WHEN v_provider_session_id IS NULL THEN 'REMOTE_SEEN_PROVIDER_SESSION_MISSING'
        WHEN v_owner_state IS DISTINCT FROM 'joined' THEN 'REMOTE_SEEN_OWNER_NOT_JOINED'
        WHEN v_latest_provider_event_type = 'participant.left'
             AND v_latest_provider_session_id = v_provider_session_id
          THEN 'REMOTE_SEEN_PROVIDER_SESSION_LEFT'
        WHEN v_latest_alive_at IS NULL THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_MISSING'
        WHEN v_latest_alive_at < now() - interval '15 seconds' THEN 'REMOTE_SEEN_OWNER_HEARTBEAT_STALE'
        WHEN v_latest_alive_owner_id IS DISTINCT FROM v_owner_id THEN 'REMOTE_SEEN_OWNER_MISMATCH'
        WHEN v_latest_alive_call_instance_id IS DISTINCT FROM v_call_instance_id THEN 'REMOTE_SEEN_CALL_INSTANCE_MISMATCH'
        WHEN v_latest_alive_provider_session_id IS DISTINCT FROM v_provider_session_id THEN 'REMOTE_SEEN_OWNER_PROVIDER_MISMATCH'
        ELSE 'REMOTE_SEEN_PROVIDER_NOT_CURRENT'
      END;

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          'remote_seen_rejected_stale_provider_session',
          NULL,
          v_row.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_remote_seen',
            'owner_id', v_owner_id,
            'call_instance_id', v_call_instance_id,
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', v_entry_attempt_id,
            'owner_state', v_owner_state,
            'provider_presence_required', true,
            'owner_call_presence_required', true,
            'provider_backed_current', false,
            'owner_call_current', v_owner_call_current,
            'latest_provider_event_type', v_latest_provider_event_type,
            'latest_provider_event_at', v_latest_provider_event_at,
            'latest_provider_session_id', v_latest_provider_session_id,
            'latest_alive_owner_id', v_latest_alive_owner_id,
            'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
            'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
            'latest_alive_at', v_latest_alive_at,
            'join_stamp_accepted', false,
            'remote_seen_stamp_accepted', false,
            'rejection_code', v_rejection_code,
            'retryable', v_retryable
          )
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      v_payload := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', lower(v_rejection_code),
        'code', v_rejection_code,
        'error_code', v_rejection_code,
        'retryable', v_retryable,
        'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
        'provider_presence_required', true,
        'owner_call_presence_required', true,
        'provider_presence_missing', true,
        'provider_presence_terminal',
          v_latest_provider_event_type = 'participant.left'
          AND v_latest_provider_session_id = v_provider_session_id,
        'provider_backed_current', false,
        'owner_call_current', v_owner_call_current,
        'join_stamp_accepted', false,
        'remote_seen_stamp_accepted', false,
        'remote_seen_rejected_stale_provider_session', true,
        'owner_id', v_owner_id,
        'call_instance_id', v_call_instance_id,
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', v_entry_attempt_id,
        'owner_state', v_owner_state,
        'latest_provider_event_type', v_latest_provider_event_type,
        'latest_provider_event_at', v_latest_provider_event_at,
        'latest_provider_session_id', v_latest_provider_session_id,
        'latest_alive_owner_id', v_latest_alive_owner_id,
        'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
        'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
        'latest_alive_at', v_latest_alive_at
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        v_payload
      ) || jsonb_build_object(
        'render_evidence_required', true,
        'render_evidence_accepted', true,
        'p_evidence_source', v_source,
        'allowed_evidence_sources', to_jsonb(v_allowed_sources),
        'lifecycle_eligibility_checked', true
      );
    END IF;

    -- ── Canonical remote-seen stamp + survey continuity (formerly the
    -- 20260605115657 base). ──
    BEGIN
      v_now := clock_timestamp();

      v_previous_remote_seen_at := CASE
        WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_remote_seen_at
        ELSE v_row.participant_2_remote_seen_at
      END;

      IF v_actor = v_row.participant_1_id THEN
        UPDATE public.video_sessions
        SET
          participant_1_remote_seen_at = GREATEST(COALESCE(participant_1_remote_seen_at, v_now), v_now),
          state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
        WHERE id = p_session_id
        RETURNING * INTO v_row;
        v_latest_remote_seen_at := v_row.participant_1_remote_seen_at;
      ELSE
        UPDATE public.video_sessions
        SET
          participant_2_remote_seen_at = GREATEST(COALESCE(participant_2_remote_seen_at, v_now), v_now),
          state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
        WHERE id = p_session_id
        RETURNING * INTO v_row;
        v_latest_remote_seen_at := v_row.participant_2_remote_seen_at;
      END IF;

      IF public.video_date_session_is_post_date_survey_eligible_v2(
        v_row.ended_at,
        v_row.ended_reason,
        v_row.date_started_at,
        v_row.state::text,
        v_row.phase,
        v_row.participant_1_joined_at,
        v_row.participant_2_joined_at,
        v_row.participant_1_remote_seen_at,
        v_row.participant_2_remote_seen_at
      ) THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
            ELSE v_row.participant_1_id
          END,
          last_active_at = v_now
        WHERE event_id = v_row.event_id
          AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
          AND (
            current_room_id IS NULL
            OR current_room_id = p_session_id
          )
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df1
              WHERE df1.session_id = p_session_id
                AND df1.user_id = v_row.participant_1_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df2
              WHERE df2.session_id = p_session_id
                AND df2.user_id = v_row.participant_2_id
            )
          )
          AND NOT public.is_blocked(v_row.participant_1_id, v_row.participant_2_id)
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_reports ur
            WHERE (ur.reporter_id = v_row.participant_1_id AND ur.reported_id = v_row.participant_2_id)
               OR (ur.reporter_id = v_row.participant_2_id AND ur.reported_id = v_row.participant_1_id)
          );
      END IF;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'remote_video_seen',
        NULL,
        v_row.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'participant_1_joined_at', v_row.participant_1_joined_at,
          'participant_2_joined_at', v_row.participant_2_joined_at,
          'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
          'latest_remote_seen_at', v_latest_remote_seen_at,
          'previous_remote_seen_at', v_previous_remote_seen_at,
          'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
          'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
            v_row.date_started_at,
            v_row.state::text,
            v_row.phase,
            v_row.participant_1_joined_at,
            v_row.participant_2_joined_at,
            v_row.participant_1_remote_seen_at,
            v_row.participant_2_remote_seen_at
          )
        )
      );

      v_result := jsonb_build_object(
        'ok', true,
        'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
        'latest_remote_seen_at', v_latest_remote_seen_at,
        'previous_remote_seen_at', v_previous_remote_seen_at,
        'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
        'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
          v_row.date_started_at,
          v_row.state::text,
          v_row.phase,
          v_row.participant_1_joined_at,
          v_row.participant_2_joined_at,
          v_row.participant_1_remote_seen_at,
          v_row.participant_2_remote_seen_at
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_remote_seen.single_body_core',
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
          'error', 'remote_seen_failed',
          'code', 'REMOTE_SEEN_FAILED',
          'error_code', 'REMOTE_SEEN_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    v_core_ok := COALESCE(
      CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
      false
    );

    -- ── Early confirmed-encounter promotion (formerly the 20260605170249
    -- outer base; the stable-bilateral-media gate lives in the shared
    -- promotion helper and is unchanged). ──
    IF v_core_ok THEN
      v_ce_promotion := public.video_date_promote_confirmed_encounter_v1(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        'remote_media_observed',
        true
      );

      IF COALESCE((v_ce_promotion->>'promoted')::boolean, false) THEN
        v_result := v_result || jsonb_build_object(
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_ce_promotion->'date_started_at',
          'early_confirmed_encounter_promoted', true,
          'promotion_reason', v_ce_promotion->>'reason',
          'session_seq', v_ce_promotion->'session_seq'
        );
      ELSE
        v_result := v_result || jsonb_build_object(
          'early_confirmed_encounter_promoted', false,
          'promotion_reason', v_ce_promotion->>'reason',
          'active_confirmed_encounter', COALESCE((v_ce_promotion->>'active_confirmed_encounter')::boolean, false)
        );
      END IF;
    END IF;

    -- ── Reconnect-grace clearing by bilateral remote-seen evidence
    -- (formerly the 20260607155414 lifecycle base). ──
    v_base_reconnect_grace_cleared := COALESCE(
      CASE
        WHEN jsonb_typeof(v_result->'reconnect_grace_cleared') = 'boolean'
          THEN (v_result->>'reconnect_grace_cleared')::boolean
        ELSE NULL
      END,
      false
    );

    IF v_core_ok THEN
      SELECT *
      INTO v_row
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND v_actor IS NOT NULL
         AND v_row.ended_at IS NULL
         AND v_row.reconnect_grace_ends_at IS NOT NULL
         AND (v_actor = v_row.participant_1_id OR v_actor = v_row.participant_2_id) THEN
        v_latest_away_at := GREATEST(
          COALESCE(v_row.participant_1_away_at, '-infinity'::timestamptz),
          COALESCE(v_row.participant_2_away_at, '-infinity'::timestamptz)
        );
        v_grace_latest_remote_seen_at := GREATEST(
          COALESCE(v_row.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_row.participant_2_remote_seen_at, '-infinity'::timestamptz)
        );

        IF v_latest_away_at <> '-infinity'::timestamptz
           AND v_grace_latest_remote_seen_at >= v_latest_away_at THEN
          UPDATE public.video_sessions
          SET
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND reconnect_grace_ends_at IS NOT NULL;
          GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
          IF v_rows_changed > 0 THEN
            PERFORM public.bump_video_session_seq(p_session_id);
            PERFORM public.record_event_loop_observability(
              'video_date_transition',
              'success',
              'reconnect_grace_cleared_by_remote_seen',
              NULL,
              v_row.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', 'mark_video_date_remote_seen',
                'latest_away_at', v_latest_away_at,
                'latest_remote_seen_at', v_grace_latest_remote_seen_at,
                'reconnect_grace_cleared', true,
                'base_reconnect_grace_cleared', v_base_reconnect_grace_cleared
              )
            );
          END IF;
        END IF;
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      'reconnect_grace_cleared',
      v_base_reconnect_grace_cleared OR v_rows_changed > 0
    );

    -- ── Provider-overlap promotion pass (formerly the 20260608120000
    -- provider base). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_overlap := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_remote_seen',
        'remote_media_or_provider_overlap',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_overlap,
      'provider_overlap_promoted_to_date', COALESCE((v_overlap->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_overlap->>'reason', v_enriched->>'promotion_reason')
    );

    -- ── Provider-proof success markers + final enrichment (formerly the
    -- vd_remote_seen_render_base post block + head markers). ──
    v_payload := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'provider_presence_required', true,
      'owner_call_presence_required', true,
      'provider_backed_current', true,
      'owner_call_current', true,
      'provider_presence_missing', false,
      'provider_presence_terminal', false,
      'remote_seen_stamp_accepted', true,
      'owner_id', v_owner_id,
      'call_instance_id', v_call_instance_id,
      'provider_session_id', v_provider_session_id,
      'entry_attempt_id', v_entry_attempt_id,
      'owner_state', v_owner_state,
      'latest_provider_event_type', v_latest_provider_event_type,
      'latest_provider_event_at', v_latest_provider_event_at,
      'latest_provider_session_id', v_latest_provider_session_id,
      'latest_alive_owner_id', v_latest_alive_owner_id,
      'latest_alive_call_instance_id', v_latest_alive_call_instance_id,
      'latest_alive_provider_session_id', v_latest_alive_provider_session_id,
      'latest_alive_at', v_latest_alive_at
    );

    RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_remote_seen',
      v_payload
    ) || jsonb_build_object(
      'render_evidence_required', true,
      'render_evidence_accepted', true,
      'p_evidence_source', v_source,
      'allowed_evidence_sources', to_jsonb(v_allowed_sources),
      'lifecycle_eligibility_checked', true
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
          'mark_video_date_remote_seen',
          'remote_seen_stamp_failed',
          'REMOTE_SEEN_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'remote_seen_stamp_failed',
            'code', 'REMOTE_SEEN_STAMP_FAILED',
            'error_code', 'REMOTE_SEEN_STAMP_FAILED',
            'rpc', 'mark_video_date_remote_seen',
            'retryable', true,
            'retry_after_ms', 1500,
            'session_id', p_session_id,
            'actor_id', v_actor,
            'provider_session_id', v_provider_session_id,
            'owner_state', v_owner_state,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms,
            'direct_json_fallback', true
          );
      END;
  END;
END;
$function$
