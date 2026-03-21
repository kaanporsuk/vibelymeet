-- Account "Take a break" / pause (separate naming from discovery snooze in app logic)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_paused_until timestamptz DEFAULT NULL;
