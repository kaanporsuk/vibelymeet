-- Validation helper for canonical other-user full profile safe field contract.
-- Run against a seeded local database with an authenticated context.

WITH payload AS (
  SELECT public.get_profile_for_viewer(auth.uid()) AS profile
)
SELECT
  profile ? 'birth_date' AS includes_birth_date,
  profile ? 'company' AS includes_company,
  profile ? 'email_verified' AS includes_email_verified,
  profile ? 'phone_verified' AS includes_phone_verified,
  jsonb_typeof(profile->'vibe_tags') = 'array' AS includes_public_vibe_tag_metadata,
  NOT (profile ? 'phone_number') AS excludes_phone_number,
  NOT (profile ? 'verified_email') AS excludes_verified_email,
  NOT (profile ? 'proof_selfie_url') AS excludes_proof_selfie_url,
  NOT (profile ? 'location_data') AS excludes_location_data
FROM payload;
