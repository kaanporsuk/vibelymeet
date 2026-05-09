-- Server-owned chat overflow actions: per-user archive, validated mutes, and atomic unmatch.

CREATE TABLE IF NOT EXISTS public.match_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  archived_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_archives_user_archived
  ON public.match_archives (user_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_archives_match
  ON public.match_archives (match_id);

ALTER TABLE public.match_archives ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_archives TO authenticated;

DROP POLICY IF EXISTS "Users can view own match archives" ON public.match_archives;
DROP POLICY IF EXISTS "Users can create own match archives" ON public.match_archives;
DROP POLICY IF EXISTS "Users can update own match archives" ON public.match_archives;
DROP POLICY IF EXISTS "Users can delete own match archives" ON public.match_archives;

CREATE POLICY "Users can view own match archives"
ON public.match_archives FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own match archives"
ON public.match_archives FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = match_archives.match_id
      AND auth.uid() IN (m.profile_id_1, m.profile_id_2)
  )
);

CREATE POLICY "Users can update own match archives"
ON public.match_archives FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = match_archives.match_id
      AND auth.uid() IN (m.profile_id_1, m.profile_id_2)
  )
);

CREATE POLICY "Users can delete own match archives"
ON public.match_archives FOR DELETE TO authenticated
USING (auth.uid() = user_id);

INSERT INTO public.match_archives (match_id, user_id, archived_at, created_at, updated_at)
SELECT id, archived_by, archived_at, COALESCE(archived_at, now()), now()
FROM public.matches
WHERE archived_at IS NOT NULL
  AND archived_by IS NOT NULL
ON CONFLICT (match_id, user_id) DO UPDATE
SET archived_at = EXCLUDED.archived_at,
    updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'match_archives'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_archives;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can archive own matches" ON public.matches;

DROP POLICY IF EXISTS "Users can manage own match mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can view own match notification mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can create own match notification mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can update own match notification mutes" ON public.match_notification_mutes;
DROP POLICY IF EXISTS "Users can delete own match notification mutes" ON public.match_notification_mutes;

CREATE POLICY "Users can view own match notification mutes"
ON public.match_notification_mutes FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = match_notification_mutes.match_id
      AND auth.uid() IN (m.profile_id_1, m.profile_id_2)
  )
);

CREATE POLICY "Users can create own match notification mutes"
ON public.match_notification_mutes FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = match_notification_mutes.match_id
      AND auth.uid() IN (m.profile_id_1, m.profile_id_2)
  )
);

CREATE POLICY "Users can update own match notification mutes"
ON public.match_notification_mutes FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = match_notification_mutes.match_id
      AND auth.uid() IN (m.profile_id_1, m.profile_id_2)
  )
);

CREATE POLICY "Users can delete own match notification mutes"
ON public.match_notification_mutes FOR DELETE TO authenticated
USING (auth.uid() = user_id);

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
        'blocked_pair',
        'unmatched_pair'
      )
    );
END $$;

CREATE OR REPLACE FUNCTION public.set_match_archive_state(
  p_match_id uuid,
  p_archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_archived_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'match_not_found', 'error', 'match_not_found');
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  IF COALESCE(p_archived, false) THEN
    INSERT INTO public.match_archives (match_id, user_id, archived_at, updated_at)
    VALUES (p_match_id, v_uid, now(), now())
    ON CONFLICT (match_id, user_id) DO UPDATE
    SET archived_at = EXCLUDED.archived_at,
        updated_at = now()
    RETURNING archived_at INTO v_archived_at;

    RETURN jsonb_build_object(
      'success', true,
      'code', 'archived',
      'match_id', p_match_id,
      'archived_at', v_archived_at
    );
  END IF;

  DELETE FROM public.match_archives
  WHERE match_id = p_match_id
    AND user_id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'unarchived',
    'match_id', p_match_id,
    'archived_at', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_match_notification_mute(
  p_match_id uuid,
  p_duration text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_duration text := lower(btrim(COALESCE(p_duration, '')));
  v_muted_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'match_not_found', 'error', 'match_not_found');
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  v_muted_until := CASE v_duration
    WHEN '1hour' THEN now() + interval '1 hour'
    WHEN '1day' THEN now() + interval '1 day'
    WHEN '1week' THEN now() + interval '1 week'
    WHEN 'forever' THEN NULL
    ELSE NULL
  END;

  IF v_duration NOT IN ('1hour', '1day', '1week', 'forever') THEN
    RETURN jsonb_build_object('success', false, 'code', 'invalid_duration', 'error', 'invalid_duration');
  END IF;

  INSERT INTO public.match_notification_mutes (match_id, user_id, muted_until)
  VALUES (p_match_id, v_uid, v_muted_until)
  ON CONFLICT (user_id, match_id) DO UPDATE
  SET muted_until = EXCLUDED.muted_until;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'muted',
    'match_id', p_match_id,
    'duration', v_duration,
    'muted_until', v_muted_until
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_match_notification_mute(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_deleted int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'match_not_found', 'error', 'match_not_found');
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = p_match_id
    AND user_id = v_uid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', CASE WHEN v_deleted > 0 THEN 'unmuted' ELSE 'not_muted' END,
    'match_id', p_match_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.unmatch_match(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match public.matches%ROWTYPE;
  v_user_a uuid;
  v_user_b uuid;
  v_messages_deleted int := 0;
  v_mutes_deleted int := 0;
  v_archives_deleted int := 0;
  v_matches_deleted int := 0;
  v_match_calls_closed int := 0;
  v_date_proposals_closed int := 0;
  v_date_suggestions_closed int := 0;
  v_date_plans_closed int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unauthorized', 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'code', 'already_unmatched', 'match_id', p_match_id);
  END IF;

  IF v_uid NOT IN (v_match.profile_id_1, v_match.profile_id_2) THEN
    RETURN jsonb_build_object('success', false, 'code', 'access_denied', 'error', 'access_denied');
  END IF;

  v_user_a := v_match.profile_id_1;
  v_user_b := v_match.profile_id_2;

  UPDATE public.match_calls
  SET
    status = CASE WHEN status = 'ringing' THEN 'declined' ELSE 'ended' END,
    ended_at = COALESCE(ended_at, now()),
    ended_reason = COALESCE(ended_reason, 'unmatched_pair')
  WHERE match_id = p_match_id
    AND status IN ('ringing', 'active');
  GET DIAGNOSTICS v_match_calls_closed = ROW_COUNT;

  UPDATE public.date_proposals
  SET
    status = 'declined',
    responded_at = COALESCE(responded_at, now())
  WHERE match_id = p_match_id
    AND status = 'pending';
  GET DIAGNOSTICS v_date_proposals_closed = ROW_COUNT;

  UPDATE public.date_plans dp
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(dp.cancelled_at, now())
  FROM public.date_suggestions ds
  WHERE dp.id = ds.date_plan_id
    AND ds.match_id = p_match_id
    AND dp.status = 'active';
  GET DIAGNOSTICS v_date_plans_closed = ROW_COUNT;

  UPDATE public.date_suggestions
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE match_id = p_match_id
    AND status IN ('draft', 'proposed', 'viewed', 'countered');
  GET DIAGNOSTICS v_date_suggestions_closed = ROW_COUNT;

  DELETE FROM public.match_archives
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_archives_deleted = ROW_COUNT;

  DELETE FROM public.match_notification_mutes
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_mutes_deleted = ROW_COUNT;

  DELETE FROM public.messages
  WHERE match_id = p_match_id;
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  DELETE FROM public.matches
  WHERE id = p_match_id;
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'unmatched',
    'match_id', p_match_id,
    'unmatched_by', v_uid,
    'profile_id_1', v_user_a,
    'profile_id_2', v_user_b,
    'cleanup', jsonb_build_object(
      'messages_deleted', v_messages_deleted,
      'mutes_deleted', v_mutes_deleted,
      'archives_deleted', v_archives_deleted,
      'matches_deleted', v_matches_deleted,
      'match_calls_closed', v_match_calls_closed,
      'date_proposals_closed', v_date_proposals_closed,
      'date_suggestions_closed', v_date_suggestions_closed,
      'date_plans_closed', v_date_plans_closed
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_match_archive_state(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_match_archive_state(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.set_match_notification_mute(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_match_notification_mute(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.clear_match_notification_mute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_match_notification_mute(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unmatch_match(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.set_match_archive_state(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_match_notification_mute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_match_notification_mute(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmatch_match(uuid) TO authenticated;

COMMENT ON TABLE public.match_archives IS
  'Per-user archive state for matches. Archive is private organization state, not a mutual safety state.';

COMMENT ON FUNCTION public.set_match_archive_state(uuid, boolean) IS
  'Server-owned per-user archive/unarchive for a match after participant validation.';

COMMENT ON FUNCTION public.set_match_notification_mute(uuid, text) IS
  'Server-owned per-match notification mute. Duration is one of 1hour, 1day, 1week, forever; forever stores muted_until as NULL.';

COMMENT ON FUNCTION public.clear_match_notification_mute(uuid) IS
  'Server-owned per-match notification unmute after participant validation.';

COMMENT ON FUNCTION public.unmatch_match(uuid) IS
  'Atomically removes a match for both participants and cleans match-scoped messages, mutes, archive state, open calls, and date coordination rows.';
