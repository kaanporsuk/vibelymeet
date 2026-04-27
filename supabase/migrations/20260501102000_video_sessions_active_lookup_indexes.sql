CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_1_active
  ON public.video_sessions(participant_1_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_2_active
  ON public.video_sessions(participant_2_id)
  WHERE ended_at IS NULL;
