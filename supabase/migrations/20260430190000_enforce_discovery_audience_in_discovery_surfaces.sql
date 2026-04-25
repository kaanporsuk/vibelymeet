-- Enforce "Who can discover me" across passive discovery and pre-match exposure.
-- Historical migrations alternated between viewerless is_profile_hidden() and
-- viewer-aware is_profile_discoverable(). This migration makes the viewer-aware
-- predicate canonical for surfaces that reveal one normal user to another.

CREATE OR REPLACE FUNCTION public.is_profile_hidden(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT
    COALESCE(p.is_suspended, false) AS is_suspended,
    COALESCE(p.is_paused, false) AS is_paused,
    p.paused_until,
    COALESCE(p.account_paused, false) AS account_paused,
    p.account_paused_until,
    COALESCE(p.discoverable, true) AS discoverable,
    COALESCE(p.discovery_mode, 'visible') AS discovery_mode,
    p.discovery_snooze_until,
    COALESCE(p.discovery_audience, 'everyone') AS discovery_audience
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  IF v_profile.is_suspended THEN
    RETURN true;
  END IF;

  IF NOT v_profile.discoverable THEN
    RETURN true;
  END IF;

  IF v_profile.discovery_mode = 'hidden' THEN
    RETURN true;
  END IF;

  IF v_profile.discovery_mode = 'snoozed'
     AND (v_profile.discovery_snooze_until IS NULL OR v_profile.discovery_snooze_until > now()) THEN
    RETURN true;
  END IF;

  -- Defensive safeguard for legacy/viewerless callers. event_based still needs
  -- is_profile_discoverable(target, viewer), because this helper has no viewer.
  IF v_profile.discovery_audience = 'hidden' THEN
    RETURN true;
  END IF;

  IF v_profile.is_paused
     AND (v_profile.paused_until IS NULL OR v_profile.paused_until > now()) THEN
    RETURN true;
  END IF;

  IF v_profile.account_paused
     AND (v_profile.account_paused_until IS NULL OR v_profile.account_paused_until > now()) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.is_profile_hidden(uuid) IS
  'Viewerless suppression helper for global discovery hiding only. Viewer-aware exposure must use is_profile_discoverable(target, viewer).';

CREATE OR REPLACE FUNCTION public.profiles_have_safety_block(
  p_profile_a uuid,
  p_profile_b uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_profile_a IS NOT NULL
    AND p_profile_b IS NOT NULL
    AND p_profile_a IS DISTINCT FROM p_profile_b
    AND (
      public.is_blocked(p_profile_a, p_profile_b)
      OR EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = p_profile_a AND ur.reported_id = p_profile_b)
           OR (ur.reporter_id = p_profile_b AND ur.reported_id = p_profile_a)
      )
    );
$$;

COMMENT ON FUNCTION public.profiles_have_safety_block(uuid, uuid) IS
  'Hard visibility override for normal users. True when either side blocked or reported the other.';

CREATE OR REPLACE FUNCTION public.profiles_have_qualifying_shared_event(
  p_profile_a uuid,
  p_profile_b uuid,
  p_event_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_profile_a IS NOT NULL
    AND p_profile_b IS NOT NULL
    AND p_profile_a IS DISTINCT FROM p_profile_b
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations a_reg
      JOIN public.event_registrations b_reg
        ON b_reg.event_id = a_reg.event_id
      JOIN public.events e
        ON e.id = a_reg.event_id
      WHERE a_reg.profile_id = p_profile_a
        AND b_reg.profile_id = p_profile_b
        AND (p_event_id IS NULL OR a_reg.event_id = p_event_id)
        AND a_reg.admission_status = 'confirmed'
        AND b_reg.admission_status = 'confirmed'
        AND e.archived_at IS NULL
        AND COALESCE(e.status, 'upcoming') NOT IN ('cancelled', 'draft')
        AND now() <= COALESCE(
          e.ended_at,
          e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute'
        ) + interval '6 hours'
    );
$$;

COMMENT ON FUNCTION public.profiles_have_qualifying_shared_event(uuid, uuid, uuid) IS
  'Confirmed shared-event helper for discoverability. Excludes cancelled, draft, archived, and stale historical events; uses the same +6h ended-event visibility window as get_visible_events.';

CREATE OR REPLACE FUNCTION public.is_profile_discoverable(
  p_target_id uuid,
  p_viewer_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  IF p_target_id IS NULL OR p_viewer_id IS NULL OR p_target_id = p_viewer_id THEN
    RETURN false;
  END IF;

  SELECT
    COALESCE(p.is_suspended, false) AS is_suspended,
    COALESCE(p.is_paused, false) AS is_paused,
    p.paused_until,
    COALESCE(p.account_paused, false) AS account_paused,
    p.account_paused_until,
    COALESCE(p.discoverable, true) AS discoverable,
    COALESCE(p.discovery_mode, 'visible') AS discovery_mode,
    p.discovery_snooze_until,
    COALESCE(p.discovery_audience, 'everyone') AS discovery_audience
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_profile.is_suspended THEN
    RETURN false;
  END IF;

  IF NOT v_profile.discoverable THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_mode = 'hidden' THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_mode = 'snoozed'
     AND (v_profile.discovery_snooze_until IS NULL OR v_profile.discovery_snooze_until > now()) THEN
    RETURN false;
  END IF;

  IF v_profile.is_paused
     AND (v_profile.paused_until IS NULL OR v_profile.paused_until > now()) THEN
    RETURN false;
  END IF;

  IF v_profile.account_paused
     AND (v_profile.account_paused_until IS NULL OR v_profile.account_paused_until > now()) THEN
    RETURN false;
  END IF;

  IF public.is_blocked(p_viewer_id, p_target_id) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE (ur.reporter_id = p_viewer_id AND ur.reported_id = p_target_id)
       OR (ur.reporter_id = p_target_id AND ur.reported_id = p_viewer_id)
  ) THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_audience = 'hidden' THEN
    RETURN false;
  END IF;

  IF v_profile.discovery_audience = 'event_based' THEN
    RETURN public.profiles_have_qualifying_shared_event(p_target_id, p_viewer_id);
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_profile_discoverable(uuid, uuid) IS
  'Canonical viewer-aware predicate for passive discovery and pre-match exposure.';

CREATE OR REPLACE FUNCTION public.profile_has_established_access(
  p_target_id uuid,
  p_viewer_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  SELECT
    p_target_id IS NOT NULL
    AND p_viewer_id IS NOT NULL
    AND (
      p_target_id = p_viewer_id
      OR public.has_role(p_viewer_id, 'admin'::public.app_role)
      OR (
        NOT public.profiles_have_safety_block(p_target_id, p_viewer_id)
        AND (
          EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_id)
               OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_id)
          )
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE (
                vs.ended_at IS NULL
                OR vs.ended_at >= now() - interval '14 days'
              )
              AND (
                (vs.participant_1_id = p_viewer_id AND vs.participant_2_id = p_target_id)
                OR (vs.participant_2_id = p_viewer_id AND vs.participant_1_id = p_target_id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.daily_drops dd
            WHERE COALESCE(dd.status, '') <> 'invalidated'
              AND (
                (dd.user_a_id = p_viewer_id AND dd.user_b_id = p_target_id)
                OR (dd.user_b_id = p_viewer_id AND dd.user_a_id = p_target_id)
              )
          )
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.viewer_shares_event_with_profile(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_other_profile_id IS DISTINCT FROM auth.uid()
    AND NOT public.profiles_have_safety_block(p_other_profile_id, auth.uid())
    AND public.is_profile_discoverable(p_other_profile_id, auth.uid())
    AND public.profiles_have_qualifying_shared_event(auth.uid(), p_other_profile_id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles other_profile
      WHERE other_profile.id = p_other_profile_id
        AND (
          COALESCE(other_profile.event_attendance_visibility, 'attendees') = 'attendees'
          OR (
            COALESCE(other_profile.event_attendance_visibility, 'attendees') = 'matches_only'
            AND EXISTS (
              SELECT 1
              FROM public.matches m
              WHERE (m.profile_id_1 = auth.uid() AND m.profile_id_2 = p_other_profile_id)
                 OR (m.profile_id_2 = auth.uid() AND m.profile_id_1 = p_other_profile_id)
            )
          )
        )
    );
$$;

COMMENT ON FUNCTION public.viewer_shares_event_with_profile(uuid) IS
  'RLS helper for event co-attendee profile visibility. Requires confirmed shared event, discoverability, attendance visibility, and block/report safety.';

CREATE OR REPLACE FUNCTION public.can_view_event_registration_profile(
  p_event_id uuid,
  p_profile_id uuid,
  p_viewer_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p_event_id IS NOT NULL
    AND p_profile_id IS NOT NULL
    AND p_viewer_id IS NOT NULL
    AND (
      p_profile_id = p_viewer_id
      OR public.has_role(p_viewer_id, 'admin'::public.app_role)
      OR (
        NOT public.profiles_have_safety_block(p_profile_id, p_viewer_id)
        AND public.is_profile_discoverable(p_profile_id, p_viewer_id)
        AND public.profiles_have_qualifying_shared_event(p_viewer_id, p_profile_id, p_event_id)
        AND EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = p_profile_id
            AND (
              COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
              OR (
                COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
                AND EXISTS (
                  SELECT 1
                  FROM public.matches m
                  WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_profile_id)
                     OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_profile_id)
                )
              )
            )
        )
      )
    );
$$;

COMMENT ON FUNCTION public.can_view_event_registration_profile(uuid, uuid, uuid) IS
  'RLS helper for event_registrations SELECT. Preserves self/admin reads while hiding disallowed co-attendee profile ids from normal users.';

DROP POLICY IF EXISTS "Users can view registrations for shared events" ON public.event_registrations;
CREATE POLICY "Users can view registrations for shared events"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND public.can_view_event_registration_profile(event_id, profile_id, auth.uid())
);

DROP POLICY IF EXISTS "Users can view matched profiles" ON public.profiles;
CREATE POLICY "Users can view matched profiles"
ON public.profiles
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND profiles.id IS DISTINCT FROM auth.uid()
  AND NOT public.profiles_have_safety_block(profiles.id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE (m.profile_id_1 = auth.uid() AND m.profile_id_2 = profiles.id)
       OR (m.profile_id_2 = auth.uid() AND m.profile_id_1 = profiles.id)
  )
);

DROP POLICY IF EXISTS "Users can view potential matches for Daily Drop" ON public.profiles;
CREATE POLICY "Users can view potential matches for Daily Drop"
ON public.profiles
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND profiles.id IS DISTINCT FROM auth.uid()
  AND public.is_profile_discoverable(profiles.id, auth.uid())
  AND public.check_gender_compatibility(auth.uid(), profiles.gender, profiles.interested_in)
);

DROP POLICY IF EXISTS "Users can view matched users profile vibes" ON public.profile_vibes;
CREATE POLICY "Users can view matched users profile vibes"
ON public.profile_vibes
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND profile_vibes.profile_id IS DISTINCT FROM auth.uid()
  AND NOT public.profiles_have_safety_block(profile_vibes.profile_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE (m.profile_id_1 = auth.uid() AND m.profile_id_2 = profile_vibes.profile_id)
       OR (m.profile_id_2 = auth.uid() AND m.profile_id_1 = profile_vibes.profile_id)
  )
);

CREATE OR REPLACE FUNCTION public.get_profile_for_viewer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_profile RECORD;
  v_vibes text[];
  v_allowed boolean;
  v_is_admin boolean;
BEGIN
  IF v_viewer_id IS NULL OR p_target_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_admin := public.has_role(v_viewer_id, 'admin'::public.app_role);

  IF p_target_id IS DISTINCT FROM v_viewer_id
     AND NOT v_is_admin
     AND public.profiles_have_safety_block(p_target_id, v_viewer_id) THEN
    RETURN NULL;
  END IF;

  v_allowed :=
    public.profile_has_established_access(p_target_id, v_viewer_id)
    OR public.viewer_shares_event_with_profile(p_target_id);

  IF NOT v_allowed THEN
    RETURN NULL;
  END IF;

  SELECT
    p.id,
    p.name,
    p.age,
    p.gender,
    p.tagline,
    p.location,
    p.job,
    p.height_cm,
    p.about_me,
    p.looking_for,
    p.relationship_intent,
    p.photos,
    p.avatar_url,
    p.bunny_video_uid,
    p.bunny_video_status,
    p.vibe_caption,
    p.lifestyle,
    p.prompts,
    p.photo_verified,
    p.vibe_score,
    p.vibe_score_label,
    p.is_premium
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(vt.label ORDER BY vt.label), ARRAY[]::text[])
  INTO v_vibes
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_target_id
    AND vt.label IS NOT NULL
    AND btrim(vt.label) <> '';

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'name', v_profile.name,
    'age', v_profile.age,
    'gender', v_profile.gender,
    'tagline', v_profile.tagline,
    'location', v_profile.location,
    'job', v_profile.job,
    'height_cm', v_profile.height_cm,
    'about_me', v_profile.about_me,
    'looking_for', v_profile.looking_for,
    'relationship_intent', v_profile.relationship_intent,
    'photos', v_profile.photos,
    'avatar_url', v_profile.avatar_url,
    'bunny_video_uid', v_profile.bunny_video_uid,
    'bunny_video_status', v_profile.bunny_video_status,
    'vibe_caption', v_profile.vibe_caption,
    'lifestyle', v_profile.lifestyle,
    'prompts', v_profile.prompts,
    'photo_verified', v_profile.photo_verified,
    'vibe_score', v_profile.vibe_score,
    'vibe_score_label', v_profile.vibe_score_label,
    'is_premium', v_profile.is_premium,
    'vibes', COALESCE(to_jsonb(v_vibes), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Safe profile read for normal app surfaces. Allows self, admin, established relationships, and eligible shared-event discovery only.';

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

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_actor_foregrounded_at timestamptz;
  v_target_foregrounded_at timestamptz;
  v_actor_present boolean := false;
  v_target_present boolean := false;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = p_event_id
      AND (ev.status = 'cancelled' OR ev.archived_at IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('result', 'event_not_active', 'reason', 'cancelled_or_archived');
  END IF;

  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_reports
    WHERE reporter_id = p_actor_id AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'account_paused',
      'message', 'Your profile is currently hidden from discovery'
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_unavailable',
      'message', 'This profile is no longer available'
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_target_id
      AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    v_t0 := clock_timestamp();

    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_actor_status, v_actor_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_actor_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_target_status, v_target_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_target_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    v_actor_present :=
      v_actor_status IN ('browsing', 'idle')
      AND v_actor_foregrounded_at IS NOT NULL
      AND v_actor_foregrounded_at >= now() - interval '60 seconds';

    v_target_present :=
      v_target_status IN ('browsing', 'idle')
      AND v_target_foregrounded_at IS NOT NULL
      AND v_target_foregrounded_at >= now() - interval '60 seconds';

    IF EXISTS (
      SELECT 1
      FROM public.video_sessions z
      WHERE z.event_id = p_event_id
        AND z.ended_at IS NULL
        AND NOT (
          z.participant_1_id = LEAST(p_actor_id, p_target_id)
          AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
        )
        AND (
          z.participant_1_id IN (p_actor_id, p_target_id)
          OR z.participant_2_id IN (p_actor_id, p_target_id)
        )
    ) THEN
      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'conflict',
        'participant_has_active_session_conflict',
        v_ms,
        p_event_id,
        p_actor_id,
        NULL,
        jsonb_build_object('swipe_type', p_swipe_type, 'mutual', true)
      );
      RETURN jsonb_build_object('result', 'participant_has_active_session_conflict');
    END IF;

    INSERT INTO public.video_sessions (
      event_id,
      participant_1_id,
      participant_2_id,
      ready_gate_status,
      ready_gate_expires_at,
      queued_expires_at
    )
    VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE
        WHEN v_actor_present AND v_target_present THEN 'ready'
        ELSE 'queued'
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN now() + interval '30 seconds'
        ELSE NULL
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN NULL
        ELSE now() + interval '10 minutes'
      END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'no_op',
        'already_matched',
        v_ms,
        p_event_id,
        p_actor_id,
        NULL,
        jsonb_build_object('swipe_type', p_swipe_type, 'mutual', true)
      );
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_present AND v_target_present THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_ready_gate',
        current_room_id = v_session_id,
        current_partner_id = CASE
          WHEN profile_id = p_actor_id THEN p_target_id
          ELSE p_actor_id
        END,
        last_active_at = now()
      WHERE event_id = p_event_id
        AND profile_id IN (p_actor_id, p_target_id);

      v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
      PERFORM public.record_event_loop_observability(
        'handle_swipe',
        'success',
        'match_immediate',
        v_ms,
        p_event_id,
        p_actor_id,
        v_session_id,
        jsonb_build_object(
          'swipe_type', p_swipe_type,
          'mutual', true,
          'immediate', true
        )
      );

      RETURN jsonb_build_object(
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    END IF;

    UPDATE public.event_registrations
    SET
      current_room_id = v_session_id,
      current_partner_id = CASE
        WHEN profile_id = p_actor_id THEN p_target_id
        ELSE p_actor_id
      END,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (p_actor_id, p_target_id);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'queued',
      'match_queued',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'immediate', false
      )
    );

    RETURN jsonb_build_object(
      'result', 'match_queued',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id
    );
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;

  RETURN jsonb_build_object('result', 'vibe_recorded');
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_mystery_match(p_event_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;

  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  SELECT er.profile_id INTO v_partner_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.queue_status = 'browsing'
    AND er.profile_id != p_user_id
    AND public.is_profile_discoverable(er.profile_id, p_user_id)
    AND (v_user_interested_in IS NULL OR cardinality(v_user_interested_in) = 0
      OR p.gender = ANY(v_user_interested_in)
      OR (p.gender = 'woman' AND 'women' = ANY(v_user_interested_in))
      OR (p.gender = 'man' AND 'men' = ANY(v_user_interested_in))
      OR (p.gender = 'non-binary' AND 'non-binary' = ANY(v_user_interested_in)))
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0
      OR v_user_gender = ANY(p.interested_in)
      OR (v_user_gender = 'woman' AND 'women' = ANY(p.interested_in))
      OR (v_user_gender = 'man' AND 'men' = ANY(p.interested_in))
      OR (v_user_gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in)))
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
    event_id, participant_1_id, participant_2_id,
    ready_gate_status, ready_gate_expires_at, queued_expires_at
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
  WHERE event_id = p_event_id AND profile_id IN (p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'partner_id', v_partner_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.find_video_date_match(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'deprecated', true,
    'surface', 'find_video_date_match',
    'error', 'deprecated_legacy_queue_surface',
    'message', 'Legacy queue match finder is retired. Use swipe-first flow via handle_swipe + drain_match_queue.'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_visible_attendees(
  p_event_id uuid,
  p_viewer_id uuid
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations er0
    WHERE er0.event_id = p_event_id
      AND er0.profile_id = p_viewer_id
      AND er0.admission_status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT er.profile_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id <> p_viewer_id
    AND public.is_profile_discoverable(er.profile_id, p_viewer_id)
    AND (
      COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
      OR (
        COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
        AND EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE
            (m.profile_id_1 = er.profile_id AND m.profile_id_2 = p_viewer_id)
            OR
            (m.profile_id_2 = er.profile_id AND m.profile_id_1 = p_viewer_id)
        )
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_attendee_preview(
  p_event_id uuid,
  p_viewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_admission text;
  v_total_other_confirmed integer;
  v_visible_count integer;
  v_revealed jsonb;
  v_obscured integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized',
      'code', 'UNAUTHORIZED'
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_total_other_confirmed
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id IS DISTINCT FROM p_viewer_id;

  IF EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND er.admission_status = 'confirmed'
  ) THEN
    v_admission := 'confirmed';
  ELSIF EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_viewer_id
      AND er.admission_status = 'waitlisted'
  ) THEN
    v_admission := 'waitlisted';
  ELSE
    v_admission := 'none';
  END IF;

  IF v_admission <> 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'viewer_admission', v_admission,
      'total_other_confirmed', v_total_other_confirmed,
      'visible_cohort_count', 0,
      'obscured_remaining', 0,
      'revealed', '[]'::jsonb
    );
  END IF;

  WITH visible AS (
    SELECT
      er.profile_id AS pid,
      p.name,
      p.age,
      p.avatar_url,
      p.photos
    FROM public.event_registrations er
    JOIN public.profiles p ON p.id = er.profile_id
    WHERE er.event_id = p_event_id
      AND er.admission_status = 'confirmed'
      AND er.profile_id <> p_viewer_id
      AND public.is_profile_discoverable(er.profile_id, p_viewer_id)
      AND (
        COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
        OR (
          COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
          AND EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE
              (m.profile_id_1 = er.profile_id AND m.profile_id_2 = p_viewer_id)
              OR
              (m.profile_id_2 = er.profile_id AND m.profile_id_1 = p_viewer_id)
          )
        )
      )
  ),
  scored AS (
    SELECT
      v.pid,
      v.name,
      v.age,
      CASE
        WHEN v.avatar_url IS NOT NULL AND btrim(v.avatar_url) <> '' THEN btrim(v.avatar_url)
        WHEN v.photos IS NOT NULL AND COALESCE(cardinality(v.photos), 0) >= 1 THEN v.photos[1]
        ELSE NULL::text
      END AS avatar_path,
      COALESCE((
        SELECT COUNT(*)::integer
        FROM public.profile_vibes pv1
        INNER JOIN public.profile_vibes pv2
          ON pv1.vibe_tag_id = pv2.vibe_tag_id
        WHERE pv1.profile_id = p_viewer_id
          AND pv2.profile_id = v.pid
      ), 0) AS shared_vibe_count,
      EXISTS (
        SELECT 1
        FROM public.event_swipes es
        WHERE es.event_id = p_event_id
          AND es.actor_id = v.pid
          AND es.target_id = p_viewer_id
          AND es.swipe_type = 'super_vibe'
      ) AS super_toward,
      (
        SELECT vt.label
        FROM public.profile_vibes pv
        INNER JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
        WHERE pv.profile_id = v.pid
        ORDER BY vt.label ASC
        LIMIT 1
      ) AS vibe_label
    FROM visible v
  ),
  top2 AS (
    SELECT *
    FROM scored
    ORDER BY shared_vibe_count DESC, super_toward DESC, pid ASC
    LIMIT 2
  )
  SELECT
    (SELECT COUNT(*)::integer FROM visible),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'profile_id', t.pid,
            'name', t.name,
            'age', t.age,
            'avatar_url', t.avatar_path,
            'shared_vibe_count', t.shared_vibe_count,
            'super_vibed_you', t.super_toward,
            'vibe_label', t.vibe_label
          )
          ORDER BY t.shared_vibe_count DESC, t.super_toward DESC, t.pid ASC
        )
        FROM top2 t
      ),
      '[]'::jsonb
    )
  INTO v_visible_count, v_revealed;

  v_obscured := GREATEST(v_visible_count - COALESCE(jsonb_array_length(v_revealed), 0), 0);

  RETURN jsonb_build_object(
    'success', true,
    'viewer_admission', v_admission,
    'total_other_confirmed', v_total_other_confirmed,
    'visible_cohort_count', v_visible_count,
    'obscured_remaining', v_obscured,
    'revealed', v_revealed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_daily_drop_candidates(p_user_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid, name text, age integer, gender text, avatar_url text, photos text[],
  bio text, tagline text, location text, looking_for text, height_cm integer,
  job text, company text, about_me text, prompts jsonb, lifestyle jsonb,
  vibe_caption text, photo_verified boolean, phone_verified boolean,
  bunny_video_status text, vibe_video_status text, interested_in text[]
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.age, p.gender, p.avatar_url, p.photos,
    p.bio, p.tagline, p.location,
    COALESCE(p.relationship_intent, p.looking_for),
    p.height_cm,
    p.job, p.company, p.about_me, p.prompts, p.lifestyle,
    p.vibe_caption, p.photo_verified, p.phone_verified,
    p.bunny_video_status, p.vibe_video_status, p.interested_in
  FROM public.profiles p
  WHERE p.id != p_user_id
    AND public.is_profile_discoverable(p.id, p_user_id)
    AND check_gender_compatibility(p_user_id, p.gender, p.interested_in)
  ORDER BY random()
  LIMIT p_limit;
END;
$function$;

DROP POLICY IF EXISTS "Users can create vibes for events they're registered for" ON public.event_vibes;
CREATE POLICY "Users can create vibes for events they're registered for"
ON public.event_vibes
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND is_registered_for_event(auth.uid(), event_id)
  AND is_registered_for_event(receiver_id, event_id)
  AND public.is_profile_discoverable(receiver_id, sender_id)
  AND public.is_profile_discoverable(sender_id, receiver_id)
);

DROP POLICY IF EXISTS "Users can view own vibes" ON public.event_vibes;
CREATE POLICY "Users can view own vibes"
ON public.event_vibes
FOR SELECT
USING (
  auth.uid() = sender_id
  OR (
    auth.uid() = receiver_id
    AND (
      public.profile_has_established_access(sender_id, auth.uid())
      OR public.is_profile_discoverable(sender_id, auth.uid())
    )
  )
);

GRANT EXECUTE ON FUNCTION public.is_profile_hidden(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profiles_have_safety_block(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profiles_have_qualifying_shared_event(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_profile_discoverable(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_has_established_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.viewer_shares_event_with_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_event_registration_profile(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_mystery_match(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_video_date_match(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_visible_attendees(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_attendee_preview(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_drop_candidates(uuid, integer) TO authenticated, service_role;
