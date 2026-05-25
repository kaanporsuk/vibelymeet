-- Sprint 2: align queue hints and legacy queue drain with the v2 promotion contract.
--
-- The queue count shown to users must not include rows that the server would
-- immediately reject during drain, and clients still using drain_match_queue()
-- should get the same eligibility, locking, idempotency, and recovery semantics
-- as drain_match_queue_v2().

CREATE OR REPLACE FUNCTION public.get_video_date_queue_hint_v1(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active record;
  v_inactive_reason text;
  v_session_id uuid;
  v_started_at timestamptz;
  v_position integer;
  v_event_queued_count integer := 0;
  v_user_queued_count integer := 0;
  v_wait_age_seconds integer := 0;
  v_estimated_wait_seconds integer;
  v_relief_active boolean := false;
BEGIN
  IF v_uid IS NULL OR v_uid <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND er.admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered', 'queued', false);
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'ok', true,
      'queued', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason,
      'event_queued_count', 0,
      'user_queued_count', 0,
      'position', NULL,
      'wait_age_seconds', 0,
      'estimated_wait_seconds', NULL,
      'relief_active', false
    );
  END IF;

  WITH eligible_queue AS (
    SELECT vs.id, vs.started_at, vs.participant_1_id, vs.participant_2_id
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ready_gate_status = 'queued'
      AND vs.ended_at IS NULL
      AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
      AND EXISTS (
        SELECT 1
        FROM public.event_registrations er
        WHERE er.event_id = vs.event_id
          AND er.profile_id = vs.participant_1_id
          AND er.admission_status = 'confirmed'
      )
      AND EXISTS (
        SELECT 1
        FROM public.event_registrations er
        WHERE er.event_id = vs.event_id
          AND er.profile_id = vs.participant_2_id
          AND er.admission_status = 'confirmed'
      )
      AND NOT public.video_date_pair_has_terminal_encounter(
        vs.event_id,
        vs.participant_1_id,
        vs.participant_2_id,
        vs.id
      )
      AND NOT public.is_blocked(vs.participant_1_id, vs.participant_2_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = vs.participant_1_id AND ur.reported_id = vs.participant_2_id)
           OR (ur.reporter_id = vs.participant_2_id AND ur.reported_id = vs.participant_1_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions z
        WHERE z.event_id = vs.event_id
          AND z.id <> vs.id
          AND (
            z.participant_1_id IN (vs.participant_1_id, vs.participant_2_id)
            OR z.participant_2_id IN (vs.participant_1_id, vs.participant_2_id)
          )
          AND public.event_lobby_video_session_blocks_new_match(
            z.ready_gate_status,
            z.state::text,
            z.phase,
            z.handshake_started_at,
            z.date_started_at,
            z.ended_at
          )
      )
  ),
  user_queue AS (
    SELECT *
    FROM eligible_queue eq
    WHERE eq.participant_1_id = p_user_id OR eq.participant_2_id = p_user_id
  ),
  first_user_session AS (
    SELECT uq.id, uq.started_at
    FROM user_queue uq
    ORDER BY uq.started_at ASC NULLS LAST, uq.id ASC
    LIMIT 1
  ),
  event_count AS (
    SELECT count(DISTINCT eq.id)::integer AS count
    FROM eligible_queue eq
  ),
  user_count AS (
    SELECT count(*)::integer AS count
    FROM user_queue uq
  )
  SELECT fus.id, fus.started_at, ec.count, uc.count
  INTO v_session_id, v_started_at, v_event_queued_count, v_user_queued_count
  FROM event_count ec
  CROSS JOIN user_count uc
  LEFT JOIN first_user_session fus ON true;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'queued', false,
      'event_queued_count', COALESCE(v_event_queued_count, 0),
      'user_queued_count', COALESCE(v_user_queued_count, 0),
      'position', NULL,
      'wait_age_seconds', 0,
      'estimated_wait_seconds', NULL,
      'relief_active', false
    );
  END IF;

  WITH eligible_queue AS (
    SELECT vs.id
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ready_gate_status = 'queued'
      AND vs.ended_at IS NULL
      AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
      AND EXISTS (
        SELECT 1
        FROM public.event_registrations er
        WHERE er.event_id = vs.event_id
          AND er.profile_id = vs.participant_1_id
          AND er.admission_status = 'confirmed'
      )
      AND EXISTS (
        SELECT 1
        FROM public.event_registrations er
        WHERE er.event_id = vs.event_id
          AND er.profile_id = vs.participant_2_id
          AND er.admission_status = 'confirmed'
      )
      AND NOT public.video_date_pair_has_terminal_encounter(
        vs.event_id,
        vs.participant_1_id,
        vs.participant_2_id,
        vs.id
      )
      AND NOT public.is_blocked(vs.participant_1_id, vs.participant_2_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = vs.participant_1_id AND ur.reported_id = vs.participant_2_id)
           OR (ur.reporter_id = vs.participant_2_id AND ur.reported_id = vs.participant_1_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions z
        WHERE z.event_id = vs.event_id
          AND z.id <> vs.id
          AND (
            z.participant_1_id IN (vs.participant_1_id, vs.participant_2_id)
            OR z.participant_2_id IN (vs.participant_1_id, vs.participant_2_id)
          )
          AND public.event_lobby_video_session_blocks_new_match(
            z.ready_gate_status,
            z.state::text,
            z.phase,
            z.handshake_started_at,
            z.date_started_at,
            z.ended_at
          )
      )
  ),
  candidate_scores AS (
    SELECT
      c.session_id,
      max(c.candidate_score)::integer AS candidate_score,
      max(c.queued_age_seconds)::integer AS queued_age_seconds,
      bool_or(c.actor_id = p_user_id AND (c.queued_age_seconds >= 120 OR c.actor_recent_no_match_attempts > 0)) AS relief_active,
      min(c.ttl_remaining_seconds)::integer AS ttl_remaining_seconds
    FROM public.v_video_date_queue_fairness_candidates c
    JOIN eligible_queue eq
      ON eq.id = c.session_id
    WHERE c.event_id = p_event_id
    GROUP BY c.session_id
  ),
  ranked AS (
    SELECT
      cs.*,
      (row_number() OVER (
        ORDER BY
          cs.candidate_score DESC NULLS LAST,
          cs.queued_age_seconds DESC NULLS LAST,
          cs.ttl_remaining_seconds ASC NULLS LAST,
          cs.session_id ASC
      ))::integer AS position
    FROM candidate_scores cs
  )
  SELECT
    r.position,
    COALESCE(r.queued_age_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - v_started_at))::integer)),
    COALESCE(r.relief_active, false)
  INTO v_position, v_wait_age_seconds, v_relief_active
  FROM ranked r
  WHERE r.session_id = v_session_id;

  v_estimated_wait_seconds := CASE
    WHEN v_position IS NULL THEN NULL
    ELSE LEAST(600, GREATEST(0, (v_position - 1) * 30))
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'queued', true,
    'session_id', v_session_id,
    'event_queued_count', COALESCE(v_event_queued_count, 0),
    'user_queued_count', COALESCE(v_user_queued_count, 0),
    'position', v_position,
    'wait_age_seconds', COALESCE(v_wait_age_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - v_started_at))::integer)),
    'estimated_wait_seconds', v_estimated_wait_seconds,
    'relief_active', COALESCE(v_relief_active, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_queue_hint_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_queue_hint_v1(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_video_date_queue_hint_v1(uuid, uuid) IS
  'Sprint 2 participant-scoped queue hint. Counts only queued sessions that pass the same active-event, registration, safety, prior-pair, TTL, and active-session eligibility used by drain_match_queue_v2.';

CREATE OR REPLACE FUNCTION public.drain_match_queue(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
BEGIN
  v_key :=
    'legacy:' ||
    p_event_id::text ||
    ':' ||
    COALESCE(v_uid::text, 'anon') ||
    ':' ||
    (floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000))::bigint::text ||
    ':' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  RETURN public.drain_match_queue_v2(p_event_id, v_key)
    || jsonb_build_object('legacy_wrapper', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_match_queue(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue(uuid) IS
  'Sprint 2 compatibility wrapper over drain_match_queue_v2 so legacy web/native clients share v2 queue eligibility, locking, TTL, safety, active-session, and Ready Gate promotion semantics.';
