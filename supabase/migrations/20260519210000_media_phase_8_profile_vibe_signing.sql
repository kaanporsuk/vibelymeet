-- Phase 8.2: expose a signed-playback reference for non-discoverable profile Vibe Videos.
--
-- Public/discovery profile videos keep the existing Bunny Stream UID contract.
-- Private/hidden established-access views receive a durable opaque ref that clients
-- resolve through get-chat-media-url, so HLS manifests and segments can use Bunny
-- advanced directory tokens without changing older profile display fields.

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
  v_vibe_video_signed_playback_required boolean := false;
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

  v_vibe_video_signed_playback_required :=
    p_target_id IS DISTINCT FROM v_viewer_id
    AND NOT v_is_admin
    AND v_profile.bunny_video_uid IS NOT NULL
    AND btrim(v_profile.bunny_video_uid) <> ''
    AND NOT public.is_profile_discoverable(p_target_id, v_viewer_id);

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
    'vibe_video_signed_playback_required', v_vibe_video_signed_playback_required,
    'vibe_video_playback_ref', CASE
      WHEN v_vibe_video_signed_playback_required THEN
        concat('profile_vibe_video:', v_profile.id::text, ':', btrim(v_profile.bunny_video_uid))
      ELSE NULL
    END,
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
  'Canonical safe other-user profile read. Direct public.profiles reads are self-only for normal clients; use this RPC for established/shared-event/admin profile display without private PII. Private/hidden profile Vibe Videos include a profile_vibe_video playback ref for signed HLS resolution.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
