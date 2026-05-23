-- Phase 3 placeholder upgrade: allow real blurhash payloads to flow through
-- media_assets, profile photo derivative RPCs, and realtime broadcasts.

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_placeholder_kind_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_placeholder_kind_check
  CHECK (
    placeholder_kind IS NULL
    OR placeholder_kind IN ('dominant_color', 'blurhash')
  );

COMMENT ON COLUMN public.media_assets.placeholder_kind IS
  'Lightweight placeholder strategy for instant media paint. Supports dominant_color and blurhash.';
COMMENT ON COLUMN public.media_assets.placeholder_hash IS
  'Placeholder payload. Hex color for dominant_color, BlurHash string for blurhash.';

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
        OR ma.placeholder_hash IS NOT NULL
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
        'placeholderKind', CASE
          WHEN placeholder_kind IN ('dominant_color', 'blurhash') AND placeholder_hash IS NOT NULL THEN placeholder_kind
          ELSE NULL
        END,
        'placeholderHash', CASE
          WHEN placeholder_kind IN ('dominant_color', 'blurhash') AND placeholder_hash IS NOT NULL THEN placeholder_hash
          ELSE NULL
        END,
        'dominantColor', dominant_color
      ))
    ),
    '{}'::jsonb
  )
  FROM ranked;
$function$;

COMMENT ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) IS
  'Returns sanitized derivative refs and placeholders for visible profile photo paths already present in profiles.photos.';

REVOKE ALL ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_photo_derivatives_for_paths(uuid, text[]) TO service_role;

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
      'kind', CASE
        WHEN NEW.placeholder_kind IN ('dominant_color', 'blurhash') AND NEW.placeholder_hash IS NOT NULL THEN NEW.placeholder_kind
        ELSE NULL
      END,
      'hash', CASE
        WHEN NEW.placeholder_kind IN ('dominant_color', 'blurhash') AND NEW.placeholder_hash IS NOT NULL THEN NEW.placeholder_hash
        ELSE NULL
      END,
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
