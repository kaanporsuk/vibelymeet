-- Sprint 6 auth hardening:
-- - sanitize display names coming from auth provider metadata before profile bootstrap writes
-- - namespace shared verification attempt throttles by auth flow

CREATE OR REPLACE FUNCTION public.sanitize_profile_display_name(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public
AS $$
  WITH stripped AS (
    SELECT
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(COALESCE(p_input, ''), chr(173), ''),
                    chr(8203),
                    ''
                  ),
                  chr(8204),
                  ''
                ),
                chr(8205),
                ''
              ),
              chr(8206),
              ''
            ),
            chr(8207),
            ''
          ),
          chr(8288),
          ''
        ),
        chr(65279),
        ''
      ) AS value
  ),
  normalized AS (
    SELECT btrim(
      regexp_replace(
        regexp_replace(value, '[[:cntrl:]]', '', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ) AS value
    FROM stripped
  )
  SELECT NULLIF(btrim(left(value, 80)), '')
  FROM normalized;
$$;

COMMENT ON FUNCTION public.sanitize_profile_display_name(text) IS
  'Sanitizes auth-provider display names for profile bootstrap: trims, collapses whitespace, removes control/zero-width characters, and caps at 80 characters.';

REVOKE ALL ON FUNCTION public.sanitize_profile_display_name(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bootstrap_profile_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_phone text;
BEGIN
  v_name := COALESCE(
    public.sanitize_profile_display_name(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        NEW.raw_user_meta_data ->> 'display_name',
        ''
      )
    ),
    ''
  );
  v_phone := NULLIF(trim(COALESCE(NEW.phone, '')), '');

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_profile_from_auth_user IS
  'Creates the canonical profiles row for each new auth.users record. Backend-owned auth bootstrap; idempotent on duplicate delivery. Sanitizes auth metadata display names and sets the transaction-local verification writer flag so profile insert protection stays least-privilege.';

REVOKE ALL ON FUNCTION public.bootstrap_profile_from_auth_user()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.verification_attempts
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.verification_attempts
  DROP CONSTRAINT IF EXISTS verification_attempts_flow_format;

ALTER TABLE public.verification_attempts
  ADD CONSTRAINT verification_attempts_flow_format
  CHECK (flow ~ '^[a-z][a-z0-9_:-]{0,63}$');

CREATE INDEX IF NOT EXISTS idx_verification_attempts_user_flow_time
  ON public.verification_attempts (user_id, flow, attempt_at DESC);

DROP POLICY IF EXISTS "Users can view own verification attempts"
  ON public.verification_attempts;

REVOKE ALL ON TABLE public.verification_attempts
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_attempts
  TO service_role;

COMMENT ON TABLE public.verification_attempts IS
  'Backend-owned auth verification throttle ledger. Edge Functions write/read through service_role; clients must not read or mutate attempt rows directly.';

COMMENT ON COLUMN public.verification_attempts.flow IS
  'Auth verification throttle namespace, e.g. phone_verify_send or email_otp_verify. Prevents one auth flow from throttling or clearing another.';

NOTIFY pgrst, 'reload schema';
