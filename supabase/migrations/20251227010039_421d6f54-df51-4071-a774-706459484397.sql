-- Fix: Add INSERT policy for video_sessions table
-- This allows participants to create video session records

CREATE POLICY "Participants can create video sessions" ON public.video_sessions
  FOR INSERT WITH CHECK (
    auth.uid() = participant_1_id OR auth.uid() = participant_2_id
  );