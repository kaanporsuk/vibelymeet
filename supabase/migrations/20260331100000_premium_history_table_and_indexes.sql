-- premium_history: audit trail for admin premium grants (idempotent for cloud tables missing indexes).
-- Matches public TypeScript types: id, user_id, admin_id, action, premium_until, reason, created_at.

CREATE TABLE IF NOT EXISTS public.premium_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  premium_until timestamptz,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_premium_history_user_id ON public.premium_history(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_history_created_at ON public.premium_history(created_at DESC);

ALTER TABLE public.premium_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read premium_history" ON public.premium_history;
CREATE POLICY "Admins can read premium_history"
  ON public.premium_history FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert premium_history" ON public.premium_history;
CREATE POLICY "Admins can insert premium_history"
  ON public.premium_history FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
