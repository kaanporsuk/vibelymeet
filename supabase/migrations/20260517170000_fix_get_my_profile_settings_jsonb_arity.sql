-- Repair owner profile read RPC after direct profile SELECT privacy hardening.
--
-- Postgres functions accept at most 100 arguments. The prior
-- get_my_profile_settings() implementation built the full owner payload in one
-- jsonb_build_object(...) call, so authenticated /profile reads failed at
-- runtime. Keep the same privacy boundary and response contract, but construct
-- the JSON payload in smaller chunks.

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

  RETURN
    jsonb_build_object(
      'id', v_profile.id,
      'updated_at', v_profile.updated_at,
      'created_at', v_profile.created_at,
      'name', v_profile.name,
      'birth_date', v_profile.birth_date,
      'age', CASE
        WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
        ELSE v_profile.age
      END,
      'gender', v_profile.gender,
      'interested_in', v_profile.interested_in,
      'tagline', v_profile.tagline,
      'height_cm', v_profile.height_cm,
      'location', v_profile.location,
      'country', v_profile.country,
      'job', v_profile.job,
      'company', v_profile.company,
      'about_me', COALESCE(v_profile.about_me, v_profile.bio),
      'bio', v_profile.bio,
      'looking_for', v_profile.looking_for,
      'relationship_intent', v_profile.relationship_intent,
      'onboarding_complete', v_profile.onboarding_complete,
      'onboarding_stage', v_profile.onboarding_stage,
      'lifestyle', v_profile.lifestyle,
      'prompts', v_profile.prompts,
      'photos', v_profile.photos,
      'avatar_url', v_profile.avatar_url
    )
    || jsonb_build_object(
      'bunny_video_uid', v_profile.bunny_video_uid,
      'bunny_video_status', v_profile.bunny_video_status,
      'vibe_video_status', v_profile.vibe_video_status,
      'vibe_caption', v_profile.vibe_caption,
      'photo_verified', COALESCE(v_profile.photo_verified, false),
      'photo_verified_at', v_profile.photo_verified_at,
      'photo_verification_expires_at', v_profile.photo_verification_expires_at,
      'phone_number', v_profile.phone_number,
      'phone_verified', COALESCE(v_profile.phone_verified, false),
      'phone_verified_at', v_profile.phone_verified_at,
      'email_verified', COALESCE(v_profile.email_verified, false),
      'verified_email', v_profile.verified_email,
      'is_premium', COALESCE(v_profile.is_premium, false),
      'premium_until', v_profile.premium_until,
      'subscription_tier', v_profile.subscription_tier,
      'vibe_score', v_profile.vibe_score,
      'vibe_score_label', v_profile.vibe_score_label,
      'preferred_age_min', v_profile.preferred_age_min,
      'preferred_age_max', v_profile.preferred_age_max,
      'event_discovery_prefs', v_profile.event_discovery_prefs
    )
    || jsonb_build_object(
      'discoverable', v_profile.discoverable,
      'discovery_mode', v_profile.discovery_mode,
      'discovery_snooze_until', v_profile.discovery_snooze_until,
      'discovery_audience', v_profile.discovery_audience,
      'activity_status_visibility', v_profile.activity_status_visibility,
      'distance_visibility', v_profile.distance_visibility,
      'event_attendance_visibility', v_profile.event_attendance_visibility,
      'show_online_status', v_profile.show_online_status,
      'account_paused', COALESCE(v_profile.account_paused, false),
      'account_paused_until', v_profile.account_paused_until,
      'is_paused', COALESCE(v_profile.is_paused, false),
      'paused_at', v_profile.paused_at,
      'paused_until', v_profile.paused_until,
      'pause_reason', v_profile.pause_reason,
      'is_suspended', COALESCE(v_profile.is_suspended, false),
      'suspension_reason', v_profile.suspension_reason,
      'email_unsubscribed', v_profile.email_unsubscribed,
      'community_agreed_at', v_profile.community_agreed_at,
      'referred_by', v_profile.referred_by,
      'referrer_name', v_referrer_name,
      'events_attended', v_profile.events_attended,
      'total_matches', v_profile.total_matches,
      'total_conversations', v_profile.total_conversations
    );
END;
$$;

COMMENT ON FUNCTION public.get_my_profile_settings() IS
  'Owner-only profile/settings read path for private profile columns whose direct anon/authenticated SELECT grants are revoked. Other-user reads must use get_profile_for_viewer or another documented safe RPC.';

REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_settings() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
