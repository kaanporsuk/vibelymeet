-- Enforce NOT NULL on account_paused (column may already exist without constraint)
UPDATE public.profiles SET account_paused = false WHERE account_paused IS NULL;
ALTER TABLE public.profiles ALTER COLUMN account_paused SET NOT NULL;
