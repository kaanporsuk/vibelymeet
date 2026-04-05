DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_credits_user_id_auth_users_fkey'
  ) THEN
    ALTER TABLE public.user_credits
      ADD CONSTRAINT user_credits_user_id_auth_users_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_deletion_requests_user_id_auth_users_fkey'
  ) THEN
    ALTER TABLE public.account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_user_id_auth_users_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;
