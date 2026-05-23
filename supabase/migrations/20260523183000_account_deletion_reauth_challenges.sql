-- Account deletion step-up proof for authenticated web/native delete flows.
-- Codes are server-generated, hashed with an Edge secret, and consumed before
-- `delete-account` schedules the deletion request.

CREATE TABLE IF NOT EXISTS public.account_deletion_reauth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'phone')),
  destination_hash text NOT NULL,
  code_hash text,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_reauth_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_reauth_challenges FROM anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_reauth_challenges TO service_role;

CREATE INDEX IF NOT EXISTS idx_account_deletion_reauth_user_created
  ON public.account_deletion_reauth_challenges (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_reauth_pending
  ON public.account_deletion_reauth_challenges (user_id, channel, expires_at DESC)
  WHERE consumed_at IS NULL AND verified_at IS NULL;

COMMENT ON TABLE public.account_deletion_reauth_challenges IS
  'Server-only short-lived OTP challenges for authenticated account deletion step-up proof.';

NOTIFY pgrst, 'reload schema';
