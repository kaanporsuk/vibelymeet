-- Remove legacy post-date verdict RPC compatibility.
--
-- submit_post_date_verdict_v3 now owns the full verdict persistence path:
-- command idempotency, client submission idempotency, date_feedback writes,
-- pending-verdict bookkeeping, safety report handling, session events, and
-- next-surface enrichment. The old public v1/v2/base routines are dropped
-- after v3 no longer delegates to them.

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
  v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END;
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
  v_pair_blocked_or_reported boolean := false;
  v_confirmed_mutual boolean := false;
  v_submission record;
  v_report_reason text;
  v_report_details text;
  v_also_block boolean := false;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
  v_inner jsonb;
  v_persistent_created boolean;
  v_existing_liked boolean;
  v_already_submitted boolean := false;
  v_partner_verdict_recorded boolean := false;
  v_pair_reported boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'not_authenticated');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'ok', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_request := jsonb_build_object(
    'action', 'submit_verdict',
    'liked', v_effective_liked,
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

    SELECT
      COALESCE(public.is_blocked(v_actor, v_target), false)
      OR EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_target)
           OR (ur.reporter_id = v_target AND ur.reported_id = v_actor)
      )
    INTO v_pair_blocked_or_reported;
    v_confirmed_mutual := v_actor_liked AND v_partner_liked AND NOT COALESCE(v_pair_blocked_or_reported, false);

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
      WHEN v_pair_blocked_or_reported THEN 'safety_reported'
      WHEN NOT v_partner_has_feedback THEN 'awaiting_partner'
      WHEN v_confirmed_mutual THEN 'resolved_mutual'
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
      'awaiting_partner_verdict', v_verdict_state = 'awaiting_partner',
      'mutual', v_confirmed_mutual,
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

  INSERT INTO public.post_date_client_submissions (
    actor_id, session_id, action, idempotency_key, liked, report_payload
  )
  VALUES (v_actor, p_session_id, 'verdict', v_key, v_effective_liked, p_safety_report)
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING;

  SELECT *
  INTO v_submission
  FROM public.post_date_client_submissions
  WHERE actor_id = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', false, 'error', 'idempotency_key_missing');
  ELSIF v_submission.result IS NOT NULL THEN
    v_result := v_submission.result || jsonb_build_object('idempotent', true);
  ELSIF v_submission.session_id IS DISTINCT FROM p_session_id
     OR v_submission.action IS DISTINCT FROM 'verdict' THEN
    v_result := jsonb_build_object('success', false, 'error', 'idempotency_key_conflict');
  ELSE
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
      UPDATE public.post_date_client_submissions
      SET result = v_result, updated_at = now()
      WHERE id = v_submission.id;
    ELSIF v_actor NOT IN (v_session.participant_1_id, v_session.participant_2_id) THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_participant');
      UPDATE public.post_date_client_submissions
      SET result = v_result, updated_at = now()
      WHERE id = v_submission.id;
    ELSE
      v_target := CASE
        WHEN v_session.participant_1_id = v_actor THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END;

      IF p_safety_report IS NOT NULL AND jsonb_typeof(p_safety_report) IS DISTINCT FROM 'object' THEN
        v_result := jsonb_build_object('success', false, 'error', 'invalid_report_payload');
        UPDATE public.post_date_client_submissions
        SET result = v_result, updated_at = now()
        WHERE id = v_submission.id;
      ELSIF p_safety_report IS NOT NULL THEN
        v_report_reason := lower(btrim(COALESCE(p_safety_report->>'reason', '')));
        IF v_report_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
          v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
          UPDATE public.post_date_client_submissions
          SET result = v_result, updated_at = now()
          WHERE id = v_submission.id;
        ELSE
          v_report_details := NULLIF(left(btrim(COALESCE(p_safety_report->>'details', '')), 4000), '');
          v_also_block := lower(COALESCE(p_safety_report->>'alsoBlock', 'false')) = 'true';

          SELECT count(*)::int INTO v_recent
          FROM public.user_reports
          WHERE reporter_id = v_actor
            AND created_at > now() - interval '1 hour';

          IF v_recent >= 20 THEN
            v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
            UPDATE public.post_date_client_submissions
            SET result = v_result, updated_at = now()
            WHERE id = v_submission.id;
          END IF;
        END IF;
      END IF;

      IF v_result IS NULL THEN
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
          v_result := jsonb_build_object(
            'success', false,
            'error', 'session_not_survey_eligible',
            'code', 'session_not_survey_eligible',
            'verdict_recorded', false
          );
          UPDATE public.post_date_client_submissions
          SET result = v_result, updated_at = now()
          WHERE id = v_submission.id;
        ELSIF COALESCE(v_session.ended_reason, '') IN ('blocked_pair', 'blocked_or_reported_pair')
           OR public.is_blocked(v_actor, v_target) THEN
          UPDATE public.post_date_pending_verdicts
          SET
            completed_at = COALESCE(completed_at, now()),
            status = 'completed',
            updated_at = now()
          WHERE session_id = p_session_id
            AND completed_at IS NULL;

          v_result := jsonb_build_object(
            'success', false,
            'error', 'blocked_pair',
            'code', 'blocked_pair',
            'blocked', true
          );
          UPDATE public.post_date_client_submissions
          SET result = v_result, updated_at = now()
          WHERE id = v_submission.id;
        ELSE
          SELECT EXISTS (
            SELECT 1
            FROM public.user_reports ur
            WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_target)
               OR (ur.reporter_id = v_target AND ur.reported_id = v_actor)
          ) INTO v_pair_reported;

          IF v_pair_reported THEN
            v_effective_liked := false;
          END IF;

          SELECT df.liked INTO v_existing_liked
          FROM public.date_feedback df
          WHERE df.session_id = p_session_id
            AND df.user_id = v_actor;

          v_already_submitted := FOUND;

          IF NOT v_already_submitted THEN
            INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
            VALUES (p_session_id, v_actor, v_target, v_effective_liked);
          END IF;

          SELECT EXISTS (
            SELECT 1
            FROM public.date_feedback df
            WHERE df.session_id = p_session_id
              AND df.user_id = v_target
          ) INTO v_partner_verdict_recorded;

          v_inner := public.check_mutual_vibe_and_match(p_session_id);
          v_pair_reported := v_pair_reported OR COALESCE((v_inner->>'reported_pair')::boolean, false);

          IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
            v_result := v_inner || jsonb_build_object(
              'verdict_recorded', true,
              'already_submitted', v_already_submitted,
              'idempotent', v_already_submitted,
              'liked', COALESCE(v_existing_liked, v_effective_liked),
              'partner_verdict_recorded', v_partner_verdict_recorded,
              'awaiting_partner_verdict', NOT v_partner_verdict_recorded
            );
          ELSIF v_pair_reported THEN
            UPDATE public.post_date_pending_verdicts
            SET
              completed_at = COALESCE(completed_at, now()),
              status = 'completed',
              updated_at = now()
            WHERE session_id = p_session_id
              AND completed_at IS NULL;

            v_result := v_inner
              || jsonb_build_object(
                'verdict_recorded', true,
                'already_submitted', v_already_submitted,
                'idempotent', v_already_submitted,
                'liked', COALESCE(v_existing_liked, v_effective_liked),
                'safety_reported', true,
                'partner_verdict_recorded', v_partner_verdict_recorded,
                'awaiting_partner_verdict', false,
                'persistent_match_created', false
              );
          ELSE
            v_persistent_created := NULL;
            IF COALESCE((v_inner->>'mutual')::boolean, false) THEN
              IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
                v_persistent_created := false;
              ELSE
                v_persistent_created := true;
              END IF;
            END IF;

            IF NOT v_partner_verdict_recorded THEN
              INSERT INTO public.post_date_pending_verdicts (
                session_id,
                event_id,
                submitted_by,
                missing_user_id,
                first_detected_at,
                last_seen_at,
                reminder_eligible_at,
                created_at,
                updated_at,
                status
              )
              VALUES (
                p_session_id,
                v_session.event_id,
                v_actor,
                v_target,
                now(),
                now(),
                now() + interval '5 minutes',
                now(),
                now(),
                'pending'
              )
              ON CONFLICT (session_id) DO UPDATE SET
                event_id = EXCLUDED.event_id,
                submitted_by = EXCLUDED.submitted_by,
                missing_user_id = EXCLUDED.missing_user_id,
                last_seen_at = now(),
                reminder_eligible_at = CASE
                  WHEN public.post_date_pending_verdicts.reminder_sent_at IS NULL
                    THEN LEAST(public.post_date_pending_verdicts.reminder_eligible_at, EXCLUDED.reminder_eligible_at)
                  ELSE public.post_date_pending_verdicts.reminder_eligible_at
                END,
                completed_at = NULL,
                status = CASE
                  WHEN public.post_date_pending_verdicts.stale_at IS NOT NULL THEN 'stale'
                  WHEN public.post_date_pending_verdicts.reminder_sent_at IS NOT NULL THEN 'reminded'
                  ELSE 'pending'
                END,
                updated_at = now();

              IF NOT v_already_submitted THEN
                PERFORM public.record_event_loop_observability(
                  'post_date_half_verdict_saved',
                  'success',
                  'partner_verdict_missing',
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object('target_id', v_target)
                );
                PERFORM public.record_event_loop_observability(
                  'post_date_half_verdict_pending',
                  'success',
                  'partner_verdict_missing',
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object('target_id', v_target)
                );
              END IF;
            ELSE
              UPDATE public.post_date_pending_verdicts
              SET
                completed_at = COALESCE(completed_at, now()),
                status = 'completed',
                updated_at = now()
              WHERE session_id = p_session_id
                AND completed_at IS NULL;

              IF NOT v_already_submitted THEN
                PERFORM public.record_event_loop_observability(
                  'post_date_pending_verdict_completed',
                  'success',
                  CASE WHEN COALESCE((v_inner->>'mutual')::boolean, false) THEN 'mutual' ELSE 'not_mutual' END,
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'target_id', v_target,
                    'mutual', COALESCE((v_inner->>'mutual')::boolean, false),
                    'persistent_match_created', v_persistent_created
                  )
                );
              END IF;
            END IF;

            v_result := v_inner
              || jsonb_build_object(
                'verdict_recorded', true,
                'already_submitted', v_already_submitted,
                'idempotent', v_already_submitted,
                'liked', COALESCE(v_existing_liked, v_effective_liked),
                'persistent_match_created', CASE WHEN v_already_submitted THEN false ELSE v_persistent_created END,
                'partner_verdict_recorded', v_partner_verdict_recorded,
                'awaiting_partner_verdict', NOT v_partner_verdict_recorded
              );
          END IF;

          IF COALESCE((v_result->>'success')::boolean, true) AND p_safety_report IS NOT NULL THEN
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
              v_report_reason,
              v_report_details,
              v_also_block
            )
            RETURNING id INTO v_report_id;

            IF v_also_block THEN
              v_block_result := public.block_user_with_cleanup(v_target, 'Reported: ' || v_report_reason, NULL);
            END IF;

            UPDATE public.post_date_pending_verdicts
            SET
              completed_at = COALESCE(completed_at, now()),
              status = 'completed',
              updated_at = now()
            WHERE session_id = p_session_id
              AND completed_at IS NULL;

            v_result := v_result || jsonb_build_object(
              'safety_report_recorded', true,
              'report_id', v_report_id,
              'safety_reported', true,
              'awaiting_partner_verdict', false,
              'block', v_block_result
            );

            IF COALESCE((v_result->>'idempotent')::boolean, false) THEN
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

          UPDATE public.post_date_client_submissions
          SET result = v_result, updated_at = now()
          WHERE id = v_submission.id;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_result IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'verdict_not_resolved');
  END IF;

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

    SELECT
      COALESCE(public.is_blocked(v_actor, v_target), false)
      OR EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_target)
           OR (ur.reporter_id = v_target AND ur.reported_id = v_actor)
      )
    INTO v_pair_blocked_or_reported;
    v_confirmed_mutual := v_actor_liked AND v_partner_liked AND NOT COALESCE(v_pair_blocked_or_reported, false);

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
        'mutual', v_confirmed_mutual,
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
      WHEN v_pair_blocked_or_reported THEN 'safety_reported'
      WHEN NOT v_partner_has_feedback THEN 'awaiting_partner'
      WHEN v_confirmed_mutual THEN 'resolved_mutual'
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
      'awaiting_partner_verdict', v_verdict_state = 'awaiting_partner',
      'mutual', v_confirmed_mutual,
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
  'Canonical v3-only post-date verdict persistence path. Owns command idempotency, date_feedback writes, safety handling, verdict events, and next_surface; legacy verdict RPC compatibility is removed.';

DROP FUNCTION IF EXISTS public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.submit_post_date_verdict(uuid, boolean);
DROP FUNCTION IF EXISTS public.submit_post_date_verdict_20260603090000_remote_seen_base(uuid, boolean);
