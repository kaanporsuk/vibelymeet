
-- Email drip log table
CREATE TABLE IF NOT EXISTS public.email_drip_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email_key)
);

ALTER TABLE public.email_drip_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON public.email_drip_log FOR ALL USING (false);

-- Add email_unsubscribed column to profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
