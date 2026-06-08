-- Video Date Golden Flow invariants.
--
-- Read-only operator query for pre-run, during-run, and post-run certification.
-- Output is intentionally redacted: samples include session/event ids, route
-- state, room names, and role labels, but not participant user ids or tokens.

WITH invariant_results AS (
  SELECT
    'both_ready_requires_both_ready_stamps'::text AS invariant_id,
    'critical'::text AS severity,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END AS status,
    count(*)::integer AS row_count,
    COALESCE(
      jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10),
      '[]'::jsonb
    ) AS sample,
    'A both_ready Ready Gate session must have both participant ready timestamps.'::text AS detail
  FROM (
    SELECT
      row_number() OVER (ORDER BY vs.started_at DESC, vs.id) AS rn,
      jsonb_build_object(
        'session_id', vs.id,
        'event_id', vs.event_id,
        'ready_gate_status', vs.ready_gate_status,
        'state', vs.state::text,
        'phase', vs.phase,
        'missing_ready_participant_1', vs.ready_participant_1_at IS NULL,
        'missing_ready_participant_2', vs.ready_participant_2_at IS NULL
      ) AS sample
    FROM public.video_sessions vs
    WHERE vs.ready_gate_status = 'both_ready'
      AND vs.ended_at IS NULL
      AND (
        vs.ready_participant_1_at IS NULL
        OR vs.ready_participant_2_at IS NULL
      )
  ) failures

  UNION ALL

  SELECT
    'both_ready_requires_canonical_daily_room'::text,
    'critical'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'At both_ready, server truth must expose the canonical Daily room name and URL; provider creation remains fail-soft.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY vs.started_at DESC, vs.id) AS rn,
      jsonb_build_object(
        'session_id', vs.id,
        'event_id', vs.event_id,
        'ready_gate_status', vs.ready_gate_status,
        'state', vs.state::text,
        'phase', vs.phase,
        'daily_room_name', vs.daily_room_name,
        'daily_room_url_present', vs.daily_room_url IS NOT NULL
      ) AS sample
    FROM public.video_sessions vs
    WHERE vs.ready_gate_status = 'both_ready'
      AND vs.ended_at IS NULL
      AND (
        NULLIF(btrim(COALESCE(vs.daily_room_name, '')), '') IS NULL
        OR NULLIF(btrim(COALESCE(vs.daily_room_url, '')), '') IS NULL
      )
  ) failures

  UNION ALL

  SELECT
    'active_date_requires_confirmed_encounter_evidence'::text,
    'critical'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'A live date state must have joined and remote-seen evidence for both roles.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY vs.started_at DESC, vs.id) AS rn,
      jsonb_build_object(
        'session_id', vs.id,
        'event_id', vs.event_id,
        'state', vs.state::text,
        'phase', vs.phase,
        'date_started_at_present', vs.date_started_at IS NOT NULL,
        'missing_joined_participant_1', vs.participant_1_joined_at IS NULL,
        'missing_joined_participant_2', vs.participant_2_joined_at IS NULL,
        'missing_remote_seen_participant_1', vs.participant_1_remote_seen_at IS NULL,
        'missing_remote_seen_participant_2', vs.participant_2_remote_seen_at IS NULL
      ) AS sample
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND (
        vs.state::text = 'date'
        OR vs.phase = 'date'
        OR vs.date_started_at IS NOT NULL
      )
      AND (
        vs.participant_1_joined_at IS NULL
        OR vs.participant_2_joined_at IS NULL
        OR vs.participant_1_remote_seen_at IS NULL
        OR vs.participant_2_remote_seen_at IS NULL
      )
  ) failures

  UNION ALL

  SELECT
    'date_route_must_own_after_handshake_or_date'::text,
    'critical'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'A registration must not remain in_ready_gate once the session has entered handshake/date ownership.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY vs.started_at DESC, vs.id, er.id) AS rn,
      jsonb_build_object(
        'registration_id', er.id,
        'session_id', vs.id,
        'event_id', vs.event_id,
        'queue_status', er.queue_status,
        'ready_gate_status', vs.ready_gate_status,
        'state', vs.state::text,
        'phase', vs.phase,
        'handshake_started_at_present', vs.handshake_started_at IS NOT NULL,
        'date_started_at_present', vs.date_started_at IS NOT NULL
      ) AS sample
    FROM public.event_registrations er
    JOIN public.video_sessions vs
      ON vs.id = er.current_room_id
    WHERE er.queue_status = 'in_ready_gate'
      AND vs.ended_at IS NULL
      AND (
        vs.handshake_started_at IS NOT NULL
        OR vs.date_started_at IS NOT NULL
        OR vs.state::text IN ('handshake', 'date')
        OR vs.phase IN ('handshake', 'date')
      )
  ) failures

  UNION ALL

  SELECT
    'active_video_registration_points_to_live_session'::text,
    'critical'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'in_handshake/in_date registrations must point at a non-ended video_sessions row.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY er.updated_at DESC NULLS LAST, er.id) AS rn,
      jsonb_build_object(
        'registration_id', er.id,
        'event_id', er.event_id,
        'session_id', er.current_room_id,
        'queue_status', er.queue_status,
        'session_found', vs.id IS NOT NULL,
        'session_ended', vs.ended_at IS NOT NULL,
        'session_state', vs.state::text,
        'session_phase', vs.phase
      ) AS sample
    FROM public.event_registrations er
    LEFT JOIN public.video_sessions vs
      ON vs.id = er.current_room_id
    WHERE er.queue_status IN ('in_handshake', 'in_date')
      AND (
        er.current_room_id IS NULL
        OR vs.id IS NULL
        OR vs.ended_at IS NOT NULL
      )
  ) failures

  UNION ALL

  SELECT
    'survey_required_unfinished_feedback_must_remain_in_survey'::text,
    'critical'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'A terminal survey-eligible participant without date_feedback must remain owned by in_survey truth.'::text
  FROM (
    WITH survey_roles AS (
      SELECT
        vs.id AS session_id,
        vs.event_id,
        vs.started_at,
        er.id AS registration_id,
        'participant_1'::text AS role,
        vs.participant_1_id AS user_id,
        er.queue_status
      FROM public.video_sessions vs
      LEFT JOIN public.event_registrations er
        ON er.event_id = vs.event_id
       AND er.profile_id = vs.participant_1_id
      WHERE public.video_date_session_has_confirmed_encounter(
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )

      UNION ALL

      SELECT
        vs.id,
        vs.event_id,
        vs.started_at,
        er.id,
        'participant_2'::text,
        vs.participant_2_id,
        er.queue_status
      FROM public.video_sessions vs
      LEFT JOIN public.event_registrations er
        ON er.event_id = vs.event_id
       AND er.profile_id = vs.participant_2_id
      WHERE public.video_date_session_has_confirmed_encounter(
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
    )
    SELECT
      row_number() OVER (ORDER BY sr.started_at DESC, sr.session_id, sr.role) AS rn,
      jsonb_build_object(
        'registration_id', sr.registration_id,
        'session_id', sr.session_id,
        'event_id', sr.event_id,
        'queue_status', COALESCE(sr.queue_status, 'missing'),
        'missing_feedback_role', sr.role
      ) AS sample
    FROM survey_roles sr
    LEFT JOIN public.date_feedback df
      ON df.session_id = sr.session_id
     AND df.user_id = sr.user_id
    WHERE df.id IS NULL
      AND COALESCE(sr.queue_status, 'missing') <> 'in_survey'
  ) failures

  UNION ALL

  SELECT
    'survey_pending_feedback_held_in_survey'::text,
    'warning'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'warn' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'Participants still held in_survey without date_feedback are pending operator/runtime evidence, not a release invariant failure.'::text
  FROM (
    WITH survey_roles AS (
      SELECT
        vs.id AS session_id,
        vs.event_id,
        vs.started_at,
        er.id AS registration_id,
        'participant_1'::text AS role,
        vs.participant_1_id AS user_id,
        er.queue_status
      FROM public.video_sessions vs
      JOIN public.event_registrations er
        ON er.current_room_id = vs.id
       AND er.profile_id = vs.participant_1_id
      WHERE er.queue_status = 'in_survey'
        AND (
          vs.ended_at IS NOT NULL
          OR vs.date_started_at IS NOT NULL
          OR (
            vs.participant_1_remote_seen_at IS NOT NULL
            AND vs.participant_2_remote_seen_at IS NOT NULL
          )
        )

      UNION ALL

      SELECT
        vs.id,
        vs.event_id,
        vs.started_at,
        er.id,
        'participant_2'::text,
        vs.participant_2_id,
        er.queue_status
      FROM public.video_sessions vs
      JOIN public.event_registrations er
        ON er.current_room_id = vs.id
       AND er.profile_id = vs.participant_2_id
      WHERE er.queue_status = 'in_survey'
        AND (
          vs.ended_at IS NOT NULL
          OR vs.date_started_at IS NOT NULL
          OR (
            vs.participant_1_remote_seen_at IS NOT NULL
            AND vs.participant_2_remote_seen_at IS NOT NULL
          )
        )
    )
    SELECT
      row_number() OVER (ORDER BY sr.started_at DESC, sr.session_id, sr.role) AS rn,
      jsonb_build_object(
        'registration_id', sr.registration_id,
        'session_id', sr.session_id,
        'event_id', sr.event_id,
        'queue_status', sr.queue_status,
        'missing_feedback_role', sr.role
      ) AS sample
    FROM survey_roles sr
    LEFT JOIN public.date_feedback df
      ON df.session_id = sr.session_id
     AND df.user_id = sr.user_id
    WHERE df.id IS NULL
  ) failures

  UNION ALL

  SELECT
    'stale_survey_pending_feedback_blocks_certification'::text,
    'warning'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'warn' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'Survey-required participants still missing date_feedback more than 15 minutes after a survey-eligible end must block certification via --warn-as-error unless a service-owned certification-only exception exists. Exceptions do not complete the survey or persist date_feedback.'::text
  FROM (
    WITH survey_roles AS (
      SELECT
        vs.id AS session_id,
        vs.event_id,
        vs.ended_at,
        er.id AS registration_id,
        'participant_1'::text AS role,
        vs.participant_1_id AS user_id,
        er.queue_status
      FROM public.video_sessions vs
      JOIN public.event_registrations er
        ON er.event_id = vs.event_id
       AND er.profile_id = vs.participant_1_id
      WHERE er.queue_status = 'in_survey'
        AND vs.ended_at IS NOT NULL
        AND vs.ended_at <= now() - interval '15 minutes'
        AND public.video_date_session_is_post_date_survey_eligible_v2(
          vs.ended_at,
          vs.ended_reason,
          vs.date_started_at,
          vs.state::text,
          vs.phase,
          vs.participant_1_joined_at,
          vs.participant_2_joined_at,
          vs.participant_1_remote_seen_at,
          vs.participant_2_remote_seen_at
        )

      UNION ALL

      SELECT
        vs.id,
        vs.event_id,
        vs.ended_at,
        er.id,
        'participant_2'::text,
        vs.participant_2_id,
        er.queue_status
      FROM public.video_sessions vs
      JOIN public.event_registrations er
        ON er.event_id = vs.event_id
       AND er.profile_id = vs.participant_2_id
      WHERE er.queue_status = 'in_survey'
        AND vs.ended_at IS NOT NULL
        AND vs.ended_at <= now() - interval '15 minutes'
        AND public.video_date_session_is_post_date_survey_eligible_v2(
          vs.ended_at,
          vs.ended_reason,
          vs.date_started_at,
          vs.state::text,
          vs.phase,
          vs.participant_1_joined_at,
          vs.participant_2_joined_at,
          vs.participant_1_remote_seen_at,
          vs.participant_2_remote_seen_at
        )
    )
    SELECT
      row_number() OVER (ORDER BY sr.ended_at DESC, sr.session_id, sr.role) AS rn,
      jsonb_build_object(
        'registration_id', sr.registration_id,
        'session_id', sr.session_id,
        'event_id', sr.event_id,
        'queue_status', sr.queue_status,
        'missing_feedback_role', sr.role,
        'ended_at', sr.ended_at,
        'age_seconds', GREATEST(0, floor(extract(epoch FROM (now() - sr.ended_at))))::integer
      ) AS sample
    FROM survey_roles sr
    LEFT JOIN public.date_feedback df
      ON df.session_id = sr.session_id
     AND df.user_id = sr.user_id
    WHERE df.id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_date_certification_feedback_exceptions ex
        WHERE ex.session_id = sr.session_id
          AND ex.missing_user_id = sr.user_id
          AND ex.revoked_at IS NULL
          AND (ex.expires_at IS NULL OR ex.expires_at > now())
      )
  ) failures

  UNION ALL

  SELECT
    'provider_join_webhook_evidence_present_for_recent_joined_sessions'::text,
    'warning'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'warn' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'Recent sessions with both client joined stamps should also have provider participant.joined webhook evidence.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY vs.started_at DESC, vs.id) AS rn,
      jsonb_build_object(
        'session_id', vs.id,
        'event_id', vs.event_id,
        'daily_room_name', vs.daily_room_name,
        'state', vs.state::text,
        'phase', vs.phase,
        'provider_join_event_count', count(vde.id)
      ) AS sample
    FROM public.video_sessions vs
    LEFT JOIN public.video_date_daily_webhook_events vde
      ON vde.session_id = vs.id
     AND vde.event_type = 'participant.joined'
    WHERE vs.started_at >= now() - interval '30 days'
      AND vs.participant_1_joined_at IS NOT NULL
      AND vs.participant_2_joined_at IS NOT NULL
    GROUP BY vs.id
    HAVING count(vde.id) < 2
  ) failures

  UNION ALL

  SELECT
    'video_date_surface_claims_are_bounded_per_session'::text,
    'warning'::text,
    CASE WHEN count(*) = 0 THEN 'pass' ELSE 'warn' END,
    count(*)::integer,
    COALESCE(jsonb_agg(sample ORDER BY rn) FILTER (WHERE rn <= 10), '[]'::jsonb),
    'A session should not accumulate more than two live video_date surface claims.'::text
  FROM (
    SELECT
      row_number() OVER (ORDER BY max(vsc.updated_at) DESC, vsc.session_id) AS rn,
      jsonb_build_object(
        'session_id', vsc.session_id,
        'active_claim_count', count(*),
        'latest_claim_updated_at', max(vsc.updated_at)
      ) AS sample
    FROM public.video_date_surface_claims vsc
    WHERE vsc.surface = 'video_date'
      AND vsc.released_at IS NULL
      AND vsc.expires_at > now()
    GROUP BY vsc.session_id
    HAVING count(*) > 2
  ) failures
)
SELECT
  invariant_id,
  severity,
  status,
  row_count,
  sample,
  detail
FROM invariant_results
ORDER BY
  CASE severity
    WHEN 'critical' THEN 0
    WHEN 'warning' THEN 1
    ELSE 2
  END,
  invariant_id;
