-- Phase 9 completion: captions, E2EE metadata, cold-tiering fields, and access tracking.

CREATE OR REPLACE FUNCTION public.media_captions_jsonb_valid(p_captions jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cue jsonb;
  v_cues jsonb;
BEGIN
  IF p_captions IS NULL THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_captions) = 'string' THEN
    RETURN length(btrim(p_captions #>> '{}')) BETWEEN 1 AND 5000;
  END IF;

  IF jsonb_typeof(p_captions) <> 'object' THEN
    RETURN false;
  END IF;

  IF p_captions ? 'text' THEN
    IF jsonb_typeof(p_captions->'text') <> 'string'
       OR length(btrim(p_captions->>'text')) = 0
       OR length(btrim(p_captions->>'text')) > 5000 THEN
      RETURN false;
    END IF;
  END IF;

  IF p_captions ? 'language' THEN
    IF jsonb_typeof(p_captions->'language') <> 'string'
       OR length(btrim(p_captions->>'language')) > 16
       OR btrim(p_captions->>'language') !~* '^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$' THEN
      RETURN false;
    END IF;
  END IF;

  IF p_captions ? 'cues' THEN
    v_cues := p_captions->'cues';
    IF jsonb_typeof(v_cues) <> 'array' OR jsonb_array_length(v_cues) > 120 THEN
      RETURN false;
    END IF;

    FOR v_cue IN SELECT value FROM jsonb_array_elements(v_cues)
    LOOP
      IF jsonb_typeof(v_cue) <> 'object'
         OR jsonb_typeof(v_cue->'text') IS DISTINCT FROM 'string'
         OR length(btrim(v_cue->>'text')) = 0
         OR length(btrim(v_cue->>'text')) > 1000 THEN
        RETURN false;
      END IF;

      IF v_cue ? 'startMs' AND jsonb_typeof(v_cue->'startMs') IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;
      IF v_cue ? 'endMs' AND jsonb_typeof(v_cue->'endMs') IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;
      IF v_cue ? 'startMs' AND (v_cue->>'startMs')::numeric < 0 THEN
        RETURN false;
      END IF;
      IF v_cue ? 'endMs' AND (v_cue->>'endMs')::numeric < 0 THEN
        RETURN false;
      END IF;
      IF v_cue ? 'startMs'
         AND v_cue ? 'endMs'
         AND (v_cue->>'endMs')::numeric <= (v_cue->>'startMs')::numeric THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  RETURN (p_captions ? 'text') OR (p_captions ? 'cues');
END;
$$;

ALTER TABLE public.chat_vibe_clip_uploads
  ADD COLUMN IF NOT EXISTS encrypted_media jsonb;

ALTER TABLE public.vibe_video_uploads
  ADD COLUMN IF NOT EXISTS captions jsonb;

ALTER TABLE public.profile_vibe_videos
  ADD COLUMN IF NOT EXISTS captions jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vibe_video_captions jsonb,
  ADD COLUMN IF NOT EXISTS encryption_pub_key text;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS encrypted_conversation_keys jsonb;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS storage_zone text NOT NULL DEFAULT 'hot',
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_error text,
  ADD COLUMN IF NOT EXISTS encryption_metadata jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_vibe_clip_uploads_captions_valid'
      AND conrelid = 'public.chat_vibe_clip_uploads'::regclass
  ) THEN
    ALTER TABLE public.chat_vibe_clip_uploads
      ADD CONSTRAINT chat_vibe_clip_uploads_captions_valid
      CHECK (public.media_captions_jsonb_valid(captions));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vibe_video_uploads_captions_valid'
      AND conrelid = 'public.vibe_video_uploads'::regclass
  ) THEN
    ALTER TABLE public.vibe_video_uploads
      ADD CONSTRAINT vibe_video_uploads_captions_valid
      CHECK (public.media_captions_jsonb_valid(captions));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profile_vibe_videos_captions_valid'
      AND conrelid = 'public.profile_vibe_videos'::regclass
  ) THEN
    ALTER TABLE public.profile_vibe_videos
      ADD CONSTRAINT profile_vibe_videos_captions_valid
      CHECK (public.media_captions_jsonb_valid(captions));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_vibe_video_captions_valid'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_vibe_video_captions_valid
      CHECK (public.media_captions_jsonb_valid(vibe_video_captions));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_encryption_pub_key_format'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_encryption_pub_key_format
      CHECK (
        encryption_pub_key IS NULL
        OR encryption_pub_key ~ '^[A-Za-z0-9_-]{43,128}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_assets_storage_zone_check'
      AND conrelid = 'public.media_assets'::regclass
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_storage_zone_check
      CHECK (storage_zone IN ('hot', 'archive'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_encryption_pub_key_present
  ON public.profiles (id)
  WHERE encryption_pub_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_cold_tiering
  ON public.media_assets (last_accessed_at, created_at)
  WHERE status = 'active' AND storage_zone = 'hot';

CREATE OR REPLACE FUNCTION public.mark_media_asset_accessed(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.media_assets
  SET last_accessed_at = now()
  WHERE id = p_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.media_captions_jsonb_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.media_captions_jsonb_valid(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_media_asset_accessed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_media_asset_accessed(uuid) TO service_role;

COMMENT ON COLUMN public.profiles.vibe_video_captions IS
  'Optional structured subtitles for the active profile Vibe Video. vibe_caption remains the short profile overlay.';
COMMENT ON COLUMN public.profiles.encryption_pub_key IS
  'Client-generated Curve25519 public key used to envelope private chat media conversation keys.';
COMMENT ON COLUMN public.matches.encrypted_conversation_keys IS
  'Per-participant encrypted conversation key envelopes for private chat media E2EE.';
COMMENT ON COLUMN public.media_assets.storage_zone IS
  'Bunny storage residency tier: hot or archive. Signed URL resolvers route by this value.';
COMMENT ON COLUMN public.media_assets.last_accessed_at IS
  'Updated when a signed/proxied media URL is issued; cold tiering uses this as its access signal.';

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
$$;

COMMENT ON FUNCTION public.get_profile_for_viewer(uuid) IS
  'Canonical safe other-user profile read. Includes ready Vibe Video captions while preserving private signed playback masking.';

REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_for_viewer(uuid) TO authenticated, service_role;

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

  RETURN to_jsonb(v_profile)
    || jsonb_build_object(
      'age', CASE
        WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
        ELSE v_profile.age
      END,
      'about_me', COALESCE(v_profile.about_me, v_profile.bio),
      'photo_verified', COALESCE(v_profile.photo_verified, false),
      'phone_verified', COALESCE(v_profile.phone_verified, false),
      'email_verified', COALESCE(v_profile.email_verified, false),
      'is_premium', COALESCE(v_profile.is_premium, false),
      'account_paused', COALESCE(v_profile.account_paused, false),
      'is_paused', COALESCE(v_profile.is_paused, false),
      'is_suspended', COALESCE(v_profile.is_suspended, false),
      'referrer_name', v_referrer_name
    );
END;
$$;

COMMENT ON FUNCTION public.get_my_profile_settings() IS
  'Owner-only profile/settings read path. Phase 9 includes vibe_video_captions and encryption_pub_key for the owner.';

REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_settings() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.bunny_cdn_health_state (
  probe text PRIMARY KEY,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_status text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_http_status integer,
  alerted_at timestamptz
);

ALTER TABLE public.bunny_cdn_health_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bunny_cdn_health_state FROM PUBLIC;
REVOKE ALL ON public.bunny_cdn_health_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bunny_cdn_health_state TO service_role;

COMMENT ON TABLE public.bunny_cdn_health_state IS
  'Per-probe consecutive failure state for Phase 9 Bunny CDN synthetic checks.';

DO $$
DECLARE
  v_existing integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Bunny CDN health cron not scheduled: pg_cron or pg_net missing';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'vault'
      AND table_name = 'decrypted_secrets'
  ) THEN
    RAISE NOTICE 'Bunny CDN health cron not scheduled: Vault secrets table missing';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret') THEN
    RAISE NOTICE 'Bunny CDN health cron not scheduled: project_url or cron_secret Vault secret missing';
    RETURN;
  END IF;

  SELECT jobid INTO v_existing
  FROM cron.job
  WHERE jobname = 'bunny-cdn-health-minutely'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing);
  END IF;

  PERFORM cron.schedule(
    'bunny-cdn-health-minutely',
    '* * * * *',
    $cron$
    SELECT net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-bunny-cdn-health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('source', 'pg_cron')
    );
    $cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Bunny CDN health cron not scheduled: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
