-- Vibe Video final hardening:
-- profiles.bunny_video_uid / bunny_video_status / legacy vibe_video_status are
-- backend-owned compatibility mirrors. Captions remain user-editable.

CREATE OR REPLACE FUNCTION public.protect_backend_owned_vibe_video_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.bunny_video_uid IS NOT DISTINCT FROM OLD.bunny_video_uid
     AND NEW.bunny_video_status IS NOT DISTINCT FROM OLD.bunny_video_status
     AND NEW.vibe_video_status IS NOT DISTINCT FROM OLD.vibe_video_status THEN
    RETURN NEW;
  END IF;

  IF current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
     OR current_setting('vibely.onboarding_server_update', true) = '1'
     OR current_setting('vibely.vibe_video_server_update', true) = '1' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Vibe Video profile fields are backend-owned'
    USING ERRCODE = '42501',
          HINT = 'Use create-video-upload, video-webhook, delete-vibe-video, or trusted server RPCs.';
END;
$$;

DROP TRIGGER IF EXISTS protect_backend_owned_vibe_video_profile_fields ON public.profiles;

CREATE TRIGGER protect_backend_owned_vibe_video_profile_fields
  BEFORE UPDATE OF bunny_video_uid, bunny_video_status, vibe_video_status
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_backend_owned_vibe_video_profile_fields();

COMMENT ON FUNCTION public.protect_backend_owned_vibe_video_profile_fields() IS
  'Blocks normal authenticated clients from directly mutating backend-owned Vibe Video mirror fields. Service-role Edge Functions, trusted security-definer RPCs, and trusted onboarding/Vibe Video server paths may update them. profiles.vibe_caption remains user-editable.';

COMMENT ON TRIGGER protect_backend_owned_vibe_video_profile_fields ON public.profiles IS
  'Enforces backend ownership for profiles.bunny_video_uid, profiles.bunny_video_status, and legacy profiles.vibe_video_status.';
