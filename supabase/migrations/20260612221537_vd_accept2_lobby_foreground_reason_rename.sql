-- VD acceptance follow-up round 2 (item 2g): rename mark_lobby_foreground's
-- per-call observability reason from the vestigial 'queued_auto_promotion_removed'
-- (a queue-removal-era note that described a decision, not the operation) to
-- 'lobby_foreground_stamped'. The 'promotion_removed' detail key is kept as the
-- historical marker. Reader scan 2026-06-12: no live function, client, or Edge
-- source consumes the old reason; the two repo tests matching it pin historical
-- migration files, not live truth. Historical observability rows keep the old
-- reason (append-only ledger). Full live-body recreate, one-string patch.

CREATE OR REPLACE FUNCTION public.mark_lobby_foreground(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
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

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'mark_lobby_foreground',
    'success',
    'lobby_foreground_stamped',
    v_ms,
    p_event_id,
    v_uid,
    NULL,
    jsonb_build_object('promotion_removed', true)
  );
END;
$function$
;
