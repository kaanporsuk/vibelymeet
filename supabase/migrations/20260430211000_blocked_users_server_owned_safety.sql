-- Blocked Users server-owned safety contract.
-- Additive migration: keep historical migrations intact.

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_blocker
  ON public.blocked_users (blocked_id, blocker_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_calls_ended_reason_check'
      AND conrelid = 'public.match_calls'::regclass
  ) THEN
    ALTER TABLE public.match_calls
      DROP CONSTRAINT match_calls_ended_reason_check;
  END IF;

  ALTER TABLE public.match_calls
    ADD CONSTRAINT match_calls_ended_reason_check
    CHECK (
      ended_reason IS NULL
      OR ended_reason IN (
        'declined',
        'hangup',
        'caller_cancelled',
        'missed',
        'timeout',
        'join_failed',
        'stale_active',
        'provider_error',
        'busy',
        'blocked_pair'
      )
    );
END $$;

CREATE OR REPLACE FUNCTION public.block_user_with_cleanup(
  p_blocked_id uuid,
  p_reason text DEFAULT NULL,
  p_match_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_blocker_id uuid := auth.uid();
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
  v_inserted boolean := false;
  v_match_ids uuid[] := '{}'::uuid[];
  v_session_ids uuid[] := '{}'::uuid[];
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_matches_deleted int := 0;
  v_match_calls_closed int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
  v_daily_drops_invalidated int := 0;
  v_event_vibes_deleted int := 0;
  v_video_sessions_closed int := 0;
  v_registrations_cleared int := 0;
BEGIN
  IF v_blocker_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_blocked_id IS NULL OR p_blocked_id = v_blocker_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_target', 'error', 'invalid_target');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_blocker_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'profile_not_found', 'error', 'profile_not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_blocked_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'target_not_found', 'error', 'target_not_found');
  END IF;

  INSERT INTO public.blocked_users (blocker_id, blocked_id, reason)
  VALUES (v_blocker_id, p_blocked_id, v_reason)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING true INTO v_inserted;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_match_ids
  FROM (
    SELECT id
    FROM public.matches
    WHERE (profile_id_1 = LEAST(v_blocker_id, p_blocked_id)
       AND profile_id_2 = GREATEST(v_blocker_id, p_blocked_id))
       OR (profile_id_1 = v_blocker_id AND profile_id_2 = p_blocked_id)
       OR (profile_id_1 = p_blocked_id AND profile_id_2 = v_blocker_id)
    FOR UPDATE
  ) pair_matches;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
  INTO v_session_ids
  FROM (
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND (
        (participant_1_id = v_blocker_id AND participant_2_id = p_blocked_id)
        OR (participant_1_id = p_blocked_id AND participant_2_id = v_blocker_id)
      )
    FOR UPDATE
  ) pair_sessions;

  UPDATE public.match_calls
  SET
    status = CASE WHEN status = 'ringing' THEN 'declined' ELSE 'ended' END,
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'blocked_pair')
  WHERE (
      match_id = ANY(v_match_ids)
      OR (caller_id = v_blocker_id AND callee_id = p_blocked_id)
      OR (caller_id = p_blocked_id AND callee_id = v_blocker_id)
    )
    AND status IN ('ringing', 'active');
  GET DIAGNOSTICS v_match_calls_closed = ROW_COUNT;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE ((proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id)
      OR match_id = ANY(v_match_ids))
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND dp.status = 'active'
    AND (
      ds.match_id = ANY(v_match_ids)
      OR (ds.proposer_id = v_blocker_id AND ds.recipient_id = p_blocked_id)
      OR (ds.proposer_id = p_blocked_id AND ds.recipient_id = v_blocker_id)
    );
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE (match_id = ANY(v_match_ids)
      OR (proposer_id = v_blocker_id AND recipient_id = p_blocked_id)
      OR (proposer_id = p_blocked_id AND recipient_id = v_blocker_id))
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  UPDATE public.daily_drops
  SET
    status = 'invalidated',
    updated_at = now()
  WHERE user_a_id = LEAST(v_blocker_id, p_blocked_id)
    AND user_b_id = GREATEST(v_blocker_id, p_blocked_id)
    AND status IN ('active_unopened', 'active_viewed', 'active_opener_sent');
  GET DIAGNOSTICS v_daily_drops_invalidated = ROW_COUNT;

  DELETE FROM public.event_vibes
  WHERE (sender_id = v_blocker_id AND receiver_id = p_blocked_id)
     OR (sender_id = p_blocked_id AND receiver_id = v_blocker_id);
  GET DIAGNOSTICS v_event_vibes_deleted = ROW_COUNT;

  UPDATE public.video_sessions
  SET
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'blocked_pair'),
    state = 'ended'::public.video_date_state,
    state_updated_at = now(),
    phase = 'ended',
    ready_gate_status = CASE
      WHEN ready_gate_status IN ('forfeited', 'expired') THEN ready_gate_status
      ELSE 'forfeited'
    END
  WHERE id = ANY(v_session_ids);
  GET DIAGNOSTICS v_video_sessions_closed = ROW_COUNT;

  UPDATE public.event_registrations
  SET
    current_room_id = NULL,
    current_partner_id = NULL,
    queue_status = CASE
      WHEN queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date', 'in_survey') THEN 'browsing'
      ELSE queue_status
    END,
    last_active_at = now()
  WHERE current_room_id = ANY(v_session_ids)
     OR (profile_id = v_blocker_id AND current_partner_id = p_blocked_id)
     OR (profile_id = p_blocked_id AND current_partner_id = v_blocker_id);
  GET DIAGNOSTICS v_registrations_cleared = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = ANY(v_match_ids);
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'status', CASE WHEN COALESCE(v_inserted, false) THEN 'blocked' ELSE 'already_blocked' END,
    'blocked_id', p_blocked_id,
    'hint_match_id', p_match_id,
    'cleanup', jsonb_build_object(
      'matches_found', COALESCE(array_length(v_match_ids, 1), 0),
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'matches_deleted', v_matches_deleted,
      'match_calls_closed', v_match_calls_closed,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed,
      'daily_drops_invalidated', v_daily_drops_invalidated,
      'event_vibes_deleted', v_event_vibes_deleted,
      'video_sessions_closed', v_video_sessions_closed,
      'registrations_cleared', v_registrations_cleared
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_blocked_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_blocker_id uuid := auth.uid();
  v_deleted int := 0;
BEGIN
  IF v_blocker_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_blocked_id IS NULL OR p_blocked_id = v_blocker_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_target', 'error', 'invalid_target');
  END IF;

  DELETE FROM public.blocked_users
  WHERE blocker_id = v_blocker_id
    AND blocked_id = p_blocked_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', CASE WHEN v_deleted > 0 THEN 'unblocked' ELSE 'not_blocked' END,
    'status', CASE WHEN v_deleted > 0 THEN 'unblocked' ELSE 'not_blocked' END,
    'blocked_id', p_blocked_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_blocked_users()
RETURNS TABLE (
  id uuid,
  blocker_id uuid,
  blocked_id uuid,
  created_at timestamptz,
  reason text,
  display_name text,
  avatar_url text,
  photo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    b.id,
    b.blocker_id,
    b.blocked_id,
    b.created_at,
    b.reason,
    COALESCE(NULLIF(btrim(p.name), ''), 'Member') AS display_name,
    p.avatar_url,
    CASE
      WHEN p.photos IS NOT NULL AND array_length(p.photos, 1) >= 1 THEN p.photos[1]
      ELSE NULL
    END AS photo_url
  FROM public.blocked_users b
  LEFT JOIN public.profiles p ON p.id = b.blocked_id
  WHERE auth.uid() IS NOT NULL
    AND b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.submit_user_report(
  p_reported_id uuid,
  p_reason text,
  p_details text DEFAULT NULL,
  p_also_block boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_trim_reason text;
  v_details text;
  v_recent int;
  v_report_id uuid;
  v_block_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_reported_id IS NULL OR p_reported_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_target');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reported_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reported_not_found');
  END IF;

  v_trim_reason := lower(btrim(COALESCE(p_reason, '')));
  IF v_trim_reason NOT IN (
    'harassment',
    'fake',
    'inappropriate',
    'spam',
    'safety',
    'underage',
    'other'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reason');
  END IF;

  v_details := NULLIF(left(btrim(COALESCE(p_details, '')), 4000), '');

  SELECT count(*)::int
  INTO v_recent
  FROM public.user_reports
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.user_reports (
    reporter_id,
    reported_id,
    reason,
    details,
    also_blocked
  )
  VALUES (
    v_uid,
    p_reported_id,
    v_trim_reason,
    v_details,
    COALESCE(p_also_block, false)
  )
  RETURNING id INTO v_report_id;

  IF COALESCE(p_also_block, false) THEN
    v_block_result := public.block_user_with_cleanup(
      p_reported_id,
      'Reported: ' || v_trim_reason,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id,
    'block', v_block_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.daily_drop_transition(
  p_drop_id uuid,
  p_action text,
  p_text text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_drop public.daily_drops%ROWTYPE;
  v_actor uuid;
  v_now timestamptz := now();
  v_partner uuid;
  v_match_id uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_drop
  FROM public.daily_drops
  WHERE id = p_drop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'drop_not_found');
  END IF;

  IF v_actor <> v_drop.user_a_id AND v_actor <> v_drop.user_b_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  IF v_drop.expires_at <= v_now
     OR v_drop.status IN ('expired_no_action', 'expired_no_reply', 'passed', 'matched', 'invalidated') THEN
    RETURN jsonb_build_object(
      'success', true,
      'terminal', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  IF p_action = 'view' THEN
    IF v_actor = v_drop.user_a_id AND COALESCE(v_drop.user_a_viewed, false) = false THEN
      v_drop.user_a_viewed := true;
    ELSIF v_actor = v_drop.user_b_id AND COALESCE(v_drop.user_b_viewed, false) = false THEN
      v_drop.user_b_viewed := true;
    END IF;

    IF v_drop.status = 'active_unopened' THEN
      v_drop.status := 'active_viewed';
    END IF;

    UPDATE public.daily_drops
    SET
      user_a_viewed = v_drop.user_a_viewed,
      user_b_viewed = v_drop.user_b_viewed,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  IF p_action = 'send_opener' THEN
    IF v_drop.opener_sender_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF p_text IS NULL OR length(btrim(p_text)) = 0 OR length(p_text) > 140 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_text');
    END IF;

    IF v_actor = v_drop.user_a_id THEN
      v_partner := v_drop.user_b_id;
    ELSE
      v_partner := v_drop.user_a_id;
    END IF;

    IF public.is_blocked(v_actor, v_partner) THEN
      UPDATE public.daily_drops
      SET status = 'invalidated', updated_at = v_now
      WHERE id = p_drop_id
      RETURNING * INTO v_drop;

      RETURN jsonb_build_object(
        'success', false,
        'error', 'blocked_pair',
        'code', 'blocked_pair',
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    v_drop.opener_sender_id := v_actor;
    v_drop.opener_text := btrim(p_text);
    v_drop.opener_sent_at := v_now;
    v_drop.status := 'active_opener_sent';

    UPDATE public.daily_drops
    SET
      opener_sender_id = v_drop.opener_sender_id,
      opener_text = v_drop.opener_text,
      opener_sent_at = v_drop.opener_sent_at,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  IF p_action = 'send_reply' THEN
    IF v_drop.opener_sender_id IS NULL OR v_drop.opener_sender_id = v_actor THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_reply_actor');
    END IF;

    IF COALESCE(v_drop.chat_unlocked, false) THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'match_id', v_drop.match_id,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF p_text IS NULL OR length(btrim(p_text)) = 0 OR length(p_text) > 500 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_text');
    END IF;

    IF v_actor = v_drop.user_a_id THEN
      v_partner := v_drop.user_b_id;
    ELSE
      v_partner := v_drop.user_a_id;
    END IF;

    IF public.is_blocked(v_actor, v_partner) THEN
      UPDATE public.daily_drops
      SET status = 'invalidated', updated_at = v_now
      WHERE id = p_drop_id
      RETURNING * INTO v_drop;

      RETURN jsonb_build_object(
        'success', false,
        'error', 'blocked_pair',
        'code', 'blocked_pair',
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF v_drop.match_id IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, matched_at)
      VALUES (LEAST(v_actor, v_partner), GREATEST(v_actor, v_partner), v_now)
      RETURNING id INTO v_match_id;
    ELSE
      v_match_id := v_drop.match_id;
    END IF;

    IF v_match_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'match_creation_failed');
    END IF;

    IF v_drop.opener_sender_id IS NOT NULL AND v_drop.opener_text IS NOT NULL THEN
      INSERT INTO public.messages (match_id, sender_id, content, created_at)
      VALUES (
        v_match_id,
        v_drop.opener_sender_id,
        v_drop.opener_text,
        COALESCE(v_drop.opener_sent_at, v_now)
      );
    END IF;

    INSERT INTO public.messages (match_id, sender_id, content, created_at)
    VALUES (v_match_id, v_actor, btrim(p_text), v_now);

    UPDATE public.daily_drops
    SET
      reply_sender_id = v_actor,
      reply_text = btrim(p_text),
      reply_sent_at = v_now,
      chat_unlocked = true,
      match_id = v_match_id,
      status = 'matched',
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'match_id', v_match_id,
      'drop', row_to_json(v_drop)
    );
  END IF;

  IF p_action = 'pass' THEN
    IF v_drop.status = 'matched' OR v_drop.status = 'passed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', v_drop.status,
        'drop', row_to_json(v_drop)
      );
    END IF;

    IF v_drop.opener_sender_id IS NOT NULL OR v_drop.status = 'active_opener_sent' THEN
      RETURN jsonb_build_object('success', false, 'error', 'pass_not_allowed_after_opener');
    END IF;

    v_drop.passed_by_user_id := v_actor;
    v_drop.status := 'passed';

    UPDATE public.daily_drops
    SET
      passed_by_user_id = v_drop.passed_by_user_id,
      status = v_drop.status,
      updated_at = v_now
    WHERE id = p_drop_id
    RETURNING * INTO v_drop;

    RETURN jsonb_build_object(
      'success', true,
      'status', v_drop.status,
      'drop', row_to_json(v_drop)
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

DROP POLICY IF EXISTS "Public can view messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in their matches" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in own matches" ON public.messages;

CREATE POLICY "Users can view messages in own matches"
ON public.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = messages.match_id
      AND (auth.uid() = m.profile_id_1 OR auth.uid() = m.profile_id_2)
      AND NOT public.is_blocked(m.profile_id_1, m.profile_id_2)
  )
);

DROP POLICY IF EXISTS "Participants can view own sessions" ON public.video_sessions;

CREATE POLICY "Participants can view own sessions"
ON public.video_sessions
FOR SELECT
TO authenticated
USING (
  (auth.uid() = participant_1_id OR auth.uid() = participant_2_id)
  AND NOT public.is_blocked(participant_1_id, participant_2_id)
);

REVOKE ALL ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_blocked_users() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_blocked_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_user_report(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_drop_transition(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.block_user_with_cleanup(uuid, text, uuid) IS
  'Authenticated caller blocks one target and performs pair-scoped cleanup in one transaction. Idempotent on duplicate blocks.';

COMMENT ON FUNCTION public.unblock_user(uuid) IS
  'Authenticated caller unblocks one target. Does not restore deleted matches, messages, or history.';

COMMENT ON FUNCTION public.get_my_blocked_users() IS
  'Authenticated caller-only blocked-users list with safe profile display fields for settings UI hydration.';

COMMENT ON FUNCTION public.submit_user_report(uuid, text, text, boolean) IS
  'Server-owned user report path: validates reason, trims details, rate-limits (20/hour), optional block through block_user_with_cleanup.';

COMMENT ON FUNCTION public.daily_drop_transition(uuid, text, text) IS
  'Server-owned Daily Drop transition path with block re-check before opener/reply contact creation.';
