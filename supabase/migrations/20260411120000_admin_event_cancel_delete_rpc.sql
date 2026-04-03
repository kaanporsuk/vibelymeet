-- Admin event lifecycle: server-owned cancel + transactional delete.
-- Cancel = status terminal (distinct from archive / end / delete). Delete = same dependent
-- ordering as the prior web admin client path; additional event-scoped rows rely on ON DELETE CASCADE from events.

-- ─── admin_cancel_event ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_cancel_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_archived_at timestamptz;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;

  SELECT e.archived_at, e.status
  INTO v_archived_at, v_status
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'archived');
  END IF;

  IF v_status IN ('cancelled', 'ended', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_terminal', 'status', v_status);
  END IF;

  UPDATE public.events
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_cancel_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_cancel_event(uuid) IS
  'Admin-only: set event.status = cancelled. Does not delete rows or archive; blocks archived and already-terminal statuses.';

-- ─── admin_delete_event ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Same explicit ordering as legacy AdminEventsPanel client deletes; remaining
  -- event_id FKs (e.g. event_reminder_queue, stripe_event_ticket_settlements)
  -- CASCADE when the event row is removed.
  DELETE FROM public.event_swipes WHERE event_id = p_event_id;
  DELETE FROM public.video_sessions WHERE event_id = p_event_id;
  DELETE FROM public.event_vibes WHERE event_id = p_event_id;
  DELETE FROM public.event_registrations WHERE event_id = p_event_id;
  DELETE FROM public.events WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_event(uuid) IS
  'Admin-only: transactionally delete an event after dependent rows (swipes, video_sessions, vibes, registrations).';
