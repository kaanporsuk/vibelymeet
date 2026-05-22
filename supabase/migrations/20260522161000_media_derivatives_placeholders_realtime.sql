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
