-- P0 profile privacy hardening.
--
-- Direct PostgREST reads of public.profiles are now a self-only surface for
-- normal authenticated clients. Other-user profile display must use
-- get_profile_for_viewer(uuid) or a documented safe RPC with its own gates.

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Require authentication for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view matched profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view event participant profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view potential matches for Daily Drop" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;

-- Reset legacy column-level grants from earlier public/discovery eras. Table
-- level REVOKE does not remove column grants, so list the current profile
-- columns explicitly before re-granting the narrow owner projection below.
REVOKE SELECT (
  about_me,
  account_paused,
  account_paused_until,
  activity_status_visibility,
  age,
  avatar_url,
  bio,
  birth_date,
  bunny_video_status,
  bunny_video_uid,
  community_agreed_at,
  company,
  country,
  created_at,
  discoverable,
  discovery_audience,
  discovery_mode,
  discovery_snooze_until,
  distance_visibility,
  email_unsubscribed,
  email_verified,
  event_attendance_visibility,
  event_discovery_prefs,
  events_attended,
  gender,
  height_cm,
  id,
  interested_in,
  is_paused,
  is_premium,
  is_suspended,
  job,
  last_seen_at,
  lifestyle,
  location,
  location_data,
  looking_for,
  name,
  onboarding_complete,
  onboarding_stage,
  pause_reason,
  paused_at,
  paused_until,
  phone_number,
  phone_verified,
  phone_verified_at,
  photo_verification_expires_at,
  photo_verified,
  photo_verified_at,
  photos,
  preferred_age_max,
  preferred_age_min,
  premium_granted_at,
  premium_granted_by,
  premium_until,
  prompts,
  proof_selfie_url,
  referred_by,
  relationship_intent,
  show_online_status,
  subscription_tier,
  suspension_reason,
  tagline,
  total_conversations,
  total_matches,
  updated_at,
  verified_email,
  vibe_caption,
  vibe_score,
  vibe_score_label,
  vibe_video_status
) ON TABLE public.profiles FROM PUBLIC;

REVOKE SELECT (
  about_me,
  account_paused,
  account_paused_until,
  activity_status_visibility,
  age,
  avatar_url,
  bio,
  birth_date,
  bunny_video_status,
  bunny_video_uid,
  community_agreed_at,
  company,
  country,
  created_at,
  discoverable,
  discovery_audience,
  discovery_mode,
  discovery_snooze_until,
  distance_visibility,
  email_unsubscribed,
  email_verified,
  event_attendance_visibility,
  event_discovery_prefs,
  events_attended,
  gender,
  height_cm,
  id,
  interested_in,
  is_paused,
  is_premium,
  is_suspended,
  job,
  last_seen_at,
  lifestyle,
  location,
  location_data,
  looking_for,
  name,
  onboarding_complete,
  onboarding_stage,
  pause_reason,
  paused_at,
  paused_until,
  phone_number,
  phone_verified,
  phone_verified_at,
  photo_verification_expires_at,
  photo_verified,
  photo_verified_at,
  photos,
  preferred_age_max,
  preferred_age_min,
  premium_granted_at,
  premium_granted_by,
  premium_until,
  prompts,
  proof_selfie_url,
  referred_by,
  relationship_intent,
  show_online_status,
  subscription_tier,
  suspension_reason,
  tagline,
  total_conversations,
  total_matches,
  updated_at,
  verified_email,
  vibe_caption,
  vibe_score,
  vibe_score_label,
  vibe_video_status
) ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO service_role;

-- Safe direct owner projection. RLS still limits rows to auth.uid() = id.
-- Private owner-only values such as birth_date, phone_number, verified_email,
-- referred_by, raw coordinates, premium grant dates, proof selfies, suspension
-- details, and activity timestamps are intentionally available only through
-- owner/admin/server RPCs.
GRANT SELECT (
  about_me,
  account_paused,
  account_paused_until,
  age,
  avatar_url,
  bio,
  bunny_video_status,
  bunny_video_uid,
  company,
  country,
  created_at,
  discoverable,
  discovery_audience,
  discovery_mode,
  discovery_snooze_until,
  email_verified,
  event_discovery_prefs,
  gender,
  height_cm,
  id,
  interested_in,
  is_paused,
  is_premium,
  job,
  lifestyle,
  location,
  looking_for,
  name,
  onboarding_complete,
  onboarding_stage,
  pause_reason,
  paused_until,
  phone_verified,
  photo_verified,
  photos,
  preferred_age_max,
  preferred_age_min,
  prompts,
  relationship_intent,
  subscription_tier,
  tagline,
  total_conversations,
  total_matches,
  updated_at,
  vibe_caption,
  vibe_score,
  vibe_score_label,
  vibe_video_status
) ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_profile_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_referrer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.*
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_profile.referred_by IS NOT NULL THEN
    SELECT NULLIF(btrim(p.name), '')
    INTO v_referrer_name
    FROM public.profiles p
    WHERE p.id = v_profile.referred_by;
  END IF;

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'updated_at', v_profile.updated_at,
    'created_at', v_profile.created_at,
    'name', v_profile.name,
    'birth_date', v_profile.birth_date,
    'age', CASE
      WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
      ELSE v_profile.age
    END,
    'gender', v_profile.gender,
    'interested_in', v_profile.interested_in,
    'tagline', v_profile.tagline,
    'height_cm', v_profile.height_cm,
    'location', v_profile.location,
    'country', v_profile.country,
    'job', v_profile.job,
    'company', v_profile.company,
    'about_me', COALESCE(v_profile.about_me, v_profile.bio),
    'bio', v_profile.bio,
    'looking_for', v_profile.looking_for,
    'relationship_intent', v_profile.relationship_intent,
    'onboarding_complete', v_profile.onboarding_complete,
    'onboarding_stage', v_profile.onboarding_stage,
    'lifestyle', v_profile.lifestyle,
    'prompts', v_profile.prompts,
    'photos', v_profile.photos,
    'avatar_url', v_profile.avatar_url,
    'bunny_video_uid', v_profile.bunny_video_uid,
    'bunny_video_status', v_profile.bunny_video_status,
    'vibe_video_status', v_profile.vibe_video_status,
    'vibe_caption', v_profile.vibe_caption,
    'photo_verified', COALESCE(v_profile.photo_verified, false),
    'photo_verified_at', v_profile.photo_verified_at,
    'photo_verification_expires_at', v_profile.photo_verification_expires_at,
    'phone_number', v_profile.phone_number,
    'phone_verified', COALESCE(v_profile.phone_verified, false),
    'phone_verified_at', v_profile.phone_verified_at,
    'email_verified', COALESCE(v_profile.email_verified, false),
    'verified_email', v_profile.verified_email,
    'is_premium', COALESCE(v_profile.is_premium, false),
    'premium_until', v_profile.premium_until,
    'subscription_tier', v_profile.subscription_tier,
    'vibe_score', v_profile.vibe_score,
    'vibe_score_label', v_profile.vibe_score_label,
    'preferred_age_min', v_profile.preferred_age_min,
    'preferred_age_max', v_profile.preferred_age_max,
    'event_discovery_prefs', v_profile.event_discovery_prefs,
    'discoverable', v_profile.discoverable,
    'discovery_mode', v_profile.discovery_mode,
    'discovery_snooze_until', v_profile.discovery_snooze_until,
    'discovery_audience', v_profile.discovery_audience,
    'activity_status_visibility', v_profile.activity_status_visibility,
    'distance_visibility', v_profile.distance_visibility,
    'event_attendance_visibility', v_profile.event_attendance_visibility,
    'show_online_status', v_profile.show_online_status,
    'account_paused', COALESCE(v_profile.account_paused, false),
    'account_paused_until', v_profile.account_paused_until,
    'is_paused', COALESCE(v_profile.is_paused, false),
    'paused_at', v_profile.paused_at,
    'paused_until', v_profile.paused_until,
    'pause_reason', v_profile.pause_reason,
    'is_suspended', COALESCE(v_profile.is_suspended, false),
    'suspension_reason', v_profile.suspension_reason,
    'email_unsubscribed', v_profile.email_unsubscribed,
    'community_agreed_at', v_profile.community_agreed_at,
    'referred_by', v_profile.referred_by,
    'referrer_name', v_referrer_name,
    'events_attended', v_profile.events_attended,
    'total_matches', v_profile.total_matches,
    'total_conversations', v_profile.total_conversations
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_profile_settings() IS
  'Owner-only profile/settings read path for private profile columns whose direct anon/authenticated SELECT grants are revoked. Other-user reads must use get_profile_for_viewer or another documented safe RPC.';

REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_settings() TO authenticated, service_role;

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
  v_vibe_tags jsonb;
  v_allowed boolean;
  v_is_admin boolean;
  v_show_event_count boolean;
  v_distance_label text;
  v_birth_month integer;
  v_birth_day integer;
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
    p.updated_at,
    p.name,
    p.age,
    p.birth_date,
    p.gender,
    p.tagline,
    p.location,
    p.job,
    p.company,
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
    p.email_verified,
    p.phone_verified,
    p.vibe_score,
    p.vibe_score_label,
    p.is_premium,
    p.subscription_tier,
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

  IF v_profile.birth_date IS NOT NULL THEN
    v_birth_month := EXTRACT(MONTH FROM v_profile.birth_date)::integer;
    v_birth_day := EXTRACT(DAY FROM v_profile.birth_date)::integer;
  END IF;

  SELECT
    COALESCE(array_agg(vt.label ORDER BY vt.label), ARRAY[]::text[]),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', vt.id,
          'label', vt.label,
          'emoji', vt.emoji,
          'category', vt.category
        )
        ORDER BY vt.label
      ),
      '[]'::jsonb
    )
  INTO v_vibes, v_vibe_tags
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_target_id
    AND vt.label IS NOT NULL
    AND btrim(vt.label) <> '';

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'updated_at', v_profile.updated_at,
    'name', v_profile.name,
    'age', COALESCE(
      CASE
        WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
        ELSE NULL
      END,
      v_profile.age
    ),
    'zodiac', CASE
      WHEN v_birth_month IS NULL OR v_birth_day IS NULL THEN NULL
      WHEN (v_birth_month = 3 AND v_birth_day >= 21) OR (v_birth_month = 4 AND v_birth_day <= 19) THEN 'Aries'
      WHEN (v_birth_month = 4 AND v_birth_day >= 20) OR (v_birth_month = 5 AND v_birth_day <= 20) THEN 'Taurus'
      WHEN (v_birth_month = 5 AND v_birth_day >= 21) OR (v_birth_month = 6 AND v_birth_day <= 20) THEN 'Gemini'
      WHEN (v_birth_month = 6 AND v_birth_day >= 21) OR (v_birth_month = 7 AND v_birth_day <= 22) THEN 'Cancer'
      WHEN (v_birth_month = 7 AND v_birth_day >= 23) OR (v_birth_month = 8 AND v_birth_day <= 22) THEN 'Leo'
      WHEN (v_birth_month = 8 AND v_birth_day >= 23) OR (v_birth_month = 9 AND v_birth_day <= 22) THEN 'Virgo'
      WHEN (v_birth_month = 9 AND v_birth_day >= 23) OR (v_birth_month = 10 AND v_birth_day <= 22) THEN 'Libra'
      WHEN (v_birth_month = 10 AND v_birth_day >= 23) OR (v_birth_month = 11 AND v_birth_day <= 21) THEN 'Scorpio'
      WHEN (v_birth_month = 11 AND v_birth_day >= 22) OR (v_birth_month = 12 AND v_birth_day <= 21) THEN 'Sagittarius'
      WHEN (v_birth_month = 12 AND v_birth_day >= 22) OR (v_birth_month = 1 AND v_birth_day <= 19) THEN 'Capricorn'
      WHEN (v_birth_month = 1 AND v_birth_day >= 20) OR (v_birth_month = 2 AND v_birth_day <= 18) THEN 'Aquarius'
      ELSE 'Pisces'
    END,
    'gender', v_profile.gender,
    'tagline', v_profile.tagline,
    'location', v_profile.location,
    'display_location', v_profile.location,
    'distance_label', v_distance_label,
    'job', v_profile.job,
    'company', v_profile.company,
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
    'photo_verified', COALESCE(v_profile.photo_verified, false),
    'email_verified', COALESCE(v_profile.email_verified, false),
    'phone_verified', COALESCE(v_profile.phone_verified, false),
    'vibe_score', v_profile.vibe_score,
    'vibe_score_label', v_profile.vibe_score_label,
    'is_premium', v_profile.is_premium,
    'subscription_tier', v_profile.subscription_tier,
    'events_attended', CASE WHEN v_show_event_count THEN v_profile.events_attended ELSE NULL END,
    'total_matches', v_profile.total_matches,
    'total_conversations', v_profile.total_conversations,
    'vibe_tags', COALESCE(v_vibe_tags, '[]'::jsonb),
    'vibes', COALESCE(to_jsonb(v_vibes), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Canonical safe other-user profile read. Direct public.profiles reads are self-only for normal clients; use this RPC for established/shared-event/admin profile display without private PII or backend-owned fields. Includes subscription_tier only as a display badge field.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profiles_for_viewer(p_target_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_target_ids uuid[] := COALESCE(p_target_ids, ARRAY[]::uuid[]);
  v_count integer := COALESCE(cardinality(p_target_ids), 0);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_count > 100 THEN
    RAISE EXCEPTION 'Too many profile ids requested'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(profile_json ORDER BY ord), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ids.ord,
      public.get_profile_for_viewer(ids.target_id) AS profile_json
    FROM unnest(v_target_ids) WITH ORDINALITY AS ids(target_id, ord)
    WHERE ids.target_id IS NOT NULL
  ) safe_profiles
  WHERE profile_json IS NOT NULL;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_profiles_for_viewer(uuid[]) IS
  'Batch wrapper for canonical safe profile display reads. Preserves one network call for list surfaces while each row still passes get_profile_for_viewer access, safety-block, and masking rules.';

REVOKE ALL ON FUNCTION public.get_profiles_for_viewer(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profiles_for_viewer(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_for_viewer(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_event_attendees(
  p_event_id uuid,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event id is required.');
  END IF;

  WITH filtered AS (
    SELECT
      er.id,
      er.registered_at,
      er.admission_status,
      er.attended,
      er.attendance_marked,
      er.profile_id,
      p.id AS joined_profile_id,
      p.name,
      p.age,
      p.gender,
      p.avatar_url,
      p.email_verified,
      p.photo_verified
    FROM public.event_registrations er
    LEFT JOIN public.profiles p ON p.id = er.profile_id
    WHERE er.event_id = p_event_id
      AND (
        v_search IS NULL
        OR position(lower(v_search) in lower(COALESCE(p.name, ''))) > 0
      )
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'registered_at', f.registered_at,
          'admission_status', f.admission_status,
          'attended', f.attended,
          'attendance_marked', f.attendance_marked,
          'profile_id', f.profile_id,
          'profiles', CASE
            WHEN f.joined_profile_id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id', f.joined_profile_id,
              'name', f.name,
              'age', f.age,
              'gender', f.gender,
              'avatar_url', f.avatar_url,
              'email_verified', f.email_verified,
              'photo_verified', f.photo_verified
            )
          END
        )
        ORDER BY f.registered_at DESC, f.id DESC
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  INTO v_rows, v_total
  FROM filtered f;

  RETURN public.admin_json_success(jsonb_build_object(
    'registrations', v_rows,
    'total_count', COALESCE(v_total, 0)
  ));
END;
$$;

COMMENT ON FUNCTION public.admin_list_event_attendees(uuid, text) IS
  'Admin-only event attendee read model. Keeps /kaan attendee roster off direct browser profiles embeds after profile direct SELECT hardening.';

REVOKE ALL ON FUNCTION public.admin_list_event_attendees(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_event_attendees(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_event_attendees(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
