-- Public API/interface changes for deck v3, queue hints, and own payment settlement visibility.

CREATE OR REPLACE FUNCTION public.get_event_deck_v3(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 50));
  v_scan_limit integer := 5000;
  v_active record;
  v_profiles jsonb := '[]'::jsonb;
  v_raw_count integer := 0;
  v_profile_count integer := 0;
  v_marked_count integer := 0;
  v_reason text := 'unknown';
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'event_not_active',
        'inactive_reason', COALESCE(v_active.reason, 'event_not_active'),
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'not_registered',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_date_deck_v3:' || p_event_id::text || ':' || p_user_id::text, 0)
  );

  WITH raw_deck AS (
    SELECT *
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit)
  ),
  raw_count AS (
    SELECT count(*)::integer AS n FROM raw_deck
  ),
  filtered AS (
    SELECT rd.*
    FROM raw_deck rd
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_profile_impressions epi
      WHERE epi.event_id = p_event_id
        AND epi.viewer_id = p_user_id
        AND epi.target_id = rd.profile_id
        AND public.video_date_impression_rank(epi.strongest_exclusion_reason) >= public.video_date_impression_rank('dealt')
    )
  ),
  ranked AS (
    SELECT filtered.*, row_number() OVER () AS rn
    FROM filtered
    LIMIT v_limit
  ),
  mark_buffer AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'dealt',
      'get_event_deck_v3_buffer',
      NULL,
      jsonb_build_object(
        'server_dealt', true,
        'deck_rank', ranked.rn,
        'deck_version', 'v3'
      )
    ) AS result
    FROM ranked
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(ranked) - 'rn' ORDER BY ranked.rn), '[]'::jsonb),
    COALESCE((SELECT n FROM raw_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((SELECT count(*)::integer FROM mark_buffer), 0)
  INTO v_profiles, v_raw_count, v_profile_count, v_marked_count
  FROM ranked;

  v_reason := CASE
    WHEN v_profile_count > 0 THEN 'ready'
    WHEN v_raw_count = 0 THEN 'no_confirmed_candidates'
    WHEN v_raw_count >= v_scan_limit THEN 'scan_window_exhausted'
    ELSE 'no_remaining_profiles'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profiles', v_profiles,
    'deck_state', jsonb_build_object(
      'reason', v_reason,
      'retryable', v_reason = 'scan_window_exhausted',
      'limit', v_limit,
      'scan_limit', v_scan_limit,
      'raw_count', v_raw_count,
      'profile_count', v_profile_count,
      'marked_count', v_marked_count
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state and marks every server-buffered returned profile as dealt for web and native deck consumers.';

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
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered', 'queued', false);
  END IF;

  SELECT vs.id, vs.started_at
  INTO v_session_id, v_started_at
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_user_id OR vs.participant_2_id = p_user_id)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1;

  SELECT count(DISTINCT vs.id)::integer
  INTO v_event_queued_count
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now();

  SELECT count(*)::integer
  INTO v_user_queued_count
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_user_id OR vs.participant_2_id = p_user_id);

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

  WITH candidate_scores AS (
    SELECT
      c.session_id,
      max(c.candidate_score)::integer AS candidate_score,
      max(c.queued_age_seconds)::integer AS queued_age_seconds,
      bool_or(c.actor_id = p_user_id AND (c.queued_age_seconds >= 120 OR c.actor_recent_no_match_attempts > 0)) AS relief_active,
      min(c.ttl_remaining_seconds)::integer AS ttl_remaining_seconds
    FROM public.v_video_date_queue_fairness_candidates c
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
  SELECT r.position, COALESCE(r.queued_age_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - v_started_at))::integer)), COALESCE(r.relief_active, false)
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
  'Participant-scoped queue hint for web/native lobby UI. Returns approximate queue position, ETA, and starvation-relief state without exposing other users.';

CREATE OR REPLACE FUNCTION public.get_event_ticket_payment_status_v1(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_registration record;
  v_settlement record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT er.admission_status, er.payment_status
  INTO v_registration
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid
  ORDER BY er.registered_at DESC NULLS LAST
  LIMIT 1;

  SELECT s.checkout_session_id, s.outcome, s.result, s.created_at
  INTO v_settlement
  FROM public.stripe_event_ticket_settlements s
  WHERE s.event_id = p_event_id
    AND s.profile_id = v_uid
  ORDER BY s.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', p_event_id,
    'admission_status', v_registration.admission_status,
    'payment_status', v_registration.payment_status,
    'settlement', CASE
      WHEN v_settlement.checkout_session_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'checkout_session_id', v_settlement.checkout_session_id,
        'outcome', v_settlement.outcome,
        'code', v_settlement.result->>'code',
        'error', v_settlement.result->>'error',
        'admission_status', v_settlement.result->>'admission_status',
        'success', v_settlement.result->'success',
        'created_at', v_settlement.created_at
      )
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_ticket_payment_status_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_ticket_payment_status_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_ticket_payment_status_v1(uuid) IS
  'Authenticated caller read model for their own event-ticket payment settlement and registration state.';

NOTIFY pgrst, 'reload schema';
