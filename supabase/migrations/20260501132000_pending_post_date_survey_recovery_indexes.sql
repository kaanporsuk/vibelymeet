-- Support participant-scoped pending post-date survey recovery after current_room_id is cleared.
-- These are additive lookup indexes only; no state machine or RLS behavior changes.

CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_1_pending_survey
  ON public.video_sessions(participant_1_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND date_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_sessions_participant_2_pending_survey
  ON public.video_sessions(participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND date_started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_date_feedback_user_session
  ON public.date_feedback(user_id, session_id);
