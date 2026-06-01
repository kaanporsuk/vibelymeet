-- Event deck gender-preference and soft-prefetch repair.
--
-- Fixes the canonical UI value `profiles.interested_in = ARRAY['everyone']`
-- across the Event Lobby Deck, and changes deck v3 from burning the full
-- server buffer as `dealt` to recording a soft, expiring `prefetched` mark.

CREATE OR REPLACE FUNCTION public.preference_allows_gender(
  p_interested_in text[],
  p_gender text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH normalized AS (
    SELECT
      replace(lower(btrim(COALESCE(p_gender, ''))), '_', '-') AS gender,
      ARRAY(
        SELECT replace(lower(btrim(pref.value)), '_', '-')
        FROM unnest(COALESCE(p_interested_in, ARRAY[]::text[])) AS pref(value)
        WHERE NULLIF(btrim(pref.value), '') IS NOT NULL
      )::text[] AS prefs
  )
  SELECT
    cardinality(prefs) = 0
    OR 'everyone' = ANY(prefs)
    OR CASE
      WHEN gender IN ('man', 'men', 'm', 'male') THEN
        prefs && ARRAY['man', 'men', 'm', 'male']::text[]
      WHEN gender IN ('woman', 'women', 'w', 'f', 'female') THEN
        prefs && ARRAY['woman', 'women', 'w', 'f', 'female']::text[]
      WHEN replace(gender, '_', '-') IN ('non-binary', 'nonbinary', 'non binary', 'nb') THEN
        prefs && ARRAY['non-binary', 'nonbinary', 'non binary', 'nb']::text[]
      ELSE gender <> '' AND gender = ANY(prefs)
    END
  FROM normalized;
$function$;

REVOKE ALL ON FUNCTION public.preference_allows_gender(text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preference_allows_gender(text[], text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.preference_allows_gender(text[], text) IS
  'Returns true when an interested_in preference accepts a gender. NULL, empty, or everyone means unrestricted; canonical and legacy gender aliases are normalized.';

CREATE OR REPLACE FUNCTION public.check_gender_compatibility(
  _viewer_id uuid,
  _target_gender text,
  _target_interested_in text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS viewer
    WHERE viewer.id = _viewer_id
      AND public.preference_allows_gender(viewer.interested_in, _target_gender)
      AND public.preference_allows_gender(_target_interested_in, viewer.gender)
  );
$function$;

REVOKE ALL ON FUNCTION public.check_gender_compatibility(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_gender_compatibility(uuid, text, text[])
  TO authenticated, service_role;

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
    AND public.is_profile_discoverable(p.id, p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles viewer
      WHERE viewer.id = p_user_id
        AND public.preference_allows_gender(viewer.interested_in, p.gender)
        AND public.preference_allows_gender(p.interested_in, viewer.gender)
    )
    AND (
      p.age IS NULL
      OR COALESCE((
        SELECT
          (viewer.preferred_age_min IS NULL OR p.age >= viewer.preferred_age_min)
          AND (viewer.preferred_age_max IS NULL OR p.age <= viewer.preferred_age_max)
        FROM public.profiles viewer
        WHERE viewer.id = p_user_id
      ), TRUE)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_user_id
        AND es.target_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    )
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

CREATE OR REPLACE FUNCTION public.find_mystery_match_20260501180000_active_base(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_gender text;
  v_user_interested_in text[];
  v_partner_id uuid;
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_hidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND er.admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_registered');
  END IF;

  SELECT gender, interested_in
  INTO v_user_gender, v_user_interested_in
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  SELECT er.profile_id
  INTO v_partner_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.queue_status = 'browsing'
    AND er.profile_id != p_user_id
    AND public.is_profile_discoverable(er.profile_id, p_user_id)
    AND public.preference_allows_gender(v_user_interested_in, p.gender)
    AND public.preference_allows_gender(p.interested_in, v_user_gender)
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = er.profile_id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = er.profile_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = er.profile_id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = er.profile_id))
    )
  ORDER BY random()
  LIMIT 1
  FOR UPDATE OF er SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'no_candidates', true);
  END IF;

  INSERT INTO public.video_sessions (
    event_id,
    participant_1_id,
    participant_2_id,
    ready_gate_status,
    ready_gate_expires_at,
    queued_expires_at
  ) VALUES (
    p_event_id,
    LEAST(p_user_id, v_partner_id),
    GREATEST(p_user_id, v_partner_id),
    'ready',
    now() + interval '30 seconds',
    NULL
  )
  RETURNING id INTO v_session_id;

  UPDATE public.event_registrations
  SET queue_status = 'in_ready_gate',
      current_room_id = v_session_id,
      current_partner_id = CASE WHEN profile_id = p_user_id THEN v_partner_id ELSE p_user_id END,
      last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'partner_id', v_partner_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid) IS
  'Internal Mystery Match fallback candidate picker. Uses shared gender-preference normalization, including everyone and legacy aliases.';

ALTER TABLE public.event_profile_impressions
  ADD COLUMN IF NOT EXISTS prefetch_expires_at timestamptz;

ALTER TABLE public.event_profile_impressions
  DROP CONSTRAINT IF EXISTS event_profile_impressions_last_action_check;
ALTER TABLE public.event_profile_impressions
  DROP CONSTRAINT IF EXISTS event_profile_impressions_strongest_exclusion_reason_check;
ALTER TABLE public.event_profile_impression_events
  DROP CONSTRAINT IF EXISTS event_profile_impression_events_action_check;

ALTER TABLE public.event_profile_impressions
  ADD CONSTRAINT event_profile_impressions_last_action_check
  CHECK (last_action IN ('prefetched', 'dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported'));
ALTER TABLE public.event_profile_impressions
  ADD CONSTRAINT event_profile_impressions_strongest_exclusion_reason_check
  CHECK (strongest_exclusion_reason IN ('prefetched', 'dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported'));
ALTER TABLE public.event_profile_impression_events
  ADD CONSTRAINT event_profile_impression_events_action_check
  CHECK (action IN ('prefetched', 'dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported'));

CREATE INDEX IF NOT EXISTS idx_epi_prefetch_expiry
  ON public.event_profile_impressions(viewer_id, event_id, prefetch_expires_at)
  WHERE strongest_exclusion_reason = 'prefetched';

CREATE OR REPLACE FUNCTION public.video_date_impression_rank(p_reason text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_reason
    WHEN 'prefetched' THEN 5
    WHEN 'dealt' THEN 10
    WHEN 'seen' THEN 20
    WHEN 'pass' THEN 30
    WHEN 'vibe' THEN 40
    WHEN 'super_vibe' THEN 50
    WHEN 'paired' THEN 80
    WHEN 'blocked' THEN 100
    WHEN 'reported' THEN 110
    ELSE 0
  END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_impression_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_impression_rank(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_event_profile_impression_v2(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid,
  p_action text,
  p_source text DEFAULT 'server',
  p_session_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'server'), 80);
  v_prefetch_expires_at timestamptz := NULL;
BEGIN
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_viewer_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_event_id IS NULL OR p_viewer_id IS NULL OR p_target_id IS NULL OR p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_impression');
  END IF;
  IF v_action NOT IN ('prefetched', 'dealt', 'seen', 'pass', 'vibe', 'super_vibe', 'paired', 'blocked', 'reported') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF v_action = 'prefetched' THEN
    v_prefetch_expires_at := now() + interval '2 minutes';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_registered');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_target_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_registered');
  END IF;

  INSERT INTO public.event_profile_impressions (
    event_id,
    viewer_id,
    target_id,
    last_action,
    strongest_exclusion_reason,
    source,
    session_id,
    metadata,
    prefetch_expires_at
  )
  VALUES (
    p_event_id,
    p_viewer_id,
    p_target_id,
    v_action,
    v_action,
    v_source,
    p_session_id,
    COALESCE(p_metadata, '{}'::jsonb),
    v_prefetch_expires_at
  )
  ON CONFLICT (event_id, viewer_id, target_id) DO UPDATE
  SET
    last_action = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.last_action
      ELSE EXCLUDED.last_action
    END,
    last_action_at = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.last_action_at
      ELSE now()
    END,
    strongest_exclusion_reason = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN EXCLUDED.strongest_exclusion_reason
      ELSE event_profile_impressions.strongest_exclusion_reason
    END,
    prefetch_expires_at = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank('dealt')
        THEN NULL
      WHEN EXCLUDED.strongest_exclusion_reason = 'prefetched'
           AND public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
               < public.video_date_impression_rank('dealt')
        THEN EXCLUDED.prefetch_expires_at
      ELSE event_profile_impressions.prefetch_expires_at
    END,
    source = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.source
      ELSE EXCLUDED.source
    END,
    session_id = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.session_id
      ELSE COALESCE(EXCLUDED.session_id, event_profile_impressions.session_id)
    END,
    metadata = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.metadata
      ELSE event_profile_impressions.metadata || EXCLUDED.metadata
    END,
    updated_at = CASE
      WHEN EXCLUDED.strongest_exclusion_reason IN ('prefetched', 'dealt')
           AND public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
               < public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN event_profile_impressions.updated_at
      ELSE now()
    END;

  INSERT INTO public.event_profile_impression_events (
    event_id,
    viewer_id,
    target_id,
    action,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    p_viewer_id,
    p_target_id,
    v_action,
    v_source,
    p_session_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'action', v_action);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_event_profile_impression_v2(uuid, uuid, uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_profile_impression_v2(uuid, uuid, uuid, text, text, uuid, jsonb)
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
    SELECT gd.*, row_number() OVER () AS base_rn
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit) AS gd
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
        'deck_version', 'v3'
      )
    ) AS result
    FROM ranked
  )
  SELECT
    COALESCE(
      jsonb_agg(
        to_jsonb(ranked)
          - 'rn'
          - 'base_rn'
          - 'impression_reason'
          - 'impression_prefetch_expires_at'
        ORDER BY ranked.rn
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT n FROM raw_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((SELECT count(*)::integer FROM mark_buffer), 0)
  INTO v_profiles, v_raw_count, v_profile_count, v_marked_count
  FROM ranked;

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
      'prefetch_ttl_seconds', 120
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state and records server-buffered profiles as expiring prefetched impressions; only visible top cards are marked dealt.';

CREATE OR REPLACE FUNCTION public.record_event_deck_card_visible_v1(
  p_event_id uuid,
  p_viewer_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active record;
BEGIN
  IF v_uid IS NULL OR v_uid <> p_viewer_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'event_not_active',
      'inactive_reason', COALESCE(v_active.reason, 'event_not_active')
    );
  END IF;

  IF public.is_profile_hidden(p_viewer_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'viewer_paused');
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
      'deck_version', 'v3'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid) IS
  'Marks the currently visible top Event Lobby Deck card as dealt. Clients call this once the card is actually rendered.';
