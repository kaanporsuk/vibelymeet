-- Fix 1: Add UPDATE and DELETE policies for messages table
-- This allows users to edit and delete their own messages

CREATE POLICY "Users can update own messages"
ON public.messages FOR UPDATE
USING (auth.uid() = sender_id)
WITH CHECK (auth.uid() = sender_id AND length(content) > 0 AND length(content) <= 5000);

CREATE POLICY "Users can delete own messages"
ON public.messages FOR DELETE
USING (auth.uid() = sender_id);

-- Fix 2: Create server-side daily_drops table for rate limiting
-- This replaces localStorage-based tracking with database-enforced limits

CREATE TABLE public.daily_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  drop_date date NOT NULL DEFAULT CURRENT_DATE,
  dropped_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'replied', 'passed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, drop_date)
);

-- Enable RLS on daily_drops
ALTER TABLE public.daily_drops ENABLE ROW LEVEL SECURITY;

-- RLS policies for daily_drops
CREATE POLICY "Users can view own drops"
ON public.daily_drops FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own drops"
ON public.daily_drops FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drops"
ON public.daily_drops FOR UPDATE
USING (auth.uid() = user_id);

-- Create date_proposals table for server-side tracking
CREATE TABLE public.date_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  proposed_date timestamptz NOT NULL,
  time_block text NOT NULL CHECK (time_block IN ('morning', 'lunch', 'afternoon', 'evening', 'night')),
  activity text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- Enable RLS on date_proposals
ALTER TABLE public.date_proposals ENABLE ROW LEVEL SECURITY;

-- RLS policies for date_proposals
CREATE POLICY "Users can view own proposals"
ON public.date_proposals FOR SELECT
USING (auth.uid() = proposer_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can create proposals"
ON public.date_proposals FOR INSERT
WITH CHECK (auth.uid() = proposer_id);

CREATE POLICY "Recipients can respond to proposals"
ON public.date_proposals FOR UPDATE
USING (auth.uid() = recipient_id);