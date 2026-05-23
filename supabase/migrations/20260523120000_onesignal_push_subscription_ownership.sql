-- OneSignal subscription ownership hardening.
--
-- The legacy notification_preferences columns remain for compatibility and
-- health UI, but this table supports multiple native/web subscriptions per
-- user and prevents a physical device subscription from staying attached to
-- a previous account after account switching.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'onesignal',
  subscription_id text NOT NULL,
  platform text NOT NULL DEFAULT 'native',
  subscribed boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_provider_check CHECK (provider = 'onesignal'),
  CONSTRAINT push_subscriptions_platform_check CHECK (platform IN ('web', 'ios', 'android', 'native', 'unknown')),
  CONSTRAINT push_subscriptions_subscription_id_not_blank CHECK (btrim(subscription_id) <> '')
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can view own push subscriptions"
ON public.push_subscriptions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public.push_subscriptions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_onesignal_subscription_unique
  ON public.push_subscriptions (provider, subscription_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_provider_subscribed
  ON public.push_subscriptions (user_id, provider, subscribed)
  WHERE subscribed = true;

CREATE OR REPLACE FUNCTION public.notification_preferences_onesignal_subscription_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.onesignal_player_id := NULLIF(btrim(COALESCE(NEW.onesignal_player_id, '')), '');
  NEW.mobile_onesignal_player_id := NULLIF(btrim(COALESCE(NEW.mobile_onesignal_player_id, '')), '');

  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.onesignal_player_id IS NOT NULL THEN
    UPDATE public.notification_preferences
    SET
      onesignal_player_id = NULL,
      onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id <> NEW.user_id
      AND onesignal_player_id = NEW.onesignal_player_id;
  END IF;

  IF NEW.mobile_onesignal_player_id IS NOT NULL THEN
    UPDATE public.notification_preferences
    SET
      mobile_onesignal_player_id = NULL,
      mobile_onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id <> NEW.user_id
      AND mobile_onesignal_player_id = NEW.mobile_onesignal_player_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_preferences_onesignal_subscription_dedupe
  ON public.notification_preferences;
CREATE TRIGGER notification_preferences_onesignal_subscription_dedupe
BEFORE INSERT OR UPDATE OF onesignal_player_id, mobile_onesignal_player_id
ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.notification_preferences_onesignal_subscription_dedupe();

CREATE OR REPLACE FUNCTION public.normalize_onesignal_push_platform(p_platform text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(COALESCE(p_platform, 'native')))
    WHEN 'web' THEN 'web'
    WHEN 'ios' THEN 'ios'
    WHEN 'android' THEN 'android'
    WHEN 'native' THEN 'native'
    ELSE 'unknown'
  END
$$;

CREATE OR REPLACE FUNCTION public.register_onesignal_push_subscription(
  p_subscription_id text,
  p_platform text DEFAULT 'native',
  p_subscribed boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subscription_id text := NULLIF(btrim(COALESCE(p_subscription_id, '')), '');
  v_platform text := public.normalize_onesignal_push_platform(p_platform);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'register_onesignal_push_subscription requires an authenticated user'
      USING ERRCODE = '28000';
  END IF;

  IF v_subscription_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    provider,
    subscription_id,
    platform,
    subscribed,
    last_seen_at,
    updated_at
  )
  VALUES (
    v_user_id,
    'onesignal',
    v_subscription_id,
    v_platform,
    COALESCE(p_subscribed, false),
    now(),
    now()
  )
  ON CONFLICT (provider, subscription_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    subscribed = EXCLUDED.subscribed,
    last_seen_at = now(),
    updated_at = now();

  INSERT INTO public.notification_preferences (
    user_id,
    onesignal_player_id,
    onesignal_subscribed,
    mobile_onesignal_player_id,
    mobile_onesignal_subscribed
  )
  VALUES (
    v_user_id,
    CASE WHEN v_platform = 'web' THEN v_subscription_id ELSE NULL END,
    CASE WHEN v_platform = 'web' THEN COALESCE(p_subscribed, false) ELSE false END,
    CASE WHEN v_platform <> 'web' THEN v_subscription_id ELSE NULL END,
    CASE WHEN v_platform <> 'web' THEN COALESCE(p_subscribed, false) ELSE false END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    onesignal_player_id = CASE
      WHEN v_platform = 'web' THEN v_subscription_id
      ELSE public.notification_preferences.onesignal_player_id
    END,
    onesignal_subscribed = CASE
      WHEN v_platform = 'web' THEN COALESCE(p_subscribed, false)
      ELSE public.notification_preferences.onesignal_subscribed
    END,
    mobile_onesignal_player_id = CASE
      WHEN v_platform <> 'web' THEN v_subscription_id
      ELSE public.notification_preferences.mobile_onesignal_player_id
    END,
    mobile_onesignal_subscribed = CASE
      WHEN v_platform <> 'web' THEN COALESCE(p_subscribed, false)
      ELSE public.notification_preferences.mobile_onesignal_subscribed
    END,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_onesignal_push_subscription(
  p_subscription_id text DEFAULT NULL,
  p_platform text DEFAULT 'native'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_subscription_id text := NULLIF(btrim(COALESCE(p_subscription_id, '')), '');
  v_platform text := public.normalize_onesignal_push_platform(p_platform);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unregister_onesignal_push_subscription requires an authenticated user'
      USING ERRCODE = '28000';
  END IF;

  IF v_subscription_id IS NOT NULL THEN
    DELETE FROM public.push_subscriptions
    WHERE user_id = v_user_id
      AND provider = 'onesignal'
      AND subscription_id = v_subscription_id
      AND (v_platform = 'unknown' OR platform = v_platform OR (v_platform = 'native' AND platform IN ('ios', 'android', 'native')));
  END IF;

  IF v_platform = 'web' THEN
    UPDATE public.notification_preferences
    SET
      onesignal_player_id = NULL,
      onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND (v_subscription_id IS NULL OR onesignal_player_id = v_subscription_id);
  ELSE
    UPDATE public.notification_preferences
    SET
      mobile_onesignal_player_id = NULL,
      mobile_onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND (v_subscription_id IS NULL OR mobile_onesignal_player_id = v_subscription_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.unregister_onesignal_push_subscription(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text) TO authenticated;

INSERT INTO public.push_subscriptions (user_id, provider, subscription_id, platform, subscribed, last_seen_at, updated_at)
SELECT user_id, 'onesignal', btrim(onesignal_player_id), 'web', COALESCE(onesignal_subscribed, false), now(), now()
FROM public.notification_preferences
WHERE NULLIF(btrim(COALESCE(onesignal_player_id, '')), '') IS NOT NULL
ON CONFLICT (provider, subscription_id) DO UPDATE
SET
  user_id = EXCLUDED.user_id,
  platform = EXCLUDED.platform,
  subscribed = EXCLUDED.subscribed,
  last_seen_at = now(),
  updated_at = now();

INSERT INTO public.push_subscriptions (user_id, provider, subscription_id, platform, subscribed, last_seen_at, updated_at)
SELECT user_id, 'onesignal', btrim(mobile_onesignal_player_id), 'native', COALESCE(mobile_onesignal_subscribed, false), now(), now()
FROM public.notification_preferences
WHERE NULLIF(btrim(COALESCE(mobile_onesignal_player_id, '')), '') IS NOT NULL
ON CONFLICT (provider, subscription_id) DO UPDATE
SET
  user_id = EXCLUDED.user_id,
  platform = EXCLUDED.platform,
  subscribed = EXCLUDED.subscribed,
  last_seen_at = now(),
  updated_at = now();

NOTIFY pgrst, 'reload schema';
