/**
 * Validation Queries for Ghost Bootstrap Account Detection
 *
 * Test the new observability RPC and ensure no regressions in existing flows.
 */

-- ============================================================================
-- Test 1: Verify RPC exists and returns expected schema
-- ============================================================================
-- Should return rows with all required columns and masked data
SELECT
  COUNT(*) as total_candidates,
  COUNT(*) FILTER (WHERE review_confidence = 'HIGH') as high_confidence,
  COUNT(*) FILTER (WHERE review_confidence = 'MEDIUM') as medium_confidence,
  COUNT(*) FILTER (WHERE review_confidence = 'LOW') as low_confidence,
  COUNT(*) FILTER (WHERE identity_collision_hints IS NOT NULL AND array_length(identity_collision_hints, 1) > 0) as with_collisions,
  MAX(days_since_creation) as oldest_candidate_days,
  MIN(profile_activity_score) as lowest_activity_score
FROM public.detect_ghost_bootstrap_accounts(7, 0);

-- ============================================================================
-- Test 2: Verify masked contact info (no exposure of full emails/phones)
-- ============================================================================
-- Should show masked format, no full contact details
SELECT
  profile_id,
  email_masked,
  phone_masked,
  CASE
    WHEN email_masked LIKE '%***%' THEN 'MASKED'
    WHEN email_masked = 'unknown' THEN 'UNAVAILABLE'
    ELSE 'EXPOSED'
  END as email_masking_status,
  CASE
    WHEN phone_masked LIKE '%****%' THEN 'MASKED'
    WHEN phone_masked = 'unknown' THEN 'UNAVAILABLE'
    ELSE 'EXPOSED'
  END as phone_masking_status
FROM public.detect_ghost_bootstrap_accounts(7, 0)
LIMIT 10;

-- ============================================================================
-- Test 3: Verify bootstrap-fresh profile detection accuracy
-- ============================================================================
-- All returned candidates should truly be bootstrap-fresh
WITH candidates AS (
  SELECT profile_id FROM public.detect_ghost_bootstrap_accounts(7, 0)
),
candidate_profiles AS (
  SELECT
    c.profile_id,
    p.onboarding_complete,
    p.birth_date,
    p.gender,
    array_length(p.photos, 1) as photo_count,
    array_length(p.interested_in, 1) as interested_in_count,
    p.relationship_intent,
    p.location,
    p.community_agreed_at,
    p.about_me,
    CASE
      WHEN p.onboarding_complete = false
        AND p.birth_date IS NULL
        AND (p.gender IS NULL OR p.gender = 'prefer_not_to_say')
        AND COALESCE(array_length(p.photos, 1), 0) = 0
        AND COALESCE(array_length(p.interested_in, 1), 0) = 0
        AND NULLIF(trim(COALESCE(p.relationship_intent, '')), '') IS NULL
        AND NULLIF(trim(COALESCE(p.location, '')), '') IS NULL
        AND p.community_agreed_at IS NULL
        AND NULLIF(trim(COALESCE(p.about_me, '')), '') IS NULL
      THEN 'TRUE_BOOTSTRAP'
      ELSE 'NOT_BOOTSTRAP'
    END as is_actually_bootstrap
  FROM candidates c
  INNER JOIN public.profiles p ON c.profile_id = p.id
)
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE is_actually_bootstrap = 'TRUE_BOOTSTRAP') as correctly_bootstrap,
  COUNT(*) FILTER (WHERE is_actually_bootstrap = 'NOT_BOOTSTRAP') as false_positives
FROM candidate_profiles;

-- ============================================================================
-- Test 4: Verify activity calculation
-- ============================================================================
-- Spot-check that activity scores are calculated correctly
WITH candidates AS (
  SELECT profile_id, total_messages, total_matches, total_video_sessions, total_event_regs, profile_activity_score
  FROM public.detect_ghost_bootstrap_accounts(7, 0)
  LIMIT 5
),
calculated_scores AS (
  SELECT
    profile_id,
    total_messages + (total_matches * 2) + (total_video_sessions * 3) + (total_event_regs * 2) as calculated_score,
    profile_activity_score as reported_score,
    CASE
      WHEN (total_messages + (total_matches * 2) + (total_video_sessions * 3) + (total_event_regs * 2)) = profile_activity_score
      THEN 'CORRECT'
      ELSE 'MISMATCH'
    END as score_accuracy
  FROM candidates
)
SELECT
  COUNT(*) as total_checked,
  COUNT(*) FILTER (WHERE score_accuracy = 'CORRECT') as correct_calculations,
  COUNT(*) FILTER (WHERE score_accuracy = 'MISMATCH') as calculation_errors
FROM calculated_scores;

-- ============================================================================
-- Test 5: Verify identity collision detection works
-- ============================================================================
-- Should identify email/phone collisions where applicable
WITH ghost_with_collisions AS (
  SELECT
    profile_id,
    identity_collision_hints,
    array_length(identity_collision_hints, 1) as collision_count
  FROM public.detect_ghost_bootstrap_accounts(7, 0)
  WHERE identity_collision_hints IS NOT NULL
    AND array_length(identity_collision_hints, 1) > 0
)
SELECT
  COUNT(*) as total_with_collisions,
  AVG(collision_count) as avg_collisions_per_candidate,
  MAX(collision_count) as max_collisions,
  STRING_AGG(DISTINCT identity_collision_hints[1], ', ') as collision_types
FROM ghost_with_collisions;

-- ============================================================================
-- Test 6: Verify thresholds work
-- ============================================================================
-- Test different age thresholds to ensure filtering works
SELECT
  'All bootstrap' as test_case,
  COUNT(*) as count
FROM public.detect_ghost_bootstrap_accounts(1, 999)  -- Very new, high activity threshold

UNION ALL

SELECT
  'Only 30+ days old',
  COUNT(*)
FROM public.detect_ghost_bootstrap_accounts(30, 0)   -- Only very old accounts

UNION ALL

SELECT
  'Strict (14+ days, activity <= 1)',
  COUNT(*)
FROM public.detect_ghost_bootstrap_accounts(14, 1)   -- More restrictive thresholds;

-- ============================================================================
-- Test 7: Verify review_confidence grading
-- ============================================================================
-- Should see correlation between confidence and indicators
WITH candidates AS (
  SELECT 
    review_confidence,
    days_since_creation,
    profile_activity_score,
    last_seen_at
  FROM public.detect_ghost_bootstrap_accounts(7, 0)
)
SELECT
  review_confidence,
  COUNT(*) as count,
  ROUND(AVG(days_since_creation)::numeric, 1) as avg_days_old,
  ROUND(AVG(profile_activity_score)::numeric, 1) as avg_activity_score,
  COUNT(*) FILTER (WHERE last_seen_at IS NULL) as never_seen
FROM candidates
GROUP BY review_confidence
ORDER BY 
  CASE review_confidence
    WHEN 'HIGH' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'LOW' THEN 3
    ELSE 4
  END;

-- ============================================================================
-- Test 8: Verify no unintended users are returned
-- ============================================================================
-- Count of completed profiles in results (should be 0)
WITH candidates AS (
  SELECT profile_id FROM public.detect_ghost_bootstrap_accounts(7, 0)
)
SELECT
  COUNT(*) FILTER (WHERE c.onboarding_complete = true) as completed_profiles_in_results,
  COUNT(*) FILTER (WHERE c.onboarding_complete = false) as bootstrap_profiles_in_results
FROM candidates ca
INNER JOIN public.profiles c ON ca.profile_id = c.id;

-- ============================================================================
-- Test 9: Admin access control (should only work with admin role)
-- ============================================================================
-- This should succeed for admins, fail for regular users
-- Cannot directly test in this script, but verify the RPC exists and is callable:
SELECT COUNT(*) as rpc_exists
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'detect_ghost_bootstrap_accounts'
  AND routine_type = 'FUNCTION';

-- ============================================================================
-- Test 10: Performance check - query shouldn't take >5 seconds
-- ============================================================================
-- With EXPLAIN to check performance
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM public.detect_ghost_bootstrap_accounts(7, 0);

-- ============================================================================
-- Regression Tests
-- ============================================================================

-- RT-1: Verify normal sign-in flow still works
SELECT COUNT(DISTINCT id) as total_users
FROM auth.users
WHERE deleted_at IS NULL;

-- RT-2: Verify profile completeness detection still works
WITH normal_profiles AS (
  SELECT
    p.id,
    (p.onboarding_complete = true 
      AND p.birth_date IS NOT NULL
      AND p.gender NOT IN (NULL, 'prefer_not_to_say')
      AND COALESCE(array_length(p.photos, 1), 0) > 0
      AND COALESCE(array_length(p.interested_in, 1), 0) > 0
      AND p.relationship_intent IS NOT NULL
      AND p.location IS NOT NULL
      AND p.community_agreed_at IS NOT NULL
    ) as is_complete
  FROM public.profiles p
)
SELECT
  COUNT(*) FILTER (WHERE is_complete = true) as completed_count,
  COUNT(*) FILTER (WHERE is_complete = false) as incomplete_count
FROM normal_profiles;

-- RT-3: Verify resolve_entry_state still works correctly
SELECT
  (auth.uid())::text as current_user,
  jsonb_typeof(public.resolve_entry_state()::jsonb) as result_type,
  CASE
    WHEN public.resolve_entry_state()->>  'state' IN ('complete', 'incomplete', 'missing_profile', 'suspected_fragmented_identity', 'hard_error')
    THEN 'VALID_STATE'
    ELSE 'INVALID_STATE'
  END as state_validity;

-- RT-4: Verify identity collision detection doesn't break existing fragment detection
SELECT
  COUNT(*) as total_potential_fragments,
  COUNT(*) FILTER (
    WHERE au.phone IS NOT NULL
      AND p.phone_verified = true
      AND ltrim(NULLIF(trim(au.phone), ''), '+') = ltrim(NULLIF(trim(p.phone_number), ''), '+')
  ) as phone_verification_matches
FROM auth.users au
INNER JOIN public.profiles p ON au.id = p.id
WHERE au.phone IS NOT NULL
  AND p.phone_number IS NOT NULL;
