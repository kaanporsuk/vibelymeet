-- PENDING / DO NOT DEPLOY WITH STAGE 1.
--
-- Distance visibility privacy enforcement, Stage 2.
--
-- Move this file into supabase/migrations only after:
-- 1. Stage 1 is deployed and get_my_location_data() is available through PostgREST.
-- 2. Web has shipped the get_my_location_data() client path.
-- 3. Native has shipped the get_my_location_data() client path.
-- 4. A native adoption/minimum-version strategy is confirmed.
--
-- Root cause closed here:
-- profiles.location_data stores exact user coordinates and must not be directly
-- selectable by anon/authenticated clients for any RLS-visible row. RLS is
-- row-level only and cannot mask this column per viewer.

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;
REVOKE SELECT (location_data) ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT (location_data) ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO service_role;

GRANT SELECT (
  about_me,
  account_paused,
  account_paused_until,
  activity_status_visibility,
  age,
  avatar_url,
  bio,
  birth_date,
  bunny_video_status,
  bunny_video_uid,
  community_agreed_at,
  company,
  country,
  created_at,
  discoverable,
  discovery_audience,
  discovery_mode,
  discovery_snooze_until,
  distance_visibility,
  email_unsubscribed,
  email_verified,
  event_attendance_visibility,
  event_discovery_prefs,
  gender,
  height_cm,
  id,
  interested_in,
  is_paused,
  is_premium,
  is_suspended,
  job,
  last_seen_at,
  lifestyle,
  location,
  looking_for,
  name,
  onboarding_complete,
  onboarding_stage,
  pause_reason,
  paused_at,
  paused_until,
  phone_number,
  phone_verified,
  phone_verified_at,
  photo_verification_expires_at,
  photo_verified,
  photo_verified_at,
  photos,
  preferred_age_max,
  preferred_age_min,
  premium_granted_at,
  premium_granted_by,
  premium_until,
  prompts,
  proof_selfie_url,
  referred_by,
  relationship_intent,
  show_distance,
  show_online_status,
  subscription_tier,
  suspension_reason,
  tagline,
  total_conversations,
  total_matches,
  updated_at,
  verified_email,
  vibe_caption,
  vibe_score,
  vibe_score_label,
  vibe_video_status
) ON TABLE public.profiles TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

NOTIFY pgrst, 'reload schema';
