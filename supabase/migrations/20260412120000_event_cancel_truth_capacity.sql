-- Event cancellation truth: hide cancelled from discovery; block deck + swipes while cancelled/archived.
-- Admin: confirmed headcount by gender for capacity warnings (no admission behavior change).

-- ─── get_visible_events: exclude cancelled from discovery ───────────────────
DROP FUNCTION IF EXISTS public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_is_premium boolean DEFAULT false,
  p_browse_lat double precision DEFAULT NULL,
  p_browse_lng double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id uuid, title text, description text, cover_image text,
  event_date timestamptz, duration_minutes integer, max_attendees integer,
  current_attendees integer, tags text[], status text, city text, country text,
  scope text, latitude double precision, longitude double precision,
  radius_km integer, distance_km double precision, is_registered boolean,
  is_waitlisted boolean,
  computed_status text, is_recurring boolean, parent_event_id uuid,
  occurrence_number integer, language text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_active boolean;
  v_is_admin boolean;
  v_profile_premium boolean;
  v_can_premium_browse boolean;
  v_browse_lat_eff double precision;
  v_browse_lng_eff double precision;
  v_effective_lat double precision;
  v_effective_lng double precision;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (
        p.is_premium = true
        OR (p.premium_until IS NOT NULL AND p.premium_until > now())
      )
  ) INTO v_profile_premium;

  v_can_premium_browse := COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

  v_browse_lat_eff := CASE
    WHEN v_can_premium_browse
      AND p_browse_lat IS NOT NULL
      AND p_browse_lng IS NOT NULL
    THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_premium_browse
      AND p_browse_lat IS NOT NULL
      AND p_browse_lng IS NOT NULL
    THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, p_user_lat);
  v_effective_lng := COALESCE(v_browse_lng_eff, p_user_lng);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL AND v_effective_lat IS NOT NULL
      THEN haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1 FROM event_registrations er
      WHERE er.event_id = e.id AND er.profile_id = p_user_id
        AND er.admission_status = 'confirmed'
    ) AS is_registered,
    EXISTS (
      SELECT 1 FROM event_registrations er
      WHERE er.event_id = e.id AND er.profile_id = p_user_id
        AND er.admission_status = 'waitlisted'
    ) AS is_waitlisted,
    CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'ended' OR e.ended_at IS NOT NULL THEN 'ended'
      WHEN now() >= e.event_date
        AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'live'
      WHEN now() >= (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'ended'
      ELSE 'upcoming'
    END AS computed_status,
    e.is_recurring, e.parent_event_id, e.occurrence_number,
    e.language
  FROM events e
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
    AND (
      e.scope = 'global'
      OR e.scope IS NULL
      OR (e.scope = 'regional' AND (
        e.country IS NULL
        OR e.country = (SELECT pr.country FROM profiles pr WHERE pr.id = p_user_id)
        OR v_can_premium_browse
      ))
      OR (e.scope = 'local' AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL AND (
        v_effective_lat IS NULL
        OR haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
          <= COALESCE(e.radius_km, 50)::double precision
      ))
    )
    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR COALESCE(e.scope, 'global') IN ('global', 'regional')
      OR (e.latitude IS NOT NULL AND e.longitude IS NOT NULL
          AND haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
            <= p_filter_radius_km)
    )
  ORDER BY
    CASE
      WHEN now() >= e.event_date AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$function$;

-- ─── get_event_deck: no rows when cancelled or archived ─────────────────────
CREATE OR REPLACE FUNCTION public.get_event_deck(
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
SET search_path TO 'public'
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
    AND er.profile_id != p_user_id
    AND NOT public.is_profile_hidden(p.id)
    AND EXISTS (
      SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
      AND (viewer.interested_in IS NULL OR cardinality(viewer.interested_in) = 0
        OR p.gender = ANY(viewer.interested_in)
        OR (p.gender = 'woman' AND 'women' = ANY(viewer.interested_in))
        OR (p.gender = 'man' AND 'men' = ANY(viewer.interested_in))
        OR (p.gender = 'non-binary' AND 'non-binary' = ANY(viewer.interested_in)))
    )
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
        AND (viewer.gender = ANY(p.interested_in)
          OR (viewer.gender = 'woman' AND 'women' = ANY(p.interested_in))
          OR (viewer.gender = 'man' AND 'men' = ANY(p.interested_in))
          OR (viewer.gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in)))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_user_id
        AND es.target_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users bu
      WHERE (bu.blocker_id = p_user_id AND bu.blocked_id = p.id)
         OR (bu.blocker_id = p.id AND bu.blocked_id = p_user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = p.id
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

-- ─── handle_swipe: block when cancelled or archived ──────────────────────────
CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_super_count integer;
  v_recent_super boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = p_event_id AND profile_id = p_actor_id) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = p_event_id AND profile_id = p_target_id) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.events ev
    WHERE ev.id = p_event_id
      AND (ev.status = 'cancelled' OR ev.archived_at IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('result', 'event_not_active', 'reason', 'cancelled_or_archived');
  END IF;

  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;
  IF EXISTS (SELECT 1 FROM user_reports WHERE reporter_id = p_actor_id AND reported_id = p_target_id) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'account_paused',
      'message', 'Your account is currently on a break'
    );
  END IF;

  IF public.is_profile_hidden(p_target_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_unavailable',
      'message', 'This profile is no longer available'
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;
    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_actor_id AND swipe_type = 'super_vibe';
    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM event_swipes
      WHERE actor_id = p_actor_id AND target_id = p_target_id AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;
    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_target_id AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    SELECT queue_status INTO v_actor_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id
    FOR UPDATE;

    SELECT queue_status INTO v_target_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id
    FOR UPDATE;

    INSERT INTO video_sessions (
      event_id, participant_1_id, participant_2_id, ready_gate_status, ready_gate_expires_at
    ) VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN 'ready' ELSE 'queued' END,
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN now() + interval '30 seconds' ELSE NULL END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle') THEN
      UPDATE event_registrations
      SET queue_status = 'in_ready_gate',
          current_room_id = v_session_id,
          current_partner_id = CASE WHEN profile_id = p_actor_id THEN p_target_id ELSE p_actor_id END,
          last_active_at = now()
      WHERE event_id = p_event_id AND profile_id IN (p_actor_id, p_target_id);

      RETURN jsonb_build_object('result', 'match', 'match_id', v_session_id, 'immediate', true);
    ELSE
      RETURN jsonb_build_object('result', 'match_queued', 'match_id', v_session_id);
    END IF;
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;
  RETURN jsonb_build_object('result', 'vibe_recorded');
END;
$function$;

-- ─── admin_get_event_confirmed_gender_counts ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_event_confirmed_gender_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_male integer;
  v_female integer;
  v_nonbinary integer;
  v_other integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE lower(trim(COALESCE(p.gender, ''))) IN ('man', 'male')),
    COUNT(*) FILTER (WHERE lower(trim(COALESCE(p.gender, ''))) IN ('woman', 'female')),
    COUNT(*) FILTER (WHERE lower(trim(COALESCE(p.gender, ''))) IN ('non-binary', 'nonbinary')),
    COUNT(*) FILTER (WHERE NOT (
      lower(trim(COALESCE(p.gender, ''))) IN ('man', 'male', 'woman', 'female', 'non-binary', 'nonbinary')
    ))
  INTO v_male, v_female, v_nonbinary, v_other
  FROM public.event_registrations er
  INNER JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed';

  RETURN jsonb_build_object(
    'ok', true,
    'male', COALESCE(v_male, 0),
    'female', COALESCE(v_female, 0),
    'nonbinary', COALESCE(v_nonbinary, 0),
    'other_or_unspecified', COALESCE(v_other, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_event_confirmed_gender_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_event_confirmed_gender_counts(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_get_event_confirmed_gender_counts(uuid) IS
  'Admin-only: count confirmed registrations by normalized gender for capacity warnings; admission paths unchanged.';
