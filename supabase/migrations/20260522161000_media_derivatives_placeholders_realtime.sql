-- Media UX acceleration: durable derivative refs, lightweight placeholders,
-- and sanitized asset readiness broadcasts. Bunny Image Optimizer remains off.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS derivative_thumb_path text,
  ADD COLUMN IF NOT EXISTS derivative_hero_path text,
  ADD COLUMN IF NOT EXISTS placeholder_kind text,
  ADD COLUMN IF NOT EXISTS placeholder_hash text,
  ADD COLUMN IF NOT EXISTS dominant_color text,
  ADD COLUMN IF NOT EXISTS placeholder_updated_at timestamptz;

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_placeholder_kind_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_placeholder_kind_check
  CHECK (
    placeholder_kind IS NULL
    OR placeholder_kind IN ('dominant_color')
  );

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_dominant_color_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_dominant_color_check
  CHECK (
    dominant_color IS NULL
    OR dominant_color ~* '^#[0-9a-f]{6}$'
  );

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_derivative_path_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_derivative_path_check
  CHECK (
    (
      derivative_thumb_path IS NULL
      OR (
        derivative_thumb_path !~ '^/'
        AND position('..' in derivative_thumb_path) = 0
        AND position('://' in derivative_thumb_path) = 0
      )
    )
    AND (
      derivative_hero_path IS NULL
      OR (
        derivative_hero_path !~ '^/'
        AND position('..' in derivative_hero_path) = 0
        AND position('://' in derivative_hero_path) = 0
      )
    )
  );

COMMENT ON COLUMN public.media_assets.derivative_thumb_path IS
  'Optional Bunny Storage thumbnail derivative path generated at upload time.';
COMMENT ON COLUMN public.media_assets.derivative_hero_path IS
  'Optional Bunny Storage medium/hero derivative path generated at upload time.';
COMMENT ON COLUMN public.media_assets.placeholder_kind IS
  'Lightweight placeholder strategy for instant media paint. Bunny Image Optimizer is intentionally not required.';
COMMENT ON COLUMN public.media_assets.placeholder_hash IS
  'Placeholder payload. For dominant_color this mirrors the hex color so clients can render immediately.';
COMMENT ON COLUMN public.media_assets.dominant_color IS
  'Validated #rrggbb dominant/average color used behind media while the real asset decodes.';

CREATE OR REPLACE FUNCTION public.profile_photo_derivatives_for_paths(
  p_owner_user_id uuid,
  p_photo_paths text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH requested AS (
    SELECT DISTINCT btrim(path_value) AS provider_path
    FROM unnest(COALESCE(p_photo_paths, ARRAY[]::text[])) AS paths(path_value)
    WHERE btrim(path_value) <> ''
      AND btrim(path_value) !~ '^/'
      AND position('..' in btrim(path_value)) = 0
      AND position('://' in btrim(path_value)) = 0
  ),
  ranked AS (
    SELECT DISTINCT ON (ma.provider_path)
      ma.provider_path,
      ma.derivative_thumb_path,
      ma.derivative_hero_path,
      ma.placeholder_kind,
      ma.placeholder_hash,
      ma.dominant_color
    FROM public.media_assets ma
    JOIN requested r ON r.provider_path = ma.provider_path
    WHERE ma.owner_user_id = p_owner_user_id
      AND ma.provider = 'bunny_storage'
      AND ma.media_family = 'profile_photo'
      AND ma.status IN ('active', 'uploaded')
      AND (
        ma.derivative_thumb_path IS NOT NULL
        OR ma.derivative_hero_path IS NOT NULL
        OR ma.dominant_color IS NOT NULL
      )
    ORDER BY
      ma.provider_path,
      (ma.status = 'active') DESC,
      ma.updated_at DESC NULLS LAST,
      ma.created_at DESC NULLS LAST
  )
  SELECT COALESCE(
    jsonb_object_agg(
      provider_path,
      jsonb_strip_nulls(jsonb_build_object(
        'thumb', derivative_thumb_path,
        'hero', derivative_hero_path,
        'placeholderKind', CASE WHEN placeholder_kind = 'dominant_color' THEN placeholder_kind ELSE NULL END,
        'placeholderHash', placeholder_hash,
        'dominantColor', dominant_color
      ))
    ),
    '{}'::jsonb
  )
  FROM ranked;
$function$;

COMMENT ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) IS
  'Returns sanitized derivative refs for visible profile photo paths already present in profiles.photos.';

REVOKE ALL ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.media_asset_realtime_topic_is_user(p_topic text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(p_topic, '') ~* '^media:user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;

REVOKE ALL ON FUNCTION public.media_asset_realtime_topic_is_user(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_asset_realtime_topic_is_user(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.media_asset_can_access_user_topic(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_topic text := btrim(COALESCE(p_topic, ''));
  v_user_id uuid := auth.uid();
  v_topic_user_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.media_asset_realtime_topic_is_user(v_topic) THEN
    RETURN false;
  END IF;

  BEGIN
    v_topic_user_id := substring(v_topic from 12)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  RETURN v_topic_user_id = v_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.media_asset_can_access_user_topic(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_asset_can_access_user_topic(text) TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Media asset owners can receive asset broadcasts" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Media asset user broadcast read guard" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "Media asset clients cannot send owner broadcasts" ON realtime.messages';

    EXECUTE $policy$
      CREATE POLICY "Media asset owners can receive asset broadcasts"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND public.media_asset_can_access_user_topic((SELECT realtime.topic()))
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Media asset user broadcast read guard"
      ON realtime.messages
      AS RESTRICTIVE
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(realtime.messages.extension, '') <> 'broadcast'
        OR NOT public.media_asset_realtime_topic_is_user((SELECT realtime.topic()))
        OR public.media_asset_can_access_user_topic((SELECT realtime.topic()))
      )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Media asset clients cannot send owner broadcasts"
      ON realtime.messages
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (
        COALESCE(realtime.messages.extension, '') <> 'broadcast'
        OR NOT public.media_asset_realtime_topic_is_user((SELECT realtime.topic()))
      )
    $policy$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.broadcast_media_asset_event_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.owner_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.provider_object_id IS NOT DISTINCT FROM OLD.provider_object_id
    AND NEW.provider_path IS NOT DISTINCT FROM OLD.provider_path
    AND NEW.derivative_thumb_path IS NOT DISTINCT FROM OLD.derivative_thumb_path
    AND NEW.derivative_hero_path IS NOT DISTINCT FROM OLD.derivative_hero_path
    AND NEW.placeholder_kind IS NOT DISTINCT FROM OLD.placeholder_kind
    AND NEW.placeholder_hash IS NOT DISTINCT FROM OLD.placeholder_hash
    AND NEW.dominant_color IS NOT DISTINCT FROM OLD.dominant_color THEN
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'assetId', NEW.id,
    'mediaFamily', NEW.media_family,
    'status', NEW.status,
    'provider', NEW.provider,
    'hasProviderPath', NEW.provider_path IS NOT NULL,
    'hasProviderObjectId', NEW.provider_object_id IS NOT NULL,
    'derivatives', jsonb_strip_nulls(jsonb_build_object(
      'thumb', NEW.derivative_thumb_path,
      'hero', NEW.derivative_hero_path
    )),
    'placeholder', jsonb_strip_nulls(jsonb_build_object(
      'kind', NEW.placeholder_kind,
      'hash', NEW.placeholder_hash,
      'dominantColor', NEW.dominant_color
    )),
    'updatedAt', NEW.updated_at
  );

  PERFORM realtime.send(
    v_payload,
    'media_asset_event',
    'media:user:' || NEW.owner_user_id::text,
    true
  );

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_media_asset_event_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_media_asset_event_v1() TO service_role;

DROP TRIGGER IF EXISTS broadcast_media_asset_event_v1
  ON public.media_assets;

CREATE TRIGGER broadcast_media_asset_event_v1
AFTER UPDATE ON public.media_assets
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_media_asset_event_v1();

CREATE OR REPLACE FUNCTION public.get_profile_for_viewer(p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_profile RECORD;
  v_vibes text[];
  v_vibe_tags jsonb;
  v_photo_derivatives jsonb := '{}'::jsonb;
  v_allowed boolean;
  v_is_admin boolean;
  v_show_event_count boolean;
  v_distance_label text;
  v_birth_month integer;
  v_birth_day integer;
  v_vibe_video_signed_playback_required boolean := false;
  v_vibe_video_ready boolean := false;
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
    p.vibe_video_captions,
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

  v_photo_derivatives := public.profile_photo_derivatives_for_paths(p_target_id, v_profile.photos);

  v_vibe_video_signed_playback_required :=
    p_target_id IS DISTINCT FROM v_viewer_id
    AND NOT v_is_admin
    AND v_profile.bunny_video_uid IS NOT NULL
    AND btrim(v_profile.bunny_video_uid) <> ''
    AND NOT public.is_profile_discoverable(p_target_id, v_viewer_id);

  v_vibe_video_ready :=
    v_profile.bunny_video_uid IS NOT NULL
    AND btrim(v_profile.bunny_video_uid) <> ''
    AND COALESCE(v_profile.bunny_video_status, '') = 'ready';

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
    'photo_derivatives', COALESCE(v_photo_derivatives, '{}'::jsonb),
    'avatar_url', v_profile.avatar_url,
    'bunny_video_uid', CASE
      WHEN v_vibe_video_signed_playback_required THEN NULL
      ELSE v_profile.bunny_video_uid
    END,
    'bunny_video_status', CASE
      WHEN v_vibe_video_signed_playback_required THEN NULL
      ELSE v_profile.bunny_video_status
    END,
    'vibe_video_signed_playback_required', v_vibe_video_signed_playback_required,
    'vibe_video_playback_ref', CASE
      WHEN v_vibe_video_ready THEN
        concat('profile_vibe_video:', v_profile.id::text, ':', btrim(v_profile.bunny_video_uid))
      ELSE NULL
    END,
    'vibe_caption', v_profile.vibe_caption,
    'vibe_video_captions', CASE
      WHEN v_vibe_video_ready THEN v_profile.vibe_video_captions
      ELSE NULL
    END,
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
$function$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Canonical safe other-user profile read. Includes ready Vibe Video captions and durable profile photo derivative refs while preserving private signed playback masking.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_profile_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_referrer_name text;
  v_photo_derivatives jsonb := '{}'::jsonb;
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

  v_photo_derivatives := public.profile_photo_derivatives_for_paths(v_uid, v_profile.photos);

  RETURN to_jsonb(v_profile)
    || jsonb_build_object(
      'age', CASE
        WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
        ELSE v_profile.age
      END,
      'about_me', COALESCE(v_profile.about_me, v_profile.bio),
      'photo_derivatives', COALESCE(v_photo_derivatives, '{}'::jsonb),
      'photo_verified', COALESCE(v_profile.photo_verified, false),
      'phone_verified', COALESCE(v_profile.phone_verified, false),
      'email_verified', COALESCE(v_profile.email_verified, false),
      'is_premium', COALESCE(v_profile.is_premium, false),
      'account_paused', COALESCE(v_profile.account_paused, false),
      'is_paused', COALESCE(v_profile.is_paused, false),
      'is_suspended', COALESCE(v_profile.is_suspended, false),
      'vibe_video_playback_ref', CASE
        WHEN v_profile.bunny_video_uid IS NOT NULL
          AND btrim(v_profile.bunny_video_uid) <> ''
          AND COALESCE(v_profile.bunny_video_status, '') = 'ready'
        THEN concat('profile_vibe_video:', v_profile.id::text, ':', btrim(v_profile.bunny_video_uid))
        ELSE NULL
      END,
      'referrer_name', v_referrer_name
    );
END;
$function$;

COMMENT ON FUNCTION public.get_my_profile_settings() IS
  'Owner-only profile/settings read path. Includes owner-safe Vibe Video signed playback refs and durable profile photo derivative refs.';

REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_settings() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
