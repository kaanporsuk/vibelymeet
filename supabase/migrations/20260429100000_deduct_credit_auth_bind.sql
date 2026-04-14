-- Bind public.deduct_credit to the caller's JWT: only the signed-in user may deduct
-- their own extra_time / extended_vibe credits. Service role may still deduct on behalf
-- of any user (maintenance / future server-side paths — no current callers).
--
-- Rationale: SECURITY DEFINER previously allowed any authenticated client to pass an
-- arbitrary p_user_id and burn another user's pool credits.

CREATE OR REPLACE FUNCTION public.deduct_credit(p_user_id uuid, p_credit_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'not authorized'
        USING ERRCODE = '42501',
        HINT = 'deduct_credit may only target auth.uid()';
    END IF;
  END IF;

  IF p_credit_type = 'extra_time' THEN
    UPDATE user_credits SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = p_user_id AND extra_time_credits > 0;
  ELSIF p_credit_type = 'extended_vibe' THEN
    UPDATE user_credits SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = p_user_id AND extended_vibe_credits > 0;
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.deduct_credit(uuid, text) IS
  'Deduct one extra_time or extended_vibe credit for p_user_id. Callers with role authenticated must have auth.uid() = p_user_id. Service role may target any user.';
