-- Review-comments follow-up (PR #1316 Codex P2): let the release guard fall
-- through once the referenced session is terminal.
--
-- Defect: update_participant_status' first guard short-circuits ANY downgrade
-- (browsing/idle/in_survey/offline) whenever the registration is still
-- in_ready_gate/in_entry/in_date with a non-null current_room_id — regardless
-- of whether that room points at an already-ended session. That is the very
-- stale terminal-pointer state migration 20260612221535 set out to clear: an
-- in-gate registration whose session has ended can never reach the v_clear_room
-- logic below, so it stays pinned to a dead room pointer. (The second guard
-- already does the correct active-only check — it only returns when the session
-- is genuinely live/joined — so the first guard's unconditional return is the
-- gap.)
--
-- Fix (one site): the first guard now blocks the self-downgrade only while the
-- referenced session is still LIVE (NOT terminal). Once the session is terminal
-- (ended_at set, state='ended', or phase='ended' — the same markers the
-- v_clear_room check uses) the call falls through to the existing guards:
--   * a release status (browsing/idle/offline) then computes v_clear_room=true
--     and the UPDATE clears current_room_id/current_partner_id — the intended
--     stale-pointer cleanup;
--   * an in_survey target falls through to a normal queue_status='in_survey'
--     write, which is correct for a terminal session (the downstream survey
--     claim still gates on video_date_session_is_post_date_survey_eligible_v2,
--     so a non-eligible terminal session shows no survey).
-- This only relaxes the guard for provably-terminal sessions; it can never
-- newly block a release and cannot let a client escape a still-live gate
-- (sessions are terminal one-way, so there is no TOCTOU hazard).
--
-- Dependent scan (2026-06-13): no pg_depend view/function dependents; signature
-- unchanged; same security/search_path posture. Full live-body recreate (base
-- dumped from migration 20260613015625, the current live definition after the
-- queue_status vocab flip), patched at the single guard site.

CREATE OR REPLACE FUNCTION public.update_participant_status(p_event_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clear_room boolean := false;
  v_status text;
  v_current_status text;
  v_current_room_id uuid;
  v_has_active_joined_session boolean := false;
  v_has_pending_post_date_survey boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR btrim(p_status) = '' THEN
    RETURN;
  END IF;

  v_status := lower(btrim(p_status));
  IF v_status NOT IN (
    'browsing',
    'idle',
    'in_survey',
    'offline'
  ) THEN
    RETURN;
  END IF;

  SELECT queue_status, current_room_id
  INTO v_current_status, v_current_room_id
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND profile_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Block a self-downgrade only while the referenced session is still LIVE.
  -- A terminal current_room_id is stale bookkeeping; let it fall through to the
  -- release/clear and survey guards below (review follow-up, PR #1316 P2).
  IF v_current_room_id IS NOT NULL
     AND v_current_status IN ('in_ready_gate', 'in_entry', 'in_date')
     AND v_status IN ('browsing', 'idle', 'in_survey', 'offline')
     AND NOT EXISTS (
       SELECT 1
       FROM public.video_sessions vs
       WHERE vs.id = v_current_room_id
         AND (
           vs.ended_at IS NOT NULL
           OR vs.state::text = 'ended'
           OR COALESCE(vs.phase, '') = 'ended'
         )
     ) THEN
    RETURN;
  END IF;

  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND vs.ended_at IS NULL
        AND (
          vs.entry_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
        )
    )
    INTO v_has_active_joined_session;

    IF v_has_active_joined_session THEN
      RETURN;
    END IF;
  END IF;

  IF v_current_status = 'in_survey'
     AND v_status IN ('browsing', 'idle', 'offline') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND v_uid IN (vs.participant_1_id, vs.participant_2_id)
        AND (v_current_room_id IS NULL OR vs.id = v_current_room_id)
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
            AND df.user_id = v_uid
        )
    )
    INTO v_has_pending_post_date_survey;

    IF v_has_pending_post_date_survey THEN
      RETURN;
    END IF;
  END IF;

  -- A release status reaching this point with a room pointer at a terminal
  -- session means the pointer is stale bookkeeping: clear it so nothing can
  -- later key on current_room_id alone (2026-06-12 acceptance follow-up 2a).
  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND (
          vs.ended_at IS NOT NULL
          OR vs.state::text = 'ended'
          OR COALESCE(vs.phase, '') = 'ended'
        )
    )
    INTO v_clear_room;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    last_active_at = now(),
    current_room_id = CASE WHEN v_clear_room THEN NULL ELSE current_room_id END,
    current_partner_id = CASE WHEN v_clear_room THEN NULL ELSE current_partner_id END
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$
;
