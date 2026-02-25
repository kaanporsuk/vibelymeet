
-- Add Daily room tracking to video_sessions
ALTER TABLE public.video_sessions 
  ADD COLUMN IF NOT EXISTS daily_room_name TEXT,
  ADD COLUMN IF NOT EXISTS daily_room_url TEXT;

-- Create match_calls table for voice/video calls between matches
CREATE TABLE IF NOT EXISTS public.match_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  call_type TEXT NOT NULL CHECK (call_type IN ('voice', 'video')),
  daily_room_name TEXT NOT NULL,
  daily_room_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for match_calls
ALTER TABLE public.match_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own calls" ON public.match_calls
  FOR SELECT USING (caller_id = auth.uid() OR callee_id = auth.uid());

CREATE POLICY "Users can insert calls for their matches" ON public.match_calls
  FOR INSERT WITH CHECK (caller_id = auth.uid());

CREATE POLICY "Users can update their own calls" ON public.match_calls
  FOR UPDATE USING (caller_id = auth.uid() OR callee_id = auth.uid());

-- Enable realtime for match_calls
ALTER PUBLICATION supabase_realtime ADD TABLE match_calls;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_match_calls_callee_status ON public.match_calls(callee_id, status) WHERE status = 'ringing';
CREATE INDEX IF NOT EXISTS idx_match_calls_match_id ON public.match_calls(match_id);
