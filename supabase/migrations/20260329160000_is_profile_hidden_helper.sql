-- Canonical helper: is this profile hidden from discovery?
-- Checks BOTH column families + auto-expires timed pauses (expired rows treated as not hidden here;
-- clear_expired_pauses() persists cleanup).

CREATE OR REPLACE FUNCTION public.is_profile_hidden(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_is_paused boolean;
  v_paused_until timestamptz;
  v_account_paused boolean;
  v_account_paused_until timestamptz;
  v_discoverable boolean;
  v_is_suspended boolean;
BEGIN
  SELECT
    COALESCE(p.is_paused, false),
    p.paused_until,
    COALESCE(p.account_paused, false),
    p.account_paused_until,
    COALESCE(p.discoverable, true),
    COALESCE(p.is_suspended, false)
  INTO
    v_is_paused, v_paused_until,
    v_account_paused, v_account_paused_until,
    v_discoverable, v_is_suspended
  FROM public.profiles p
  WHERE p.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  -- Suspended always hidden
  IF v_is_suspended THEN
    RETURN true;
  END IF;

  -- Explicitly set non-discoverable
  IF NOT v_discoverable THEN
    RETURN true;
  END IF;

  -- Legacy pause: check with auto-expiry
  IF v_is_paused THEN
    IF v_paused_until IS NULL THEN
      RETURN true;
    ELSIF v_paused_until > now() THEN
      RETURN true;
    END IF;
  END IF;

  -- New pause columns: check with auto-expiry
  IF v_account_paused THEN
    IF v_account_paused_until IS NULL THEN
      RETURN true;
    ELSIF v_account_paused_until > now() THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.is_profile_hidden(uuid) IS
  'True if profile is suspended, not discoverable, or effectively paused (legacy and/or account pause, including indefinite).';

-- Server-side auto-expiry: clears expired timed pauses.
CREATE OR REPLACE FUNCTION public.clear_expired_pauses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.profiles
  SET
    is_paused = false,
    paused_until = NULL,
    paused_at = NULL,
    pause_reason = NULL,
    account_paused = false,
    account_paused_until = NULL,
    discoverable = true,
    discovery_mode = 'visible'
  WHERE (
    (is_paused = true AND paused_until IS NOT NULL AND paused_until <= now())
    OR
    (account_paused = true AND account_paused_until IS NOT NULL AND account_paused_until <= now())
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.clear_expired_pauses() IS
  'Clears timed account/legacy pauses that have passed; restores discoverability. Invoke via cron or RPC.';

REVOKE ALL ON FUNCTION public.clear_expired_pauses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_expired_pauses() TO service_role;
