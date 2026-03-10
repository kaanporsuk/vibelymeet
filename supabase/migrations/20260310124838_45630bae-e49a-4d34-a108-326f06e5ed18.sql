
-- Re-grant phone_number and verified_email SELECT to authenticated (the REVOKE was too broad)
-- Instead, we'll protect these via RLS policy changes
GRANT SELECT (phone_number, verified_email) ON public.profiles TO authenticated;
GRANT SELECT (phone_number, verified_email) ON public.profiles TO anon;

-- Create a function for safely reading own PII
CREATE OR REPLACE FUNCTION public.get_own_pii(p_user_id uuid)
RETURNS TABLE(phone_number text, verified_email text, phone_verified boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.phone_number, p.verified_email, p.phone_verified
  FROM public.profiles p
  WHERE p.id = p_user_id AND p_user_id = auth.uid();
$$;
