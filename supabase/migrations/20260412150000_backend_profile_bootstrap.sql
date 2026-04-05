-- Backend-own profile bootstrap:
-- 1) every new auth.users row creates exactly one profiles row
-- 2) existing auth users missing profiles are backfilled idempotently
-- Clients should only read/retry profile readiness after auth.

CREATE OR REPLACE FUNCTION public.bootstrap_profile_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_name text;
  v_phone text;
BEGIN
  v_name := trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''));
  v_phone := NULLIF(trim(COALESCE(NEW.phone, '')), '');

  INSERT INTO public.profiles (
    id,
    name,
    age,
    gender,
    birth_date,
    phone_number,
    phone_verified,
    phone_verified_at
  )
  VALUES (
    NEW.id,
    v_name,
    18,
    'prefer_not_to_say',
    NULL,
    v_phone,
    v_phone IS NOT NULL,
    CASE WHEN v_phone IS NOT NULL THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_profile_from_auth_user IS
  'Creates the canonical profiles row for each new auth.users record. Backend-owned auth bootstrap; idempotent on duplicate delivery.';

DROP TRIGGER IF EXISTS on_auth_user_created_bootstrap_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_bootstrap_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.bootstrap_profile_from_auth_user();

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  birth_date,
  phone_number,
  phone_verified,
  phone_verified_at
)
SELECT
  au.id,
  trim(COALESCE(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')) AS name,
  18 AS age,
  'prefer_not_to_say' AS gender,
  NULL::date AS birth_date,
  NULLIF(trim(COALESCE(au.phone, '')), '') AS phone_number,
  (NULLIF(trim(COALESCE(au.phone, '')), '') IS NOT NULL) AS phone_verified,
  CASE
    WHEN NULLIF(trim(COALESCE(au.phone, '')), '') IS NOT NULL THEN now()
    ELSE NULL
  END AS phone_verified_at
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
