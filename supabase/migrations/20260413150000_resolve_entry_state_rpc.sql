-- Phase 1 entry-state resolver.
-- Shared read-only contract for web + native so clients stop inferring entry
-- state from profiles.onboarding_complete alone.

CREATE OR REPLACE FUNCTION public.resolve_entry_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_auth_user auth.users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_draft public.onboarding_drafts%ROWTYPE;
  v_has_profile boolean := false;
  v_has_draft boolean := false;
  v_current_phone text;
  v_current_email text;
  v_current_profile_bootstrap_fresh boolean := false;
  v_candidate_count integer := 0;
  v_candidate_match_basis text := NULL;
  v_candidate_masked_hint text := NULL;
  v_candidate_provider_hints text[] := ARRAY[]::text[];
  v_state text := 'hard_error';
  v_reason_code text := 'resolver_exception';
  v_route_hint text := 'entry_recovery';
  v_retryable boolean := true;
  v_candidate_fragment jsonb := NULL;
  v_onboarding_draft jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'hard_error',
      'reason_code', 'auth_required',
      'route_hint', 'entry_recovery',
      'onboarding_draft', jsonb_build_object(
        'exists', false,
        'current_step', NULL,
        'current_stage', NULL
      ),
      'candidate_fragment', NULL,
      'retryable', true,
      'evaluation_version', 1
    );
  END IF;

  SELECT * INTO v_auth_user
  FROM auth.users
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'hard_error',
      'reason_code', 'auth_user_missing',
      'route_hint', 'entry_recovery',
      'onboarding_draft', jsonb_build_object(
        'exists', false,
        'current_step', NULL,
        'current_stage', NULL
      ),
      'candidate_fragment', NULL,
      'retryable', true,
      'evaluation_version', 1
    );
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;
  v_has_profile := FOUND;

  SELECT * INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = v_uid
    AND completed_at IS NULL
    AND expires_at > now();
  v_has_draft := FOUND;

  v_onboarding_draft := jsonb_build_object(
    'exists', v_has_draft,
    'current_step', CASE WHEN v_has_draft THEN v_draft.current_step ELSE NULL END,
    'current_stage', CASE WHEN v_has_draft THEN v_draft.current_stage ELSE NULL END
  );

  v_current_phone := NULLIF(trim(COALESCE(v_auth_user.phone, '')), '');
  v_current_email := NULLIF(lower(trim(COALESCE(v_auth_user.email, ''))), '');

  IF v_auth_user.email_confirmed_at IS NULL
     OR v_current_email IS NULL
     OR v_current_email LIKE '%@privaterelay.appleid.com'
  THEN
    v_current_email := NULL;
  END IF;

  IF v_has_profile THEN
    v_current_profile_bootstrap_fresh :=
      v_profile.onboarding_complete = false
      AND v_profile.birth_date IS NULL
      AND (
        NULLIF(trim(COALESCE(v_profile.gender, '')), '') IS NULL
        OR v_profile.gender = 'prefer_not_to_say'
      )
      AND COALESCE(array_length(v_profile.photos, 1), 0) = 0
      AND COALESCE(array_length(v_profile.interested_in, 1), 0) = 0
      AND NULLIF(trim(COALESCE(v_profile.relationship_intent, '')), '') IS NULL
      AND NULLIF(trim(COALESCE(v_profile.location, '')), '') IS NULL
      AND v_profile.community_agreed_at IS NULL
      AND NULLIF(trim(COALESCE(v_profile.about_me, '')), '') IS NULL;
  END IF;

  IF v_has_profile AND v_profile.onboarding_complete = true THEN
    RETURN jsonb_build_object(
      'state', 'complete',
      'reason_code', 'profile_complete',
      'route_hint', 'app',
      'onboarding_draft', v_onboarding_draft,
      'candidate_fragment', NULL,
      'retryable', false,
      'evaluation_version', 1
    );
  END IF;

  WITH candidate_matches AS (
    SELECT
      p.id AS candidate_id,
      CASE
        WHEN v_current_phone IS NOT NULL
          AND p.phone_verified = true
          AND NULLIF(trim(COALESCE(p.phone_number, '')), '') = v_current_phone
        THEN 'verified_phone'
        WHEN v_current_email IS NOT NULL
          AND au.email_confirmed_at IS NOT NULL
          AND NULLIF(lower(trim(COALESCE(au.email, ''))), '') = v_current_email
        THEN 'confirmed_email'
        WHEN v_current_email IS NOT NULL
          AND p.email_verified = true
          AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = v_current_email
        THEN 'verified_email'
        ELSE NULL
      END AS match_basis,
      p.onboarding_complete,
      (
        EXISTS (
          SELECT 1
          FROM public.messages m
          WHERE m.sender_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.matches mt
          WHERE mt.profile_id_1 = p.id
             OR mt.profile_id_2 = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.event_registrations er
          WHERE er.profile_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.video_sessions vs
          WHERE vs.participant_1_id = p.id
             OR vs.participant_2_id = p.id
        )
      ) AS has_activity,
      NULLIF(trim(COALESCE(p.phone_number, '')), '') AS candidate_phone,
      NULLIF(lower(trim(COALESCE(au.email, ''))), '') AS candidate_email,
      COALESCE(
        ARRAY(
          SELECT DISTINCT provider_name
          FROM (
            SELECT jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(au.raw_app_meta_data -> 'providers') = 'array'
                THEN au.raw_app_meta_data -> 'providers'
                ELSE '[]'::jsonb
              END
            ) AS provider_name
            UNION ALL
            SELECT NULLIF(trim(COALESCE(au.raw_app_meta_data ->> 'provider', '')), '')
            UNION ALL
            SELECT CASE
              WHEN NULLIF(trim(COALESCE(au.phone, '')), '') IS NOT NULL THEN 'phone'
              ELSE NULL
            END
            UNION ALL
            SELECT CASE
              WHEN NULLIF(lower(trim(COALESCE(au.email, ''))), '') IS NOT NULL THEN 'email'
              ELSE NULL
            END
          ) providers
          WHERE provider_name IN ('phone', 'email', 'google', 'apple')
        ),
        ARRAY[]::text[]
      ) AS provider_hints
    FROM public.profiles p
    INNER JOIN auth.users au ON au.id = p.id
    WHERE au.id <> v_uid
      AND (
        (
          v_current_phone IS NOT NULL
          AND p.phone_verified = true
          AND NULLIF(trim(COALESCE(p.phone_number, '')), '') = v_current_phone
        )
        OR (
          v_current_email IS NOT NULL
          AND au.email_confirmed_at IS NOT NULL
          AND NULLIF(lower(trim(COALESCE(au.email, ''))), '') = v_current_email
        )
        OR (
          v_current_email IS NOT NULL
          AND p.email_verified = true
          AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = v_current_email
        )
      )
  ),
  established_candidates AS (
    SELECT
      candidate_id,
      match_basis,
      onboarding_complete,
      has_activity,
      candidate_phone,
      candidate_email,
      provider_hints
    FROM candidate_matches
    WHERE onboarding_complete = true OR has_activity = true
  ),
  ranked_candidates AS (
    SELECT
      candidate_id,
      match_basis,
      onboarding_complete,
      has_activity,
      candidate_phone,
      candidate_email,
      provider_hints,
      count(*) OVER () AS total_matches,
      row_number() OVER (
        ORDER BY
          CASE match_basis
            WHEN 'verified_phone' THEN 1
            WHEN 'confirmed_email' THEN 2
            WHEN 'verified_email' THEN 3
            ELSE 9
          END,
          CASE WHEN onboarding_complete THEN 0 ELSE 1 END,
          CASE WHEN has_activity THEN 0 ELSE 1 END,
          candidate_id
      ) AS rn
    FROM established_candidates
  )
  SELECT
    total_matches,
    match_basis,
    CASE
      WHEN total_matches > 1 THEN NULL
      WHEN match_basis = 'verified_phone' THEN
        CASE
          WHEN candidate_phone IS NULL THEN NULL
          WHEN char_length(candidate_phone) <= 4 THEN '****'
          ELSE left(candidate_phone, LEAST(4, GREATEST(char_length(candidate_phone) - 2, 2))) || ' **** ' || right(candidate_phone, 2)
        END
      ELSE
        CASE
          WHEN candidate_email IS NULL OR position('@' IN candidate_email) <= 1 THEN NULL
          ELSE left(split_part(candidate_email, '@', 1), 1) || '***@' || split_part(candidate_email, '@', 2)
        END
    END AS masked_hint,
    CASE
      WHEN total_matches > 1 THEN ARRAY[]::text[]
      ELSE provider_hints
    END AS provider_hints
  INTO
    v_candidate_count,
    v_candidate_match_basis,
    v_candidate_masked_hint,
    v_candidate_provider_hints
  FROM ranked_candidates
  WHERE rn = 1;

  IF COALESCE(v_candidate_count, 0) > 0
     AND (
       NOT v_has_profile
       OR v_current_profile_bootstrap_fresh
     )
  THEN
    v_state := 'suspected_fragmented_identity';
    v_reason_code := CASE
      WHEN v_candidate_count > 1 THEN 'fragment_multiple_high_confidence_matches'
      WHEN v_candidate_match_basis = 'verified_phone' THEN 'fragment_verified_phone_match'
      WHEN v_candidate_match_basis = 'confirmed_email' THEN 'fragment_confirmed_email_match'
      ELSE 'fragment_verified_email_match'
    END;
    v_route_hint := 'entry_recovery';
    v_retryable := true;
    v_candidate_fragment := jsonb_build_object(
      'confidence', 'high',
      'match_basis', CASE WHEN v_candidate_count > 1 THEN NULL ELSE v_candidate_match_basis END,
      'masked_hint', v_candidate_masked_hint,
      'provider_hints', to_jsonb(v_candidate_provider_hints)
    );
  ELSIF NOT v_has_profile THEN
    v_state := 'missing_profile';
    v_reason_code := 'profile_missing';
    v_route_hint := 'entry_recovery';
    v_retryable := true;
  ELSIF v_has_profile AND v_profile.onboarding_complete = false THEN
    v_state := 'incomplete';
    v_reason_code := CASE
      WHEN v_has_draft THEN 'profile_incomplete_with_draft'
      ELSE 'profile_incomplete'
    END;
    v_route_hint := 'onboarding';
    v_retryable := false;
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'reason_code', v_reason_code,
    'route_hint', v_route_hint,
    'onboarding_draft', v_onboarding_draft,
    'candidate_fragment', v_candidate_fragment,
    'retryable', v_retryable,
    'evaluation_version', 1
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'state', 'hard_error',
      'reason_code', 'resolver_exception',
      'route_hint', 'entry_recovery',
      'onboarding_draft', jsonb_build_object(
        'exists', false,
        'current_step', NULL,
        'current_stage', NULL
      ),
      'candidate_fragment', NULL,
      'retryable', true,
      'evaluation_version', 1
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_entry_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_entry_state() TO authenticated;

COMMENT ON FUNCTION public.resolve_entry_state IS
  'Phase 1 shared entry-state resolver for authenticated users. Routes clients to app, onboarding, or entry recovery without exposing foreign account identifiers or raw contact data.';
