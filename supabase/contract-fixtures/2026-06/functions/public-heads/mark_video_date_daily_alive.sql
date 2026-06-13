CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_event_id uuid;
  v_eligibility jsonb := '{}'::jsonb;
  v_provider jsonb := '{}'::jsonb;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_payload jsonb;
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_reason_code text;
  v_observed boolean := false;
  -- heartbeat worker state (formerly the 20260607155414 lifecycle base)
  v_now timestamptz;
  v_status text;
  v_routeable boolean := false;
  v_started_entry boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_provider_presence jsonb := '{}'::jsonb;
  v_join_stamp_accepted boolean := false;
  v_presence_event_recorded boolean := false;
  v_noop_observability_recorded boolean := false;
  v_presence_throttle interval;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
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
    -- ── Lifecycle eligibility precheck (formerly the hot base). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_daily_alive',
        'provider_presence_required', true,
        'provider_backed_current', false,
        'provider_presence_missing', true,
        'join_stamp_accepted', false,
        'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
        'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
        'owner_state', v_owner_state,
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    SELECT vs.event_id INTO v_event_id
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    -- ── Current-provider-session proof precheck (formerly the hot base):
    -- proof-missing calls are structured ok:true no-ops, never stamps. ──
    v_provider := public.video_date_current_provider_session_proof_v1(
      p_session_id,
      v_actor,
      v_provider_session_id,
      v_owner_state,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_provider->>'ok')::boolean, false) IS NOT TRUE THEN
      v_reason_code := COALESCE(v_provider->>'code', 'DAILY_JOIN_PROVIDER_PROOF_MISSING');

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          CASE
            WHEN COALESCE((v_provider->>'provider_presence_terminal')::boolean, false)
              THEN 'daily_alive_provider_session_left'
            ELSE 'daily_alive_provider_join_pending'
          END,
          NULL,
          v_event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', v_owner_state,
            'provider_proof', v_provider,
            'join_stamp_accepted', false,
            'lifecycle_eligibility_checked', true,
            'retryable', COALESCE((v_provider->>'retryable')::boolean, true),
            'rejection_code', v_reason_code
          )
        );
        v_observed := true;
      EXCEPTION
        WHEN OTHERS THEN
          v_observed := false;
      END;

      v_payload := v_provider
        || jsonb_build_object(
          'ok', true,
          'success', true,
          'rpc', 'mark_video_date_daily_alive',
          'error', lower(v_reason_code),
          'code', v_reason_code,
          'error_code', v_reason_code,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true,
          'join_stamp_accepted', false,
          'waiting_for_stable_copresence', true,
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'owner_state', v_owner_state,
          'lifecycle_eligibility_checked', true,
          'provider_join_webhook_required', true,
          'provider_proof_observed', v_observed
        );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    -- ── Heartbeat worker (formerly the 20260607155414 lifecycle base). ──
    BEGIN
      v_now := clock_timestamp();

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object(
          'ok', false,
          'error', 'unauthorized',
          'retryable', false
        );
      ELSE
        SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
        IF NOT FOUND THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'not_found',
            'retryable', false
          );
        ELSIF v_actor IS DISTINCT FROM v_row.participant_1_id
          AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'forbidden',
            'retryable', false
          );
        ELSIF v_row.ended_at IS NOT NULL THEN
          UPDATE public.video_date_surface_claims
          SET released_at = COALESCE(released_at, v_now),
              updated_at = v_now
          WHERE profile_id = v_actor
            AND session_id = p_session_id
            AND surface = 'video_date'
            AND released_at IS NULL;

          v_result := jsonb_build_object(
            'ok', false,
            'error', 'session_ended',
            'retryable', false,
            'terminal', true,
            'queue_status', 'in_survey',
            'ended_at', v_row.ended_at,
            'ended_reason', v_row.ended_reason,
            'surface_claim_released', true
          );
        ELSE
          v_routeable :=
            v_row.ready_gate_status = 'both_ready'
            AND (
              v_row.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
              OR v_row.phase IN ('entry', 'date')
              OR v_row.entry_started_at IS NOT NULL
              OR v_row.date_started_at IS NOT NULL
            );

          IF NOT v_routeable THEN
            v_result := jsonb_build_object(
              'ok', false,
              'error', 'not_routeable',
              'retryable', true,
              'retry_after_ms', 750,
              'ready_gate_status', v_row.ready_gate_status,
              'state', v_row.state,
              'phase', v_row.phase
            );
          ELSE
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

            v_provider_backed_current :=
              v_owner_state = 'joined'
              AND v_provider_session_id IS NOT NULL
              AND (
                v_latest_provider_event_type IS NULL
                OR (
                  v_latest_provider_event_type = 'participant.joined'
                  AND v_latest_provider_session_id = v_provider_session_id
                )
                OR (
                  v_latest_provider_event_type = 'participant.left'
                  AND v_latest_provider_session_id IS NOT NULL
                  AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
                )
              );

            v_presence_throttle := CASE
              WHEN v_provider_backed_current THEN interval '6 seconds'
              ELSE interval '30 seconds'
            END;

            IF NOT EXISTS (
              SELECT 1
              FROM public.video_date_presence_events vpe
              WHERE vpe.session_id = p_session_id
                AND vpe.actor_id = v_actor
                AND vpe.event_type = 'client_daily_alive'
                AND vpe.provider_session_id IS NOT DISTINCT FROM v_provider_session_id
                AND vpe.owner_state IS NOT DISTINCT FROM v_owner_state
                AND vpe.occurred_at >= v_now - v_presence_throttle
              LIMIT 1
            ) THEN
              INSERT INTO public.video_date_presence_events (
                session_id,
                actor_id,
                source,
                event_type,
                owner_id,
                call_instance_id,
                provider_session_id,
                entry_attempt_id,
                owner_state,
                occurred_at,
                details
              ) VALUES (
                p_session_id,
                v_actor,
                'mark_video_date_daily_alive',
                'client_daily_alive',
                NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                v_provider_session_id,
                NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                v_owner_state,
                v_now,
                jsonb_build_object(
                  'rpc', 'mark_video_date_daily_alive',
                  'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                  'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                  'provider_session_id', v_provider_session_id,
                  'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                  'owner_state', v_owner_state,
                  'provider_presence_required', true,
                  'provider_backed_current', v_provider_backed_current,
                  'join_stamp_accepted', v_provider_backed_current,
                  'latest_provider_event_type', v_latest_provider_event_type,
                  'latest_provider_event_at', v_latest_provider_event_at,
                  'latest_provider_session_id', v_latest_provider_session_id,
                  'provider_participant_id_source', 'provider_participant_id_or_payload',
                  'throttle_window_seconds', EXTRACT(EPOCH FROM v_presence_throttle)::integer
                )
              );
              v_presence_event_recorded := true;
            END IF;

            IF NOT v_provider_backed_current THEN
              IF NOT EXISTS (
                SELECT 1
                FROM public.event_loop_observability_events el
                WHERE el.operation = 'video_date_transition'
                  AND el.session_id = p_session_id
                  AND el.actor_id = v_actor
                  AND el.reason_code = 'daily_alive_without_current_provider_presence'
                  AND el.created_at >= v_now - interval '30 seconds'
                LIMIT 1
              ) THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'daily_alive_without_current_provider_presence',
                  NULL,
                  v_row.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', 'mark_video_date_daily_alive',
                    'owner_state', v_owner_state,
                    'provider_session_id', v_provider_session_id,
                    'provider_presence_required', true,
                    'latest_provider_event_type', v_latest_provider_event_type,
                    'latest_provider_event_at', v_latest_provider_event_at,
                    'latest_provider_session_id', v_latest_provider_session_id,
                    'provider_participant_id_source', 'provider_participant_id_or_payload',
                    'throttled', true
                  )
                );
                v_noop_observability_recorded := true;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_entry'
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', false,
                'waiting_for_stable_copresence', true,
                'retry_after_ms', 3000,
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence_required', true,
                'provider_backed_current', false,
                'presence_event_recorded', v_presence_event_recorded,
                'noop_observability_recorded', v_noop_observability_recorded,
                'latest_provider_event_type', v_latest_provider_event_type,
                'latest_provider_event_at', v_latest_provider_event_at,
                'latest_provider_session_id', v_latest_provider_session_id,
                'provider_presence_missing', true,
                'provider_presence_terminal', v_latest_provider_event_type = 'participant.left',
                'join_stamp_accepted', false,
                'stable_copresence_required', true
              );
            ELSE
              v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

              IF v_actor = v_row.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_1_joined_at IS NULL
                      OR participant_1_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_2_joined_at IS NULL
                      OR participant_2_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              END IF;
              v_join_stamp_accepted := true;

              SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

              v_stable := public.video_date_stable_copresence_v1(p_session_id);
              v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
              v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
              v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);
              v_provider_presence := CASE
                WHEN v_actor = v_row.participant_1_id THEN v_stable->'participant_1_provider_presence'
                ELSE v_stable->'participant_2_provider_presence'
              END;

              IF v_row.date_started_at IS NULL
                 AND v_row.entry_started_at IS NULL
                 AND v_stable_copresence THEN
                UPDATE public.video_sessions
                SET
                  entry_started_at = v_now,
                  state = 'entry'::public.video_date_state,
                  phase = 'entry',
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND date_started_at IS NULL
                  AND entry_started_at IS NULL
                RETURNING * INTO v_row;

                IF FOUND THEN
                  v_started_entry := true;
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'entry_started_after_stable_daily_alive',
                    NULL,
                    v_row.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', 'mark_video_date_daily_alive',
                      'stable_copresence', v_stable,
                      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                      'provider_session_id', v_provider_session_id,
                      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                      'provider_presence_required', true,
                      'stable_copresence_required', true
                    )
                  );
                ELSE
                  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
                END IF;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_entry'
              END;

              UPDATE public.event_registrations
              SET
                queue_status = v_status,
                current_room_id = p_session_id,
                current_partner_id = CASE
                  WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                  ELSE v_row.participant_1_id
                END,
                last_active_at = v_now
              WHERE event_id = v_row.event_id
                AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
                AND (
                  queue_status IS DISTINCT FROM v_status
                  OR current_room_id IS DISTINCT FROM p_session_id
                  OR current_partner_id IS DISTINCT FROM CASE
                    WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                    ELSE v_row.participant_1_id
                  END
                  OR last_active_at < v_now - interval '15 seconds'
                  OR last_active_at IS NULL
                );

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', v_started_entry,
                'entry_started_at', v_row.entry_started_at,
                'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
                'stable_copresence', v_stable,
                'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
                'latest_joined_at', CASE
                  WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_joined_at
                  ELSE v_row.participant_2_joined_at
                END,
                'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence', v_provider_presence,
                'provider_presence_required', true,
                'provider_backed_current', v_provider_backed_current,
                'presence_event_recorded', v_presence_event_recorded,
                'join_stamp_accepted', v_join_stamp_accepted,
                'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
                'participant_1_joined_at', v_row.participant_1_joined_at,
                'participant_1_away_at', v_row.participant_1_away_at,
                'participant_1_active', v_participant_1_active,
                'participant_2_joined_at', v_row.participant_2_joined_at,
                'participant_2_away_at', v_row.participant_2_away_at,
                'participant_2_active', v_participant_2_active,
                'stable_copresence_required', true
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

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_daily_alive.single_body_core',
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
          'error', 'daily_alive_stamp_failed',
          'code', 'DAILY_ALIVE_STAMP_FAILED',
          'error_code', 'DAILY_ALIVE_STAMP_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, remote_seen and strict/hot wrapper bases). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_promotion := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'provider_backed_alive',
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
      'mark_video_date_daily_alive',
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'strict_provider_join_proof_checked', true,
      'provider_join_webhook_required', true,
      'provider_proof', v_provider,
      'lifecycle_eligibility_checked', true
    );

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
          'mark_video_date_daily_alive.single_body',
          'daily_alive_stamp_failed',
          'DAILY_ALIVE_STAMP_FAILED',
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
            'rpc', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
            'error', 'daily_alive_failed',
            'reason', 'daily_alive_failed',
            'code', 'DAILY_ALIVE_FAILED',
            'error_code', 'DAILY_ALIVE_FAILED',
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
