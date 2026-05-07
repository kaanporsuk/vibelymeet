-- Close authenticated self-cancellation once an event starts or reaches terminal truth.
-- Admin registration removal remains available through admin RPCs for support workflows.

CREATE OR REPLACE FUNCTION public.cancel_event_registration(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event record;
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_event');
  END IF;

  SELECT e.id, e.status, e.event_date, e.ended_at, e.archived_at
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_not_found');
  END IF;

  IF v_event.event_date IS NULL
     OR v_event.archived_at IS NOT NULL
     OR v_event.ended_at IS NOT NULL
     OR lower(COALESCE(v_event.status, '')) IN ('draft', 'cancelled', 'ended', 'completed')
     OR (v_event.event_date IS NOT NULL AND now() >= v_event.event_date) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'cancellation_closed',
      'code', 'CANCELLATION_CLOSED'
    );
  END IF;

  DELETE FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_deleted > 0,
    'rows_deleted', v_deleted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_event_registration(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(uuid) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507215000',
  'Event registration self-cancel cutoff',
  'schema-only',
  'Replaces authenticated self-cancel RPC to reject cancellation once an event starts, ends, is archived, or is terminal. No data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.cancel_event_registration(uuid) IS
  'Authenticated self-cancel for event registrations. Closes when the event start is missing, once the event starts, or once terminal/archived truth is present; admin removal remains available through governed admin RPCs.';
