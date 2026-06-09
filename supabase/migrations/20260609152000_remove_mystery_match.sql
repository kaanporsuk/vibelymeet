-- Hard-remove Mystery Match from the live backend.
-- Historical applied migrations are intentionally left intact; this forward
-- migration removes the active RPC chain, cleans test Mystery Match sessions,
-- and keeps session_source constrained to reciprocal swipe sessions.

CREATE TEMP TABLE mystery_match_sessions_to_delete ON COMMIT DROP AS
SELECT
  id,
  event_id,
  participant_1_id,
  participant_2_id
FROM public.video_sessions
WHERE session_source = 'mystery_match';

UPDATE public.event_registrations er
SET
  current_room_id = CASE
    WHEN er.current_room_id IN (SELECT id FROM mystery_match_sessions_to_delete) THEN NULL
    ELSE er.current_room_id
  END,
  current_partner_id = CASE
    WHEN er.current_room_id IN (SELECT id FROM mystery_match_sessions_to_delete)
      OR er.ready_gate_suppressed_session_id IN (SELECT id FROM mystery_match_sessions_to_delete)
      THEN NULL
    ELSE er.current_partner_id
  END,
  ready_gate_suppressed_session_id = CASE
    WHEN er.ready_gate_suppressed_session_id IN (SELECT id FROM mystery_match_sessions_to_delete) THEN NULL
    ELSE er.ready_gate_suppressed_session_id
  END,
  queue_status = CASE
    WHEN (
      er.current_room_id IN (SELECT id FROM mystery_match_sessions_to_delete)
      OR er.ready_gate_suppressed_session_id IN (SELECT id FROM mystery_match_sessions_to_delete)
    )
    AND COALESCE(er.queue_status, 'idle') IN ('in_ready_gate', 'in_handshake', 'in_date', 'in_survey', 'queued')
      THEN 'browsing'
    ELSE er.queue_status
  END
WHERE er.current_room_id IN (SELECT id FROM mystery_match_sessions_to_delete)
  OR er.ready_gate_suppressed_session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_provider_outbox_failure_log
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_provider_dead_letters
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_provider_outbox
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_orphan_room_cleanup_audit
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_daily_webhook_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_presence_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_surface_claims
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_ready_gate_entries
WHERE video_session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_credit_extension_spends
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_certification_feedback_exceptions
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_date_extension_requests
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.post_date_zero_feedback_reminders
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.post_date_pending_verdicts
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.post_date_client_submissions
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.date_feedback
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.event_profile_impression_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.event_profile_impressions
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.event_loop_observability_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_session_participant_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_session_events
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_session_deadlines
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_session_commands
WHERE session_id IN (SELECT id FROM mystery_match_sessions_to_delete);

DELETE FROM public.video_sessions
WHERE id IN (SELECT id FROM mystery_match_sessions_to_delete);

UPDATE public.video_sessions
SET session_source = 'reciprocal_swipe'
WHERE session_source IS DISTINCT FROM 'reciprocal_swipe';

ALTER TABLE public.video_sessions
  ALTER COLUMN session_source SET DEFAULT 'reciprocal_swipe';

ALTER TABLE public.video_sessions
  DROP CONSTRAINT IF EXISTS video_sessions_session_source_rec_swipe_only;

ALTER TABLE public.video_sessions
  ADD CONSTRAINT video_sessions_session_source_rec_swipe_only
  CHECK (session_source = 'reciprocal_swipe') NOT VALID;

ALTER TABLE public.video_sessions
  VALIDATE CONSTRAINT video_sessions_session_source_rec_swipe_only;

COMMENT ON COLUMN public.video_sessions.session_source IS
  'Creation source for Video Date sessions. Mystery Match was removed; reciprocal_swipe is the only supported value.';

DROP FUNCTION IF EXISTS public.find_mystery_match(uuid, uuid);
DROP FUNCTION IF EXISTS public.find_mystery_match_20260501180000_active_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.find_mystery_match_20260502083000_active_base(uuid, uuid);
DROP FUNCTION IF EXISTS public.find_mystery_match_20260607103000_session_source_base(uuid, uuid);
