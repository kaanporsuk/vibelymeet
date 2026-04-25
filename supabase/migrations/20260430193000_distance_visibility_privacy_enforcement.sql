-- Distance visibility privacy enforcement, Stage 1.
--
-- Additive/compatible rollout only:
-- 1. Add backend contracts clients can move to before any column revoke.
-- 2. Make distance_visibility truthful on safe profile RPC reads.
-- 3. Keep direct profiles.location_data SELECT available temporarily for
--    already-deployed web/native self-location reads.
--
-- Stage 2 final enforcement lives in supabase/pending_migrations and must not
-- be moved into supabase/migrations until the client rollout/min-version plan is
-- complete.

CREATE OR REPLACE FUNCTION public.profile_location_coord(
  p_location_data jsonb,
  p_key text
) RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_raw text;
  v_coord double precision;
BEGIN
  IF p_location_data IS NULL OR jsonb_typeof(p_location_data) <> 'object' THEN
    RETURN NULL;
  END IF;

  IF p_key NOT IN ('lat', 'lng') THEN
    RETURN NULL;
  END IF;

  v_raw := NULLIF(btrim(p_location_data ->> p_key), '');
  IF v_raw IS NULL OR v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;

  v_coord := v_raw::double precision;

  IF p_key = 'lat' AND (v_coord < -90 OR v_coord > 90) THEN
    RETURN NULL;
  END IF;

  IF p_key = 'lng' AND (v_coord < -180 OR v_coord > 180) THEN
    RETURN NULL;
  END IF;

  RETURN v_coord;
END;
$$;

COMMENT ON FUNCTION public.profile_location_coord(jsonb, text) IS
  'Internal coordinate parser with numeric/range validation. Does not read table data.';

REVOKE ALL ON FUNCTION public.profile_location_coord(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_location_coord(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.profile_location_coord(jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_location_data()
RETURNS TABLE(
  location_data jsonb,
  location text,
  country text,
  lat double precision,
  lng double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.location_data,
    p.location,
    p.country,
    public.profile_location_coord(p.location_data, 'lat') AS lat,
    public.profile_location_coord(p.location_data, 'lng') AS lng
  FROM public.profiles p
  WHERE p.id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.get_my_location_data() IS
  'Self-only exact location read for signed-in clients. Does not accept a profile id and never returns another user row.';

REVOKE ALL ON FUNCTION public.get_my_location_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_location_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_location_data() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profile_distance_label_for_viewer(
  p_target_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_is_admin boolean;
  v_allowed boolean;
  v_viewer_location jsonb;
  v_target RECORD;
  v_viewer_lat double precision;
  v_viewer_lng double precision;
  v_target_lat double precision;
  v_target_lng double precision;
  v_distance_km double precision;
BEGIN
  IF v_viewer_id IS NULL OR p_target_id IS NULL OR p_target_id = v_viewer_id THEN
    RETURN NULL;
  END IF;

  v_is_admin := public.has_role(v_viewer_id, 'admin'::public.app_role);

  IF NOT v_is_admin AND public.profiles_have_safety_block(p_target_id, v_viewer_id) THEN
    RETURN NULL;
  END IF;

  v_allowed :=
    v_is_admin
    OR public.profile_has_established_access(p_target_id, v_viewer_id)
    OR public.viewer_shares_event_with_profile(p_target_id);

  IF NOT v_allowed THEN
    RETURN NULL;
  END IF;

  SELECT
    p.location_data,
    COALESCE(p.distance_visibility, 'approximate') AS distance_visibility,
    COALESCE(p.show_distance, true) AS show_distance
  INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_target.distance_visibility = 'hidden' OR v_target.show_distance = false THEN
    RETURN NULL;
  END IF;

  SELECT p.location_data
  INTO v_viewer_location
  FROM public.profiles p
  WHERE p.id = v_viewer_id;

  v_viewer_lat := public.profile_location_coord(v_viewer_location, 'lat');
  v_viewer_lng := public.profile_location_coord(v_viewer_location, 'lng');
  v_target_lat := public.profile_location_coord(v_target.location_data, 'lat');
  v_target_lng := public.profile_location_coord(v_target.location_data, 'lng');

  IF v_viewer_lat IS NULL OR v_viewer_lng IS NULL OR v_target_lat IS NULL OR v_target_lng IS NULL THEN
    RETURN NULL;
  END IF;

  v_distance_km := public.haversine_distance(v_viewer_lat, v_viewer_lng, v_target_lat, v_target_lng);

  IF v_distance_km IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN CASE
    WHEN v_distance_km < 5 THEN '<5 km'
    WHEN v_distance_km < 10 THEN '5-10 km'
    WHEN v_distance_km < 25 THEN '10-25 km'
    WHEN v_distance_km < 50 THEN '25-50 km'
    ELSE '50+ km'
  END;
END;
$$;

COMMENT ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) IS
  'Returns only a coarse backend-computed user-to-user distance bucket for auth.uid() -> target. Returns null for hidden distance, self, blocked pairs, inaccessible profiles, or missing/malformed coordinates.';

REVOKE ALL ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profile_for_viewer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_profile RECORD;
  v_vibes text[];
  v_allowed boolean;
  v_is_admin boolean;
  v_show_event_count boolean;
  v_distance_label text;
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
    p.is_premium,
    p.events_attended,
    p.total_matches,
    p.total_conversations
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_show_event_count :=
    p_target_id = v_viewer_id
    OR v_is_admin
    OR public.profile_event_attendance_visible_to_viewer(p_target_id, v_viewer_id);

  v_distance_label := public.get_profile_distance_label_for_viewer(p_target_id);

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
    'display_location', v_profile.location,
    'distance_label', v_distance_label,
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
    'events_attended', CASE WHEN v_show_event_count THEN v_profile.events_attended ELSE NULL END,
    'total_matches', v_profile.total_matches,
    'total_conversations', v_profile.total_conversations,
    'vibes', COALESCE(to_jsonb(v_vibes), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Safe profile read for app surfaces. Allows self, admin, established relationships, and eligible shared-event discovery; masks events_attended and returns only backend-computed coarse distance_label, never location_data or raw coordinates.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
