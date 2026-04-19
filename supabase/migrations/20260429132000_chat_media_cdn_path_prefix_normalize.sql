-- Chat media lifecycle: normalize Bunny CDN URLs that include a pull-zone path prefix.
--
-- If BUNNY_CDN_PATH_PREFIX is configured for Edge Functions / clients, set the
-- matching database setting so sync_chat_message_media can strip it back to the
-- Bunny Storage object path:
--
--   ALTER DATABASE postgres SET app.bunny_cdn_path_prefix = '<prefix>';

CREATE OR REPLACE FUNCTION public.normalize_media_provider_path(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_value text := NULLIF(trim(COALESCE(p_value, '')), '');
  v_prefix text := NULLIF(
    trim(BOTH '/' FROM COALESCE(current_setting('app.bunny_cdn_path_prefix', true), '')),
    ''
  );
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := regexp_replace(v_value, '[?#].*$', '');

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+/', '');
  END IF;

  v_value := regexp_replace(v_value, '^/+', '');

  IF v_prefix IS NOT NULL AND left(v_value, length(v_prefix) + 1) = v_prefix || '/' THEN
    v_value := substring(v_value FROM length(v_prefix) + 2);
  END IF;

  v_value := regexp_replace(v_value, '^/+', '');

  IF strpos(v_value, '..') > 0 THEN
    RETURN NULL;
  END IF;

  IF v_value LIKE 'photos/%'
     OR v_value LIKE 'chat-videos/%'
     OR v_value LIKE 'voice/%' THEN
    RETURN v_value;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_media_provider_path(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.extract_chat_image_path_from_content(
  p_content text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_content text := trim(COALESCE(p_content, ''));
  v_raw text;
BEGIN
  IF v_content = '' THEN
    RETURN NULL;
  END IF;

  IF v_content LIKE '__IMAGE__|%' THEN
    v_raw := trim(substring(v_content FROM length('__IMAGE__|') + 1));
    RETURN public.normalize_media_provider_path(v_raw);
  END IF;

  IF v_content ~* '^https?://\\S+$'
     AND v_content ~* '\\.(jpe?g|png|gif|webp)([?#].*)?$' THEN
    RETURN public.normalize_media_provider_path(v_content);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_chat_image_path_from_content(text) FROM PUBLIC;
