-- Admin unarchive status-only archived repair.
--
-- Migration classification: function-only.
-- Intent: keep the admin Unarchive action effective for legacy rows that are
-- represented as archived by raw status alone, with archived_at absent.

CREATE OR REPLACE FUNCTION public.admin_unarchive_event(
  p_event_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_before public.events%ROWTYPE;
  v_after public.events%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_unarchive_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  UPDATE public.events
  SET archived_at = NULL,
      archived_by = NULL,
      status = CASE
        WHEN lower(COALESCE(status, '')) = 'archived' THEN NULL
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.unarchive',
    'event',
    p_event_id,
    jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_unarchive_event', p_idempotency_key, v_response);
END;
$function$;

COMMENT ON FUNCTION public.admin_unarchive_event(uuid, text, text) IS
  'Admin-only idempotent event unarchive. Clears archived_at/archived_by and repairs legacy status-only archived rows by clearing raw status.';
