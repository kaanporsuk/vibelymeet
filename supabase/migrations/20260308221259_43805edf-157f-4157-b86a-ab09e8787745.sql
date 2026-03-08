
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text,
  requested_at timestamptz DEFAULT now(),
  scheduled_deletion_at timestamptz DEFAULT now() + interval '30 days',
  status text DEFAULT 'pending',
  cancelled_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Users can only see their own deletion request
CREATE POLICY "Users read own deletion request"
  ON public.account_deletion_requests
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage all deletion requests
CREATE POLICY "Service role manages deletion requests"
  ON public.account_deletion_requests
  FOR ALL USING (auth.role() = 'service_role');

-- Admins can view all deletion requests
CREATE POLICY "Admins can view all deletion requests"
  ON public.account_deletion_requests
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Admins can update deletion requests
CREATE POLICY "Admins can update deletion requests"
  ON public.account_deletion_requests
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
