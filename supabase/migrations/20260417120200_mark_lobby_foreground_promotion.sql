-- 20260417120200_mark_lobby_foreground_promotion.sql
-- Update mark_lobby_foreground to use canonical promotion helper

CREATE OR REPLACE FUNCTION public.mark_lobby_foreground(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.event_registrations
  SET
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = v_uid
    AND admission_status = 'confirmed';

  -- Call canonical promotion helper, ignore result
  PERFORM public.promote_ready_gate_if_eligible(p_event_id, v_uid);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_lobby_foreground(uuid) TO authenticated;
