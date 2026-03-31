-- Helper RPC: updates onboarding_stage only (not onboarding_complete). Regression-safe ordering.
-- SET LOCAL ROLE postgres so protect_sensitive_profile_columns allows the UPDATE.

CREATE OR REPLACE FUNCTION public.update_onboarding_stage(
  p_user_id uuid,
  p_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_stage NOT IN ('none', 'auth_complete', 'identity', 'details', 'media', 'complete') THEN
    RAISE EXCEPTION 'Invalid onboarding stage: %', p_stage;
  END IF;

  IF p_stage = 'complete' THEN
    RAISE EXCEPTION 'Use complete_onboarding() to set stage to complete';
  END IF;

  SET LOCAL ROLE postgres;

  UPDATE public.profiles
  SET onboarding_stage = p_stage,
      updated_at = now()
  WHERE id = p_user_id
    AND (
      CASE onboarding_stage
        WHEN 'none' THEN 0
        WHEN 'auth_complete' THEN 1
        WHEN 'identity' THEN 2
        WHEN 'details' THEN 3
        WHEN 'media' THEN 4
        WHEN 'complete' THEN 5
        ELSE 0
      END
    ) < (
      CASE p_stage
        WHEN 'none' THEN 0
        WHEN 'auth_complete' THEN 1
        WHEN 'identity' THEN 2
        WHEN 'details' THEN 3
        WHEN 'media' THEN 4
        WHEN 'complete' THEN 5
        ELSE 0
      END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_onboarding_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_onboarding_stage(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.update_onboarding_stage IS 'Advances onboarding_stage monotonically for analytics/resume. Does not set onboarding_complete; use complete_onboarding() for completion.';
