-- Admin user detail read model projection hardening.
--
-- Migration class: schema-only RPC correction.
-- Intent: keep the /kaan user detail SECURITY DEFINER read model explicit
-- instead of serializing the whole profiles row.

CREATE OR REPLACE FUNCTION public.admin_get_user_detail_read_model(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_profile jsonb;
  v_vibes jsonb := '[]'::jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_daily_drops jsonb := '[]'::jsonb;
  v_event_registrations integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'User id is required.');
  END IF;

  SELECT count(*)::integer
  INTO v_event_registrations
  FROM public.event_registrations
  WHERE profile_id = p_user_id;

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'age', p.age,
    'gender', p.gender,
    'birth_date', p.birth_date,
    'interested_in', p.interested_in,
    'tagline', p.tagline,
    'height_cm', p.height_cm,
    'location', p.location,
    'job', p.job,
    'company', p.company,
    'about_me', p.about_me,
    'looking_for', p.looking_for,
    'relationship_intent', p.relationship_intent,
    'photos', p.photos,
    'avatar_url', p.avatar_url,
    'bunny_video_uid', p.bunny_video_uid,
    'bunny_video_status', p.bunny_video_status,
    'vibe_caption', p.vibe_caption,
    'photo_verified', p.photo_verified,
    'email_verified', p.email_verified,
    'verified_email', p.verified_email,
    'is_premium', p.is_premium,
    'premium_until', p.premium_until,
    'is_suspended', p.is_suspended,
    'total_matches', p.total_matches,
    'total_conversations', p.total_conversations,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'event_registrations', v_event_registrations,
    'event_registrations_unavailable', false
  )
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'User profile was not found.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', vt.label,
        'emoji', vt.emoji,
        'category', vt.category
      )
      ORDER BY vt.category ASC NULLS LAST, vt.label ASC
    ),
    '[]'::jsonb
  )
  INTO v_vibes
  FROM public.profile_vibes pv
  JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
  WHERE pv.profile_id = p_user_id;

  WITH user_matches AS (
    SELECT
      m.id,
      m.matched_at,
      m.profile_id_1,
      m.profile_id_2,
      CASE WHEN m.profile_id_1 = p_user_id THEN m.profile_id_2 ELSE m.profile_id_1 END AS other_user_id
    FROM public.matches m
    WHERE m.profile_id_1 = p_user_id OR m.profile_id_2 = p_user_id
    ORDER BY m.matched_at DESC, m.id ASC
    LIMIT 20
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', um.id,
        'matched_at', um.matched_at,
        'profile_id_1', um.profile_id_1,
        'profile_id_2', um.profile_id_2,
        'other_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY um.matched_at DESC, um.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_matches
  FROM user_matches um
  LEFT JOIN public.profiles p ON p.id = um.other_user_id;

  WITH user_drops AS (
    SELECT
      dd.id,
      dd.user_a_id,
      dd.user_b_id,
      dd.status,
      dd.drop_date,
      dd.created_at,
      CASE WHEN dd.user_a_id = p_user_id THEN dd.user_b_id ELSE dd.user_a_id END AS partner_id
    FROM public.daily_drops dd
    WHERE dd.user_a_id = p_user_id OR dd.user_b_id = p_user_id
    ORDER BY dd.created_at DESC, dd.id ASC
    LIMIT 50
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ud.id,
        'user_a_id', ud.user_a_id,
        'user_b_id', ud.user_b_id,
        'status', ud.status,
        'drop_date', ud.drop_date,
        'created_at', ud.created_at,
        'partner_profile', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'avatar_url', p.avatar_url,
          'photos', p.photos
        )
      )
      ORDER BY ud.created_at DESC, ud.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_daily_drops
  FROM user_drops ud
  LEFT JOIN public.profiles p ON p.id = ud.partner_id;

  RETURN public.admin_json_success(jsonb_build_object(
    'profile', v_profile,
    'vibes', v_vibes,
    'matches', v_matches,
    'daily_drops', v_daily_drops
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_user_detail_read_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail_read_model(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507131000',
  'Admin user detail read model projection hardening',
  'schema-only',
  'Redefines one admin read-model RPC with an explicit profiles projection. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_user_detail_read_model(uuid) IS
  'Read-only /kaan user detail drawer read model with explicit profile projection.';
