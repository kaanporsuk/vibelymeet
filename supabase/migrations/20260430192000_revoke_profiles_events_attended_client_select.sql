-- Backend-close the raw profiles.events_attended leak.
--
-- profiles.events_attended is an aggregate attendance signal. It is allowed for
-- self/admin/service-role reads through privacy-aware RPCs, but it must not be a
-- directly selectable PostgREST column for anon/authenticated clients because
-- table RLS is row-level only and cannot mask one column per viewer.
--
-- This migration replaces broad client SELECT on profiles with an explicit
-- column grant that excludes events_attended. get_profile_for_viewer remains the
-- user-facing profile contract for masked/non-self reads.

REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;
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
  location_data,
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

COMMENT ON COLUMN public.profiles.events_attended IS
  'Sensitive aggregate attendance signal. Direct client SELECT is revoked for anon/authenticated; use get_profile_for_viewer for masked user-facing reads, self live-count queries for profile settings, or admin/service-role paths for privileged operations.';
