-- Validation helper for canonical other-user full profile safe field contract.
-- Run against a seeded local database with an authenticated context.

WITH payload AS (
  SELECT public.get_profile_for_viewer(auth.uid()) AS profile
)
SELECT
  COALESCE(profile ? 'zodiac', false) AS includes_zodiac,
  COALESCE(profile ? 'company', false) AS includes_company,
  COALESCE(profile ? 'email_verified', false) AS includes_email_verified,
  COALESCE(profile ? 'phone_verified', false) AS includes_phone_verified,
  COALESCE(jsonb_typeof(profile->'vibe_tags') = 'array', false) AS includes_public_vibe_tag_metadata,
  COALESCE(NOT (profile ? 'birth_date'), false) AS excludes_birth_date,
  COALESCE(NOT (profile ? 'phone_number'), false) AS excludes_phone_number,
  COALESCE(NOT (profile ? 'verified_email'), false) AS excludes_verified_email,
  COALESCE(NOT (profile ? 'proof_selfie_url'), false) AS excludes_proof_selfie_url,
  COALESCE(NOT (profile ? 'location_data'), false) AS excludes_location_data
FROM payload;
