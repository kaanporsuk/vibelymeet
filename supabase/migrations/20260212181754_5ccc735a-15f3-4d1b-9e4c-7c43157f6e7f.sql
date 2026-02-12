
-- Credit adjustments log for admin tracking
CREATE TABLE IF NOT EXISTS public.credit_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id uuid NOT NULL,
  user_id uuid NOT NULL,
  credit_type text NOT NULL,
  previous_value integer NOT NULL,
  new_value integer NOT NULL,
  adjustment_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage credit adjustments"
  ON public.credit_adjustments
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Add unique constraint on date_feedback for idempotency (session_id, user_id)
-- First check if it exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'date_feedback_session_user_unique'
  ) THEN
    ALTER TABLE public.date_feedback ADD CONSTRAINT date_feedback_session_user_unique UNIQUE (session_id, user_id);
  END IF;
END $$;
