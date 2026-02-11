
-- ========================================
-- PROMPT 3: User Credits Table
-- ========================================
CREATE TABLE public.user_credits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  extra_time_credits INTEGER NOT NULL DEFAULT 0,
  extended_vibe_credits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

-- Users can view their own credits
CREATE POLICY "Users can view own credits"
ON public.user_credits FOR SELECT
USING (auth.uid() = user_id);

-- Users can update their own credits (for deduction during date)
CREATE POLICY "Users can update own credits"
ON public.user_credits FOR UPDATE
USING (auth.uid() = user_id);

-- Users can create own credit row
CREATE POLICY "Users can create own credits"
ON public.user_credits FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Admins can view all credits
CREATE POLICY "Admins can view all credits"
ON public.user_credits FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update any credits (for granting)
CREATE POLICY "Admins can update all credits"
ON public.user_credits FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert credits for any user
CREATE POLICY "Admins can insert credits"
ON public.user_credits FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_user_credits_updated_at
BEFORE UPDATE ON public.user_credits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- PROMPT 4: Ready Gate columns on video_sessions
-- ========================================
ALTER TABLE public.video_sessions
ADD COLUMN ready_gate_status TEXT NOT NULL DEFAULT 'waiting',
ADD COLUMN ready_participant_1_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN ready_participant_2_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN ready_gate_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN snoozed_by UUID,
ADD COLUMN snooze_expires_at TIMESTAMP WITH TIME ZONE;
