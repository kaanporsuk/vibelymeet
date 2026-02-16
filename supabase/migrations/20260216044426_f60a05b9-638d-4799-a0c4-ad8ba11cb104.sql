
-- Migrate expired signed URLs to raw storage paths in profiles.photos and profiles.avatar_url
-- This is idempotent: paths that are already raw (don't start with 'http') are left untouched.

-- Create a helper function to extract raw path from a Supabase storage URL
CREATE OR REPLACE FUNCTION public.extract_storage_path(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  path_start int;
  query_start int;
  result text;
BEGIN
  -- Already a raw path
  IF url IS NULL OR url = '' OR NOT (url LIKE 'http%') THEN
    RETURN url;
  END IF;

  -- Handle signed URLs: .../object/sign/profile-photos/...
  path_start := position('/object/sign/profile-photos/' in url);
  IF path_start > 0 THEN
    result := substring(url from path_start + length('/object/sign/profile-photos/'));
    query_start := position('?' in result);
    IF query_start > 0 THEN
      result := substring(result from 1 for query_start - 1);
    END IF;
    RETURN result;
  END IF;

  -- Handle public URLs: .../object/public/profile-photos/...
  path_start := position('/object/public/profile-photos/' in url);
  IF path_start > 0 THEN
    result := substring(url from path_start + length('/object/public/profile-photos/'));
    query_start := position('?' in result);
    IF query_start > 0 THEN
      result := substring(result from 1 for query_start - 1);
    END IF;
    RETURN result;
  END IF;

  -- Not a recognized storage URL, return as-is
  RETURN url;
END;
$$;

-- Update profiles.photos array
UPDATE public.profiles
SET photos = (
  SELECT array_agg(public.extract_storage_path(unnested))
  FROM unnest(photos) AS unnested
)
WHERE photos IS NOT NULL
  AND array_length(photos, 1) > 0
  AND EXISTS (
    SELECT 1 FROM unnest(photos) AS p WHERE p LIKE '%supabase.co/storage/v1/object/%profile-photos/%'
  );

-- Update profiles.avatar_url
UPDATE public.profiles
SET avatar_url = public.extract_storage_path(avatar_url)
WHERE avatar_url IS NOT NULL
  AND avatar_url LIKE '%supabase.co/storage/v1/object/%profile-photos/%';

-- Drop the helper function (one-time use)
DROP FUNCTION IF EXISTS public.extract_storage_path(text);
