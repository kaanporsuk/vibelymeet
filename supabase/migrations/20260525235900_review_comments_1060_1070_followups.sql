-- Follow-ups for Copilot/Codex review comments across PRs 1060-1070.
--
-- Applied after the original Sprint 5/Sprint 7 migrations because those
-- versions are already present in the linked Supabase project.

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v2(
  p_session_id uuid,
  p_liked boolean,
  p_idempotency_key text,
  p_safety_report jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_submission record;
  v_session record;
  v_target uuid;
  v_report_reason text;
  v_report_details text;
  v_also_block boolean := false;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
  v_result jsonb;
  v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
  END IF;

  INSERT INTO public.post_date_client_submissions (
    actor_id, session_id, action, idempotency_key, liked, report_payload
  )
  VALUES (v_uid, p_session_id, 'verdict', v_key, v_effective_liked, p_safety_report)
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING;

  SELECT * INTO v_submission
  FROM public.post_date_client_submissions
  WHERE actor_id = v_uid
    AND idempotency_key = v_key
  FOR UPDATE;

  IF v_submission.result IS NOT NULL THEN
    RETURN v_submission.result || jsonb_build_object('idempotent', true);
  END IF;
  IF v_submission.session_id IS DISTINCT FROM p_session_id
     OR v_submission.action IS DISTINCT FROM 'verdict' THEN
    RETURN jsonb_build_object('success', false, 'error', 'idempotency_key_conflict');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  IF v_uid NOT IN (v_session.participant_1_id, v_session.participant_2_id) THEN
    v_result := jsonb_build_object('success', false, 'error', 'not_participant');
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  v_target := CASE WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id ELSE v_session.participant_1_id END;

  IF p_safety_report IS NOT NULL THEN
    IF jsonb_typeof(p_safety_report) IS DISTINCT FROM 'object' THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_report_payload');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;

    v_report_reason := lower(btrim(COALESCE(p_safety_report->>'reason', '')));
    IF v_report_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;

    v_report_details := NULLIF(left(btrim(COALESCE(p_safety_report->>'details', '')), 4000), '');
    v_also_block := lower(COALESCE(p_safety_report->>'alsoBlock', 'false')) = 'true';

    SELECT count(*)::int INTO v_recent
    FROM public.user_reports
    WHERE reporter_id = v_uid
      AND created_at > now() - interval '1 hour';

    IF v_recent >= 20 THEN
      v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
      UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
      RETURN v_result;
    END IF;
  END IF;

  v_result := public.submit_post_date_verdict(p_session_id, v_effective_liked);

  IF COALESCE((v_result->>'success')::boolean, true) IS FALSE THEN
    UPDATE public.post_date_client_submissions SET result = v_result, updated_at = now() WHERE id = v_submission.id;
    RETURN v_result;
  END IF;

  IF p_safety_report IS NOT NULL THEN
    INSERT INTO public.user_reports (
      reporter_id,
      reported_id,
      reason,
      details,
      also_blocked
    )
    VALUES (
      v_uid,
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
        v_uid,
        jsonb_build_object(
          'action', 'submit_safety_report',
          'report_id', v_result->>'report_id',
          'reported_participant_role', CASE
            WHEN v_uid = v_session.participant_1_id THEN 'participant_2'
            WHEN v_uid = v_session.participant_2_id THEN 'participant_1'
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

  RETURN v_result || jsonb_build_object(
    'idempotent', COALESCE((v_result->>'idempotent')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_v2(uuid, boolean, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health(
  p_event_id uuid DEFAULT NULL
)
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
          AND sw.phase IN ('handshake', 'warmup')
          AND COALESCE(sw.state_updated_at, sw.started_at) < now() - interval '2 minutes'
      )::integer AS stuck_handshake_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.phase = 'date'
          AND sw.date_started_at IS NOT NULL
          AND sw.date_started_at
              + ((COALESCE(sw.duration_seconds, 300)
                  + COALESCE(sw.date_extra_seconds, 0)
                  + 60) * interval '1 second') < now()
      )::integer AS overdue_date_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.ready_gate_status = 'queued'
          AND COALESCE(sw.queued_expires_at, sw.started_at + interval '10 minutes') > now()
          AND COALESCE(sw.state_updated_at, sw.started_at) < now() - interval '2 minutes'
      )::integer AS silently_queued_count,
      COALESCE(sum(
        CASE
          WHEN sw.date_started_at IS NOT NULL
           AND sw.ended_at IS NOT NULL
           AND sw.ended_at >= now() - sw.window_interval
           AND public.video_date_session_is_post_date_survey_eligible(
             sw.ended_at,
             sw.ended_reason,
             sw.date_started_at,
             sw.state::text,
             sw.phase,
             sw.participant_1_joined_at,
             sw.participant_2_joined_at
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
      COALESCE(e.client_stuck_observed_count, 0)::integer AS client_stuck_observed_count,
      COALESCE(e.queue_drain_miss_count, 0)::integer AS queue_drain_miss_count
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
        )::integer AS client_stuck_observed_count,
        count(*) FILTER (
          WHERE (
            eo.operation IN ('drain_match_queue_v2', 'drain_match_queue')
            OR eo.detail->>'source_action' IN ('survey_queue_drain', 'notification_queued_session_rescue')
          )
          AND eo.reason_code IN ('no_queued_session', 'session_not_promotable', 'queued_session_not_promotable')
        )::integer AS queue_drain_miss_count
      FROM public.event_loop_observability_events eo
      WHERE eo.created_at >= now() - w.window_interval
        AND eo.operation IN (
          'video_date_launch_latency_checkpoint',
          'video_date_client_stuck_state',
          'drain_match_queue_v2',
          'drain_match_queue'
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
  ),
  queue_rollup AS (
    SELECT
      w.window_id,
      COALESCE(q.queue_drain_no_match_count, 0)::integer AS queue_drain_no_match_count,
      COALESCE(q.queue_drain_failure_count, 0)::integer AS queue_drain_failure_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (
          WHERE eo.reason_code IN ('no_queued_session', 'session_not_promotable', 'queued_session_not_promotable')
        )::integer AS queue_drain_no_match_count,
        count(*) FILTER (
          WHERE eo.outcome NOT IN ('success', 'no_op', 'blocked')
        )::integer AS queue_drain_failure_count
      FROM public.event_loop_observability_events eo
      WHERE eo.created_at >= now() - w.window_interval
        AND eo.operation IN ('drain_match_queue', 'drain_match_queue_v2')
        AND (p_event_id IS NULL OR eo.event_id = p_event_id)
    ) q ON true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'window_id', w.window_id,
      'window_label', w.window_label,
      'event_id', p_event_id,
      'status', CASE
        WHEN COALESCE(sr.stuck_ready_gate_count, 0)
           + COALESCE(sr.stuck_handshake_count, 0)
           + COALESCE(sr.overdue_date_count, 0)
           + COALESCE(sr.silently_queued_count, 0)
           + COALESCE(wh.unresolved_webhook_dlq_count, 0)
           + COALESCE(orh.orphan_room_cleanup_failed_count, 0) > 0 THEN 'critical'
        WHEN COALESCE(sr.pending_survey_recovery_count, 0)
           + COALESCE(er.prepare_entry_failure_count, 0)
           + COALESCE(er.daily_join_failure_count, 0)
           + COALESCE(qr.queue_drain_failure_count, 0)
           + COALESCE(er.client_stuck_observed_count, 0)
           + COALESCE(sa.pending_report_count, 0) > 0 THEN 'warning'
        ELSE 'healthy'
      END,
      'stuck_ready_gate_count', COALESCE(sr.stuck_ready_gate_count, 0),
      'stuck_handshake_count', COALESCE(sr.stuck_handshake_count, 0),
      'overdue_date_count', COALESCE(sr.overdue_date_count, 0),
      'silently_queued_count', COALESCE(sr.silently_queued_count, 0),
      'pending_survey_recovery_count', COALESCE(sr.pending_survey_recovery_count, 0),
      'prepare_entry_failure_count', COALESCE(er.prepare_entry_failure_count, 0),
      'daily_join_failure_count', COALESCE(er.daily_join_failure_count, 0),
      'client_stuck_observed_count', COALESCE(er.client_stuck_observed_count, 0),
      'queue_drain_miss_count', GREATEST(
        COALESCE(er.queue_drain_miss_count, 0),
        COALESCE(qr.queue_drain_no_match_count, 0)
      ),
      'queue_drain_failure_count', COALESCE(qr.queue_drain_failure_count, 0),
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
  LEFT JOIN orphan_rollup orh ON orh.window_id = w.window_id
  LEFT JOIN queue_rollup qr ON qr.window_id = w.window_id;

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

REVOKE ALL ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_sprint7_ops_health(uuid) IS
  'Service-role-only Sprint 7 Video Date safety/privacy/ops dashboard payload. Queue drain blocked outcomes are treated as normal safety interlocks, not failures.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260525235900',
  'Review comments 1060-1070 follow-ups',
  'schema+policy',
  'Forward follow-up for merged PR review comments: emits safety-review events for idempotent post-date report retries and excludes blocked queue-drain safety outcomes from failure rollups.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
