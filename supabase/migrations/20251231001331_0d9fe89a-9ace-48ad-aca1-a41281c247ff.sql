-- Create user_schedules table for persisting availability
CREATE TABLE public.user_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  slot_key TEXT NOT NULL, -- format: "YYYY-MM-DD_block"
  slot_date DATE NOT NULL,
  time_block TEXT NOT NULL CHECK (time_block IN ('morning', 'afternoon', 'evening', 'night')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'busy')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, slot_key)
);

-- Enable RLS
ALTER TABLE public.user_schedules ENABLE ROW LEVEL SECURITY;

-- Users can view their own schedule
CREATE POLICY "Users can view own schedule"
ON public.user_schedules
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own schedule slots
CREATE POLICY "Users can create own schedule slots"
ON public.user_schedules
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own schedule slots
CREATE POLICY "Users can update own schedule"
ON public.user_schedules
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own schedule slots
CREATE POLICY "Users can delete own schedule"
ON public.user_schedules
FOR DELETE
USING (auth.uid() = user_id);

-- Matched users can view each other's schedules for date planning
CREATE POLICY "Matched users can view each other schedules"
ON public.user_schedules
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.matches
    WHERE (matches.profile_id_1 = auth.uid() AND matches.profile_id_2 = user_schedules.user_id)
       OR (matches.profile_id_2 = auth.uid() AND matches.profile_id_1 = user_schedules.user_id)
  )
);

-- Index for fast lookups
CREATE INDEX idx_user_schedules_user_date ON public.user_schedules(user_id, slot_date);