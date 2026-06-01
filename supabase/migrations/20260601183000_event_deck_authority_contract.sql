-- Event Deck authority contract.
--
-- Closes the remaining server-authority gaps after soft-prefetch:
--   * candidate eligibility is shared by deck, visible-card marking, and swipes
--   * deck v3 returns short-lived card reservations
--   * visible-card marking and swipes validate a token or current top-card fallback
--   * direct event_swipes mutation is service-owned
--   * Event Deck age compatibility now mirrors Daily Drop's mutual age rule

CREATE TABLE IF NOT EXISTS public.event_deck_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  deck_token text NOT NULL UNIQUE,
  deck_rank integer NOT NULL CHECK (deck_rank > 0),
  source text NOT NULL DEFAULT 'get_event_deck_v3',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  visible_at timestamptz,
  swiped_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (viewer_id <> target_id),
  CHECK (expires_at > issued_at),
  CHECK (NOT public.video_date_jsonb_has_secret_key(metadata))
);

CREATE INDEX IF NOT EXISTS idx_event_deck_card_reservations_viewer_active
  ON public.event_deck_card_reservations(event_id, viewer_id, expires_at DESC, deck_rank)
  WHERE swiped_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_deck_card_reservations_target
  ON public.event_deck_card_reservations(event_id, viewer_id, target_id, expires_at DESC);

ALTER TABLE public.event_deck_card_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_deck_card_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_deck_card_reservations TO service_role;

DROP POLICY IF EXISTS "service_role_manages_event_deck_card_reservations"
  ON public.event_deck_card_reservations;
CREATE POLICY "service_role_manages_event_deck_card_reservations"
  ON public.event_deck_card_reservations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE INSERT, UPDATE, DELETE ON TABLE public.event_swipes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_swipes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_swipes TO service_role;
DROP POLICY IF EXISTS "Users can create own swipes" ON public.event_swipes;

CREATE OR REPLACE FUNCTION public.event_deck_candidate_eligibility(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_check_active boolean DEFAULT true,
  p_check_existing_swipe boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_active record;
  v_viewer public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_viewer_reg record;
  v_target_reg record;
BEGIN
  IF p_event_id IS NULL OR p_viewer_id IS NULL OR p_target_id IS NULL OR p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_candidate');
  END IF;

  IF p_check_active THEN
    SELECT *
    INTO v_active
    FROM public.get_event_lobby_active_state(p_event_id, now());

    IF NOT COALESCE(v_active.is_active, false) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'event_not_active',
        'inactive_reason', COALESCE(v_active.reason, 'event_not_active')
      );
    END IF;
  END IF;

  SELECT * INTO v_viewer
  FROM public.profiles
  WHERE id = p_viewer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'viewer_not_found');
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_found');
  END IF;

  SELECT er.admission_status, er.queue_status
  INTO v_viewer_reg
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_viewer_id;

  IF NOT FOUND OR COALESCE(v_viewer_reg.admission_status, '') <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT er.admission_status, er.queue_status
  INTO v_target_reg
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_target_id;

  IF NOT FOUND OR COALESCE(v_target_reg.admission_status, '') <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_registered');
  END IF;

  IF public.is_profile_hidden(p_viewer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'viewer_paused');
  END IF;

  IF public.is_blocked(p_viewer_id, p_target_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE ur.reporter_id = p_viewer_id
      AND ur.reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reported');
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_viewer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_unavailable');
  END IF;

  IF COALESCE(v_target_reg.queue_status, 'idle') NOT IN ('browsing', 'idle') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_unavailable');
  END IF;

  IF NOT public.preference_allows_gender(v_viewer.interested_in, v_target.gender)
     OR NOT public.preference_allows_gender(v_target.interested_in, v_viewer.gender) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'gender_incompatible');
  END IF;

  IF v_target.age IS NOT NULL
     AND (
       (v_viewer.preferred_age_min IS NOT NULL AND v_target.age < v_viewer.preferred_age_min)
       OR (v_viewer.preferred_age_max IS NOT NULL AND v_target.age > v_viewer.preferred_age_max)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'age_incompatible');
  END IF;

  IF v_viewer.age IS NOT NULL
     AND (
       (v_target.preferred_age_min IS NOT NULL AND v_viewer.age < v_target.preferred_age_min)
       OR (v_target.preferred_age_max IS NOT NULL AND v_viewer.age > v_target.preferred_age_max)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'age_incompatible');
  END IF;

  IF p_check_existing_swipe
     AND EXISTS (
       SELECT 1
       FROM public.event_swipes es
       WHERE es.event_id = p_event_id
         AND es.actor_id = p_viewer_id
         AND es.target_id = p_target_id
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_swiped');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_id)
       OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_connected');
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_viewer_id, p_target_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pair_already_met_this_event');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND ((vs.participant_1_id = p_viewer_id AND vs.participant_2_id = p_target_id)
        OR (vs.participant_2_id = p_viewer_id AND vs.participant_1_id = p_target_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pair_already_in_session');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND (vs.participant_1_id = p_viewer_id OR vs.participant_2_id = p_viewer_id)
      AND public.event_lobby_video_session_blocks_new_match(
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.handshake_started_at,
        vs.date_started_at,
        vs.ended_at
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'participant_has_active_session_conflict');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND (vs.participant_1_id = p_target_id OR vs.participant_2_id = p_target_id)
      AND public.event_lobby_video_session_blocks_new_match(
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.handshake_started_at,
        vs.date_started_at,
        vs.ended_at
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_active_session_conflict');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'eligible');
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_candidate_eligibility(uuid, uuid, uuid, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_candidate_eligibility(uuid, uuid, uuid, boolean, boolean)
  TO service_role;

COMMENT ON FUNCTION public.event_deck_candidate_eligibility(uuid, uuid, uuid, boolean, boolean) IS
  'Canonical Event Lobby Deck eligibility helper shared by deck fetch, visible-card marking, and swipe authority wrappers.';

CREATE OR REPLACE FUNCTION public.event_deck_current_top_candidate(
  p_event_id uuid,
  p_viewer_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_target_id uuid;
BEGIN
  WITH raw_deck AS (
    SELECT gd.*, gd.ordinality::integer AS base_rn
    FROM public.get_event_deck(p_event_id, p_viewer_id, 5000) WITH ORDINALITY AS gd
  ),
  filtered AS (
    SELECT
      rd.*,
      epi.strongest_exclusion_reason AS impression_reason,
      epi.prefetch_expires_at AS impression_prefetch_expires_at
    FROM raw_deck rd
    LEFT JOIN public.event_profile_impressions epi
      ON epi.event_id = p_event_id
      AND epi.viewer_id = p_viewer_id
      AND epi.target_id = rd.profile_id
    WHERE epi.target_id IS NULL
      OR public.video_date_impression_rank(epi.strongest_exclusion_reason)
          < public.video_date_impression_rank('dealt')
  )
  SELECT filtered.profile_id
  INTO v_target_id
  FROM filtered
  ORDER BY
    CASE
      WHEN filtered.impression_prefetch_expires_at IS NULL
           OR filtered.impression_prefetch_expires_at <= now()
        THEN 0
      ELSE 1
    END,
    filtered.base_rn
  LIMIT 1;

  RETURN v_target_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_current_top_candidate(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.event_deck_validate_presented_card(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_deck_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_validation jsonb;
  v_token text := NULLIF(btrim(COALESCE(p_deck_token, '')), '');
  v_reservation record;
  v_current_top uuid;
BEGIN
  v_validation := public.event_deck_candidate_eligibility(
    p_event_id,
    p_viewer_id,
    p_target_id,
    true,
    true
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_validation;
  END IF;

  IF v_token IS NOT NULL THEN
    SELECT r.id, r.expires_at
    INTO v_reservation
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_viewer_id
      AND r.target_id = p_target_id
      AND r.deck_token = v_token
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    ORDER BY r.issued_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_deck_token');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'valid_deck_token',
      'reservation_id', v_reservation.id,
      'expires_at', v_reservation.expires_at
    );
  END IF;

  v_current_top := public.event_deck_current_top_candidate(p_event_id, p_viewer_id);
  IF v_current_top IS NULL OR v_current_top IS DISTINCT FROM p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_current_top_card');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'current_top_card');
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_validate_presented_card(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.event_deck_swipe_failure_response(
  p_validation jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_reason text := COALESCE(p_validation->>'reason', 'target_unavailable');
BEGIN
  IF v_reason = 'event_not_active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'event_not_active',
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', COALESCE(p_validation->>'inactive_reason', 'event_not_active'),
      'message', 'This event is no longer active.',
      'notification_suppressed', true,
      'dedupe_reason', 'event_not_active'
    );
  END IF;

  IF v_reason = 'not_registered' THEN
    RETURN jsonb_build_object('success', false, 'outcome', 'not_registered', 'result', 'not_registered', 'error', 'not_registered', 'notification_suppressed', true);
  END IF;

  IF v_reason IN ('target_not_registered', 'target_not_found') THEN
    RETURN jsonb_build_object('success', false, 'outcome', 'target_not_found', 'result', 'target_not_found', 'error', 'target_not_found', 'notification_suppressed', true);
  END IF;

  IF v_reason = 'viewer_paused' THEN
    RETURN jsonb_build_object('success', false, 'outcome', 'account_paused', 'result', 'account_paused', 'error', 'account_paused', 'message', 'Resume your account before swiping in this event.', 'notification_suppressed', true);
  END IF;

  IF v_reason = 'blocked' THEN
    RETURN jsonb_build_object('success', false, 'outcome', 'blocked', 'result', 'blocked', 'error', 'blocked', 'notification_suppressed', true);
  END IF;

  IF v_reason = 'reported' THEN
    RETURN jsonb_build_object('success', false, 'outcome', 'reported', 'result', 'reported', 'error', 'reported', 'notification_suppressed', true);
  END IF;

  IF v_reason = 'pair_already_met_this_event' THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'pair_already_met_this_event',
      'result', 'pair_already_met_this_event',
      'error', 'pair_already_met_this_event',
      'message', 'You already met this person in this event. Keep browsing for new people.',
      'notification_suppressed', true,
      'dedupe_reason', 'terminal_encounter_pair'
    );
  END IF;

  IF v_reason = 'participant_has_active_session_conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'outcome', 'target_unavailable',
    'result', 'target_unavailable',
    'error', 'target_unavailable',
    'message', 'This person is no longer available in the lobby.',
    'notification_suppressed', true,
    'dedupe_reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.event_deck_swipe_failure_response(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_deck_swipe_failure_response(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_event_deck_20260501180000_active_base(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  profile_id uuid,
  name text,
  age integer,
  gender text,
  avatar_url text,
  photos text[],
  about_me text,
  job text,
  location text,
  height_cm integer,
  tagline text,
  looking_for text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean,
  shared_vibe_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid;
BEGIN
  v_viewer := auth.uid();
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.events ev
    WHERE ev.id = p_event_id
      AND (ev.status = 'cancelled' OR ev.archived_at IS NOT NULL)
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations viewer_reg
    WHERE viewer_reg.event_id = p_event_id
      AND viewer_reg.profile_id = p_user_id
      AND viewer_reg.admission_status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS profile_id,
    p.name,
    p.age,
    p.gender,
    p.avatar_url,
    p.photos,
    COALESCE(NULLIF(trim(p.about_me), ''), NULLIF(trim(p.bio), '')) AS about_me,
    p.job,
    p.location,
    p.height_cm,
    p.tagline,
    p.looking_for,
    er.queue_status,
    EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id != p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    ) AS has_met_before,
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    ) AS is_already_connected,
    EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p.id
        AND es.target_id = p_user_id
        AND es.swipe_type = 'super_vibe'
    ) AS has_super_vibed,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.profile_vibes pv1
      INNER JOIN public.profile_vibes pv2
        ON pv1.vibe_tag_id = pv2.vibe_tag_id
      WHERE pv1.profile_id = p_user_id
        AND pv2.profile_id = p.id
    ), 0) AS shared_vibe_count
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id != p_user_id
    AND COALESCE((public.event_deck_candidate_eligibility(
      p_event_id,
      p_user_id,
      p.id,
      false,
      true
    )->>'ok')::boolean, false)
  ORDER BY
    (EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p.id
        AND es.target_id = p_user_id
        AND es.swipe_type = 'super_vibe'
    )) DESC,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.profile_vibes pv1
      INNER JOIN public.profile_vibes pv2
        ON pv1.vibe_tag_id = pv2.vibe_tag_id
      WHERE pv1.profile_id = p_user_id
        AND pv2.profile_id = p.id
    ), 0) DESC,
    random()
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_20260501180000_active_base(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_deck_20260501180000_active_base(uuid, uuid, integer)
  TO service_role;

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
      AND COALESCE(er.admission_status, '') = 'confirmed'
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

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'viewer_paused',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_date_deck_v3:' || p_event_id::text || ':' || p_user_id::text, 0)
  );

  WITH raw_deck AS (
    SELECT gd.*, gd.ordinality::integer AS base_rn
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit) WITH ORDINALITY AS gd
  ),
  raw_count AS (
    SELECT count(*)::integer AS n FROM raw_deck
  ),
  filtered AS (
    SELECT
      rd.*,
      epi.strongest_exclusion_reason AS impression_reason,
      epi.prefetch_expires_at AS impression_prefetch_expires_at
    FROM raw_deck rd
    LEFT JOIN public.event_profile_impressions epi
      ON epi.event_id = p_event_id
      AND epi.viewer_id = p_user_id
      AND epi.target_id = rd.profile_id
    WHERE epi.target_id IS NULL
      OR public.video_date_impression_rank(epi.strongest_exclusion_reason)
          < public.video_date_impression_rank('dealt')
  ),
  ranked AS (
    SELECT *
    FROM (
      SELECT
        filtered.*,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN filtered.impression_prefetch_expires_at IS NULL
                   OR filtered.impression_prefetch_expires_at <= now()
                THEN 0
              ELSE 1
            END,
            filtered.base_rn
        ) AS rn
      FROM filtered
    ) ordered
    ORDER BY rn
    LIMIT v_limit
  ),
  reservations AS (
    INSERT INTO public.event_deck_card_reservations (
      event_id,
      viewer_id,
      target_id,
      deck_token,
      deck_rank,
      expires_at,
      source,
      metadata
    )
    SELECT
      p_event_id,
      p_user_id,
      ranked.profile_id,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      ranked.rn::integer,
      now() + interval '2 minutes',
      'get_event_deck_v3',
      jsonb_build_object('deck_version', 'v3', 'server_prefetched', true)
    FROM ranked
    RETURNING target_id, deck_token, deck_rank, expires_at
  ),
  mark_buffer AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'prefetched',
      'get_event_deck_v3_buffer',
      NULL,
      jsonb_build_object(
        'server_prefetched', true,
        'prefetch_ttl_seconds', 120,
        'deck_rank', ranked.rn,
        'deck_version', 'v3',
        'reservation_issued', true
      )
    ) AS result
    FROM ranked
    JOIN reservations r ON r.target_id = ranked.profile_id
  )
  SELECT
    COALESCE(
      jsonb_agg(
        (
          to_jsonb(ranked)
            - 'rn'
            - 'base_rn'
            - 'impression_reason'
            - 'impression_prefetch_expires_at'
        ) || jsonb_build_object(
          'deck_token', reservations.deck_token,
          'deck_rank', ranked.rn
        )
        ORDER BY ranked.rn
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT n FROM raw_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((
      SELECT count(*)::integer
      FROM mark_buffer
      WHERE COALESCE((result->>'ok')::boolean, false)
    ), 0)
  INTO v_profiles, v_raw_count, v_profile_count, v_marked_count
  FROM ranked
  JOIN reservations ON reservations.target_id = ranked.profile_id;

  v_reason := CASE
    WHEN v_profile_count > 0 THEN 'has_profiles'
    ELSE 'no_remaining_profiles'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profiles', v_profiles,
    'deck_state', jsonb_build_object(
      'reason', v_reason,
      'retryable', false,
      'limit', v_limit,
      'scan_limit', v_scan_limit,
      'raw_count', v_raw_count,
      'profile_count', v_profile_count,
      'marked_count', v_marked_count,
      'mark_action', 'prefetched',
      'prefetch_ttl_seconds', 120,
      'reservation_ttl_seconds', 120
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state, soft-prefetches buffered cards, and issues short-lived card reservations for visible/swipe authority.';

CREATE OR REPLACE FUNCTION public.record_event_deck_card_visible_v1(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_deck_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_validation jsonb;
  v_reservation_id uuid;
BEGIN
  IF v_uid IS NULL OR v_uid <> p_viewer_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  v_validation := public.event_deck_validate_presented_card(
    p_event_id,
    p_viewer_id,
    p_target_id,
    p_deck_token
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_validation;
  END IF;

  IF v_validation ? 'reservation_id' THEN
    v_reservation_id := (v_validation->>'reservation_id')::uuid;
    UPDATE public.event_deck_card_reservations
    SET visible_at = COALESCE(visible_at, now()),
        metadata = metadata || jsonb_build_object('visible_marked', true)
    WHERE id = v_reservation_id;
  END IF;

  RETURN public.record_event_profile_impression_v2(
    p_event_id,
    p_viewer_id,
    p_target_id,
    'dealt',
    'event_lobby_top_card_visible',
    NULL,
    jsonb_build_object(
      'server_dealt', true,
      'visible_top_card', true,
      'deck_version', 'v3',
      'presentation_reason', v_validation->>'reason'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid, text) IS
  'Marks the visible Event Lobby Deck card as dealt after validating a short-lived reservation token or server-computed current top-card fallback.';

DROP FUNCTION IF EXISTS public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text);
ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260601183000_deck_authority_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe_v2(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text,
  p_deck_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_validation jsonb;
  v_result jsonb;
  v_result_code text;
  v_reservation_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260601183000_deck_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260601183000_deck_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_swipes es
    WHERE es.event_id = p_event_id
      AND es.actor_id = p_actor_id
      AND es.target_id = p_target_id
  ) THEN
    RETURN public.handle_swipe_20260601183000_deck_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  v_validation := public.event_deck_validate_presented_card(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_deck_token
  );

  IF COALESCE((v_validation->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN public.event_deck_swipe_failure_response(v_validation);
  END IF;

  v_result := public.handle_swipe_20260601183000_deck_authority_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
  v_result_code := COALESCE(v_result->>'result', v_result->>'outcome', v_result->>'error');

  IF COALESCE((v_result->>'success')::boolean, false)
     AND v_result_code IN ('pass_recorded', 'vibe_recorded', 'super_vibe_sent', 'match', 'match_queued') THEN
    IF v_validation ? 'reservation_id' THEN
      v_reservation_id := (v_validation->>'reservation_id')::uuid;
      UPDATE public.event_deck_card_reservations
      SET swiped_at = COALESCE(swiped_at, now()),
          metadata = metadata || jsonb_build_object('swipe_type', p_swipe_type, 'swipe_result', v_result_code)
      WHERE id = v_reservation_id;
    END IF;

    PERFORM public.record_event_profile_impression_v2(
      p_event_id,
      p_actor_id,
      p_target_id,
      p_swipe_type,
      'handle_swipe_v2',
      CASE
        WHEN (v_result->>'video_session_id') IS NOT NULL THEN (v_result->>'video_session_id')::uuid
        WHEN (v_result->>'match_id') IS NOT NULL THEN (v_result->>'match_id')::uuid
        ELSE NULL
      END,
      jsonb_build_object(
        'deck_version', 'v3',
        'swipe_result', v_result_code,
        'presentation_reason', v_validation->>'reason'
      )
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.handle_swipe_v2(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type,
    NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe_v2(uuid, uuid, uuid, text, text) IS
  'Reservation-aware Event Lobby swipe path. Validates deck eligibility and card presentation before delegating to the canonical swipe/session chain.';

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Compatibility wrapper for reservation-aware Event Lobby swipes. Old clients fall back to server-computed current top-card validation.';
