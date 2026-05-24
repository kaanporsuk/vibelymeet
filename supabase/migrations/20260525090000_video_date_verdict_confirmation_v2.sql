-- Verdict confirmation v2: enrich submit_post_date_verdict_v3 with canonical
-- commit proof and next-surface hints while preserving the existing response.

INSERT INTO public.client_feature_flags (flag_key, enabled, rollout_bps, description, kill_switch_active)
VALUES
  ('video_date.verdict_confirm_v2', false, 0, 'Canonical post-date verdict confirmation before permanent UI advancement.', false),
  ('video_date.verdict_confirm_v1', false, 0, 'Compatibility alias for post-date verdict confirmation rollout.', false)
ON CONFLICT (flag_key) DO UPDATE
SET
  description = EXCLUDED.description,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3(
  p_session_id uuid,
  p_liked boolean,
  p_idempotency_key text,
  p_safety_report jsonb DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_report_hash text := CASE
    WHEN p_safety_report IS NULL THEN NULL
    ELSE md5(p_safety_report::text)
  END;
  v_request jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_result jsonb;
  v_actor_result jsonb;
  v_success boolean := false;
  v_session public.video_sessions%ROWTYPE;
  v_visibility text := 'actor_only';
  v_kind text := 'post_date_verdict_recorded';
  v_event_payload jsonb;
  v_event jsonb := '{}'::jsonb;
  v_next_surface jsonb := NULL;
  v_verdict_state text := 'resolved_not_mutual';
  v_session_seq bigint := NULL;
  v_replay_result jsonb;
  v_target uuid := NULL;
  v_actor_has_feedback boolean := false;
  v_partner_has_feedback boolean := false;
  v_actor_liked boolean := false;
  v_partner_liked boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'not_authenticated');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_request := jsonb_build_object(
    'action', 'submit_verdict',
    'liked', p_liked,
    'has_safety_report', p_safety_report IS NOT NULL,
    'safety_report_hash', v_report_hash
  );

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'submit_verdict',
    v_key,
    v_request,
    p_request_hash
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
      'success', false,
      'ok', false,
      'commandStatus', COALESCE(v_begin->>'status', 'rejected')
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    v_replay_result := COALESCE(v_begin->'result', '{}'::jsonb);

    IF v_begin->>'status' = 'replay_rejected' THEN
      RETURN v_replay_result || jsonb_build_object(
        'idempotent', true,
        'commandStatus', v_begin->>'status',
        'commandId', (v_begin->>'commandId')::bigint,
        'requestHash', v_begin->>'requestHash'
      );
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_target := CASE
      WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
      WHEN v_actor = v_session.participant_2_id THEN v_session.participant_1_id
      ELSE NULL
    END;

    SELECT
      COALESCE(bool_or(df.user_id = v_actor), false),
      COALESCE(bool_or(df.user_id = v_target), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_actor), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_target), false)
    INTO
      v_actor_has_feedback,
      v_partner_has_feedback,
      v_actor_liked,
      v_partner_liked
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id IN (v_actor, v_target);

    v_session_seq := COALESCE(
      v_session.session_seq,
      CASE
        WHEN (v_replay_result->>'session_seq') ~ '^\d+$' THEN (v_replay_result->>'session_seq')::bigint
        ELSE NULL
      END,
      0
    );

    v_verdict_state := CASE
      WHEN jsonb_typeof(v_replay_result->'safety_report_recorded') = 'boolean'
        AND (v_replay_result->>'safety_report_recorded')::boolean THEN 'safety_reported'
      WHEN NOT v_partner_has_feedback THEN 'awaiting_partner'
      WHEN v_actor_liked AND v_partner_liked THEN 'resolved_mutual'
      ELSE 'resolved_not_mutual'
    END;

    BEGIN
      v_next_surface := public.resolve_post_date_next_surface(p_session_id);
    EXCEPTION WHEN OTHERS THEN
      v_next_surface := NULL;
    END;

    RETURN v_replay_result || jsonb_build_object(
      'ok', COALESCE(
        CASE WHEN jsonb_typeof(v_replay_result->'success') = 'boolean' THEN (v_replay_result->>'success')::boolean ELSE NULL END,
        true
      ),
      'success', COALESCE(
        CASE WHEN jsonb_typeof(v_replay_result->'success') = 'boolean' THEN (v_replay_result->>'success')::boolean ELSE NULL END,
        true
      ),
      'committed', true,
      'session_seq', v_session_seq,
      'verdict_state', v_verdict_state,
      'partner_verdict_recorded', v_partner_has_feedback,
      'awaiting_partner_verdict', NOT v_partner_has_feedback,
      'mutual', v_actor_liked AND v_partner_liked,
      'next_surface', v_next_surface,
      'idempotent', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  v_result := public.submit_post_date_verdict_v2(
    p_session_id,
    p_liked,
    v_key,
    p_safety_report
  );
  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
    true
  );

  v_actor_result := COALESCE(v_result, '{}'::jsonb) - 'block' || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'backend_version', 'v3',
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash'
  );

  IF v_success THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_target := CASE
      WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
      WHEN v_actor = v_session.participant_2_id THEN v_session.participant_1_id
      ELSE NULL
    END;

    SELECT
      COALESCE(bool_or(df.user_id = v_actor), false),
      COALESCE(bool_or(df.user_id = v_target), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_actor), false),
      COALESCE(bool_or(df.liked) FILTER (WHERE df.user_id = v_target), false)
    INTO
      v_actor_has_feedback,
      v_partner_has_feedback,
      v_actor_liked,
      v_partner_liked
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id IN (v_actor, v_target);

    IF COALESCE((v_result->>'idempotent')::boolean, false) IS FALSE THEN
      IF COALESCE((v_result->>'awaiting_partner_verdict')::boolean, false) IS FALSE THEN
        v_visibility := 'participants';
        v_kind := 'post_date_verdict_resolved';
      END IF;

      v_event_payload := jsonb_build_object(
        'action', 'submit_verdict',
        'verdict_recorded', COALESCE((v_result->>'verdict_recorded')::boolean, true),
        'awaiting_partner_verdict', COALESCE((v_result->>'awaiting_partner_verdict')::boolean, false),
        'partner_verdict_recorded', COALESCE((v_result->>'partner_verdict_recorded')::boolean, false),
        'mutual', COALESCE((v_result->>'mutual')::boolean, false),
        'persistent_match_created', CASE
          WHEN v_result ? 'persistent_match_created' THEN v_result->'persistent_match_created'
          ELSE 'null'::jsonb
        END,
        'match_id', v_result->>'match_id'
      );

      v_event := public.append_video_session_event_v2(
        p_session_id,
        v_kind,
        v_visibility,
        v_actor,
        v_event_payload,
        v_event_payload,
        v_visibility = 'participants',
        gen_random_uuid()
      );

      IF p_safety_report IS NOT NULL AND COALESCE((v_result->>'safety_report_recorded')::boolean, false) THEN
        PERFORM public.append_video_session_event_v2(
          p_session_id,
          'post_date_safety_report_recorded',
          'safety_review',
          v_actor,
          jsonb_build_object(
            'action', 'submit_safety_report',
            'report_id', v_result->>'report_id',
            'reported_participant_role', CASE
              WHEN v_actor = v_session.participant_1_id THEN 'participant_2'
              WHEN v_actor = v_session.participant_2_id THEN 'participant_1'
              ELSE NULL
            END
          ),
          jsonb_build_object(
            'action', 'submit_safety_report',
            'report_id', v_result->>'report_id'
          ),
          false,
          gen_random_uuid()
        );
      END IF;
    END IF;

    v_session_seq := COALESCE((v_event->>'sessionSeq')::bigint, v_session.session_seq);
    v_verdict_state := CASE
      WHEN COALESCE((v_result->>'safety_report_recorded')::boolean, false) THEN 'safety_reported'
      WHEN NOT v_partner_has_feedback THEN 'awaiting_partner'
      WHEN v_actor_liked AND v_partner_liked THEN 'resolved_mutual'
      ELSE 'resolved_not_mutual'
    END;

    BEGIN
      v_next_surface := public.resolve_post_date_next_surface(p_session_id);
    EXCEPTION WHEN OTHERS THEN
      v_next_surface := NULL;
    END;

    v_actor_result := v_actor_result || jsonb_build_object(
      'committed', true,
      'session_seq', v_session_seq,
      'verdict_state', v_verdict_state,
      'partner_verdict_recorded', v_partner_has_feedback,
      'awaiting_partner_verdict', NOT v_partner_has_feedback,
      'mutual', v_actor_liked AND v_partner_liked,
      'next_surface', v_next_surface
    );
  END IF;

  PERFORM public.video_session_command_finish_v2(
    v_command_id,
    v_actor,
    CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    v_actor_result
  );
  RETURN v_actor_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_post_date_verdict_v3(uuid, boolean, text, jsonb, text) IS
  'Post-date verdict wrapper with v4 command idempotency and v2 confirmation fields: committed, session_seq, verdict_state, and best-effort next_surface.';
