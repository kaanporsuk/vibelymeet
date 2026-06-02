-- Definitive permission-flow hardening across storage access, push subscription
-- ownership mirrors, location RPC grants, and video-date readiness matching.

BEGIN;

-- Private media buckets must stay private. Playback should flow through
-- authenticated RLS or signed/server-generated URLs, never public bucket reads.
UPDATE storage.buckets
SET public = false
WHERE id IN ('chat-videos', 'profile-photos', 'vibe-videos');

-- Remove historical broad/public read policies.
DROP POLICY IF EXISTS "Anon can view chat videos for playback" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view chat videos" ON storage.objects;

DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;

DROP POLICY IF EXISTS "Vibe videos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view vibe videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view vibe video intros" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload videos" ON storage.objects;

-- Chat video objects are keyed by match id. Only members of that match may read.
DROP POLICY IF EXISTS "Match members can view chat videos" ON storage.objects;
CREATE POLICY "Match members can view chat videos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-videos'
  AND (storage.foldername(name))[1] IN (
    SELECT m.id::text
    FROM public.matches m
    WHERE m.profile_id_1 = auth.uid()
       OR m.profile_id_2 = auth.uid()
  )
);

-- Recreate profile-photo read policy with UUID-shape validation before casting.
DROP POLICY IF EXISTS "Users can view accessible profile photos" ON storage.objects;
CREATE POLICY "Users can view accessible profile photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_view_profile_photo((storage.foldername(name))[1]::uuid)
);

-- Keep vibe-video visibility scoped to self/matches, and never expose internal
-- review/private folders to matched viewers.
DROP POLICY IF EXISTS "Users can view their own files" ON storage.objects;
CREATE POLICY "Users can view their own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vibe-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can view matched users files" ON storage.objects;
CREATE POLICY "Users can view matched users files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vibe-videos'
  AND COALESCE((storage.foldername(name))[2], '') !~* '^(moderation|admin-review|private|flagged)$'
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE (
      m.profile_id_1 = auth.uid()
      AND m.profile_id_2::text = (storage.foldername(name))[1]
    )
    OR (
      m.profile_id_2 = auth.uid()
      AND m.profile_id_1::text = (storage.foldername(name))[1]
    )
  )
);

DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
CREATE POLICY "Users can upload their own files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vibe-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND COALESCE((storage.foldername(name))[2], '') !~* '^(moderation|admin-review|private|flagged)$'
);

DROP POLICY IF EXISTS "Users can upload their own vibe videos" ON storage.objects;
CREATE POLICY "Users can upload their own vibe videos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vibe-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND COALESCE((storage.foldername(name))[2], '') !~* '^(moderation|admin-review|private|flagged)$'
);

-- Post-onboarding location writes are authenticated only. The function already
-- verifies p_user_id = auth.uid(), but anon/PUBLIC grants should not exist.
REVOKE ALL ON FUNCTION public.update_profile_location(uuid, text, double precision, double precision, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_profile_location(uuid, text, double precision, double precision, text)
  TO authenticated, service_role;

-- Keep warning readiness as a client-observed state, not a matchable runtime
-- state. This closes historical queue SQL that considered ('ready','warning')
-- eligible by ensuring stored runtime rows never remain at warning.
CREATE OR REPLACE FUNCTION public.normalize_event_runtime_readiness_for_pairing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.readiness_status = 'warning' THEN
    NEW.device_capabilities :=
      COALESCE(NEW.device_capabilities, '{}'::jsonb)
      || jsonb_build_object(
        'client_reported_readiness_status', 'warning',
        'server_normalized_readiness_status', 'unchecked'
      );
    NEW.readiness_status := 'unchecked';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_event_runtime_readiness_for_pairing()
  TO service_role;

DROP TRIGGER IF EXISTS normalize_event_runtime_readiness_for_pairing
  ON public.event_participant_runtime_state;
CREATE TRIGGER normalize_event_runtime_readiness_for_pairing
BEFORE INSERT OR UPDATE OF readiness_status
ON public.event_participant_runtime_state
FOR EACH ROW
EXECUTE FUNCTION public.normalize_event_runtime_readiness_for_pairing();

UPDATE public.event_participant_runtime_state
SET
  readiness_status = 'unchecked',
  device_capabilities =
    COALESCE(device_capabilities, '{}'::jsonb)
    || jsonb_build_object(
      'client_reported_readiness_status', 'warning',
      'server_normalized_readiness_status', 'unchecked'
    ),
  updated_at = now()
WHERE readiness_status = 'warning';

-- Direct client writes to legacy OneSignal mirror columns can desynchronize
-- ownership and delivery. Only service-role maintenance or the definer RPCs
-- below may touch those compatibility mirrors.
CREATE OR REPLACE FUNCTION public.prevent_direct_onesignal_legacy_mirror_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_authorized boolean :=
    auth.role() = 'service_role'
    OR current_setting('vibely.onesignal_rpc_write', true) = 'on';
  v_touched boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_touched :=
      NULLIF(btrim(COALESCE(NEW.onesignal_player_id, '')), '') IS NOT NULL
      OR COALESCE(NEW.onesignal_subscribed, false) IS TRUE
      OR NULLIF(btrim(COALESCE(NEW.mobile_onesignal_player_id, '')), '') IS NOT NULL
      OR COALESCE(NEW.mobile_onesignal_subscribed, false) IS TRUE;
  ELSE
    v_touched :=
      NEW.onesignal_player_id IS DISTINCT FROM OLD.onesignal_player_id
      OR COALESCE(NEW.onesignal_subscribed, false) IS DISTINCT FROM COALESCE(OLD.onesignal_subscribed, false)
      OR NEW.mobile_onesignal_player_id IS DISTINCT FROM OLD.mobile_onesignal_player_id
      OR COALESCE(NEW.mobile_onesignal_subscribed, false) IS DISTINCT FROM COALESCE(OLD.mobile_onesignal_subscribed, false);
  END IF;

  IF v_touched AND NOT v_authorized THEN
    RAISE EXCEPTION 'legacy OneSignal mirror columns are managed by push subscription RPCs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_direct_onesignal_legacy_mirror_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_direct_onesignal_legacy_mirror_write()
  TO service_role;

DROP TRIGGER IF EXISTS prevent_direct_onesignal_legacy_mirror_write
  ON public.notification_preferences;
CREATE TRIGGER prevent_direct_onesignal_legacy_mirror_write
BEFORE INSERT OR UPDATE OF
  onesignal_player_id,
  onesignal_subscribed,
  mobile_onesignal_player_id,
  mobile_onesignal_subscribed
ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.prevent_direct_onesignal_legacy_mirror_write();

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

  PERFORM set_config('vibely.onesignal_rpc_write', 'on', true);

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

  IF v_subscription_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_id = v_user_id
    AND provider = 'onesignal'
    AND subscription_id = v_subscription_id
    AND (
      v_platform = 'unknown'
      OR platform = v_platform
      OR (v_platform IN ('ios', 'android', 'native') AND platform IN ('ios', 'android', 'native'))
    );

  PERFORM set_config('vibely.onesignal_rpc_write', 'on', true);

  IF v_platform = 'web' THEN
    UPDATE public.notification_preferences
    SET
      onesignal_player_id = NULL,
      onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND onesignal_player_id = v_subscription_id;
  ELSE
    UPDATE public.notification_preferences
    SET
      mobile_onesignal_player_id = NULL,
      mobile_onesignal_subscribed = false,
      updated_at = now()
    WHERE user_id = v_user_id
      AND mobile_onesignal_player_id = v_subscription_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_onesignal_push_subscription(text, text, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.unregister_onesignal_push_subscription(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_onesignal_push_subscription(text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
