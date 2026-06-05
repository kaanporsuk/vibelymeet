-- Repair registrations already downgraded by pre-hardening client lifecycle
-- writes. `update_participant_status` now prevents these writes, but affected
-- live rows should also match the sticky survey invariant until feedback exists.

UPDATE public.event_registrations er
SET
  queue_status = 'in_survey',
  last_active_at = COALESCE(GREATEST(er.last_active_at, vs.ended_at), er.last_active_at, vs.ended_at, now())
FROM public.video_sessions vs
WHERE er.current_room_id = vs.id
  AND er.profile_id IN (vs.participant_1_id, vs.participant_2_id)
  AND er.queue_status IN ('browsing', 'idle', 'offline')
  AND public.video_date_session_is_post_date_survey_eligible_v2(
    vs.ended_at,
    vs.ended_reason,
    vs.date_started_at,
    vs.state::text,
    vs.phase,
    vs.participant_1_joined_at,
    vs.participant_2_joined_at,
    vs.participant_1_remote_seen_at,
    vs.participant_2_remote_seen_at
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = vs.id
      AND df.user_id = er.profile_id
  );
