-- Persist first successful Daily join per participant for /date/[id] waiting-state UX (partner not in app vs ambiguous absence).

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS participant_1_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS participant_2_joined_at timestamptz;

COMMENT ON COLUMN public.video_sessions.participant_1_joined_at IS
  'First time participant_1 successfully joined the Daily room for this session (client RPC after call.join). Idempotent first stamp.';
COMMENT ON COLUMN public.video_sessions.participant_2_joined_at IS
  'First time participant_2 successfully joined the Daily room for this session (client RPC after call.join). Idempotent first stamp.';

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_ended');
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_uid = v_row.participant_1_id THEN
    UPDATE public.video_sessions
    SET participant_1_joined_at = COALESCE(participant_1_joined_at, now())
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET participant_2_joined_at = COALESCE(participant_2_joined_at, now())
    WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid) IS
  'Idempotent first stamp of Daily join time for the caller (participant_1 or participant_2).';
