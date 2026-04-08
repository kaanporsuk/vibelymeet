-- Stream 3B: move referral attribution write path server-side.
-- Clients may pass a pending referrer id, but the database enforces:
-- - only set profiles.referred_by when currently null
-- - never self-refer
-- - never overwrite an existing referrer

CREATE OR REPLACE FUNCTION public.apply_referral_attribution(
  p_referrer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_referred_by uuid;
  v_referrer_exists boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'auth-required'
    );
  END IF;

  IF p_referrer_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'invalid'
    );
  END IF;

  IF p_referrer_id = v_uid THEN
    RETURN jsonb_build_object(
      'status', 'self'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles ref_profile
    WHERE ref_profile.id = p_referrer_id
  )
  INTO v_referrer_exists;

  IF NOT v_referrer_exists THEN
    RETURN jsonb_build_object(
      'status', 'invalid'
    );
  END IF;

  SELECT p.referred_by
  INTO v_existing_referred_by
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'missing-profile'
    );
  END IF;

  IF v_existing_referred_by IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already-set',
      'referrer_id', v_existing_referred_by
    );
  END IF;

  UPDATE public.profiles p
  SET referred_by = p_referrer_id
  WHERE p.id = v_uid
    AND p.referred_by IS NULL
    AND p.id <> p_referrer_id;

  IF NOT FOUND THEN
    SELECT p.referred_by
    INTO v_existing_referred_by
    FROM public.profiles p
    WHERE p.id = v_uid;

    RETURN jsonb_build_object(
      'status', 'already-set',
      'referrer_id', v_existing_referred_by
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'applied',
    'referrer_id', p_referrer_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_attribution(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_attribution(uuid) TO authenticated;

COMMENT ON FUNCTION public.apply_referral_attribution(uuid) IS
  'Server-owned referral attribution write path. Applies profiles.referred_by once for auth.uid() when currently null and never for self-referrals.';
