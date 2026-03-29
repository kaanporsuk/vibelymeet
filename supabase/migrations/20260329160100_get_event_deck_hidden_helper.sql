DROP FUNCTION IF EXISTS public.get_event_deck(uuid, uuid, integer);

-- Prefer profiles.about_me (canonical bio text); fall back to legacy bio column.
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
