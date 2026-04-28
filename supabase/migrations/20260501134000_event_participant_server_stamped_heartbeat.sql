-- Server-stamped event participant heartbeat.
-- Clients may prove activity for their own registration, but the timestamp
-- remains server-owned and cannot be supplied by the client.

CREATE OR REPLACE FUNCTION public.mark_event_participant_heartbeat(
  p_event_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_registrations
  SET last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = v_uid;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_event_participant_heartbeat(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_event_participant_heartbeat(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.mark_event_participant_heartbeat(uuid) IS
  'Server-stamped heartbeat for the authenticated caller''s event registration. Does not accept client timestamps or alter queue_status.';

-- Compatibility bridge for older deployed web/native clients that still
-- directly update event_registrations.last_active_at. Existing RLS still decides
-- whether the row update is allowed, but any client-supplied timestamp is
-- replaced with server time. A later native-safe lockdown can reject direct
-- writes entirely after old binaries are no longer relevant.
CREATE OR REPLACE FUNCTION public.server_stamp_client_last_active_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.last_active_at IS DISTINCT FROM NEW.last_active_at
     AND current_user IN ('anon', 'authenticated') THEN
    NEW.last_active_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS event_registrations_server_stamp_client_last_active_at
  ON public.event_registrations;

CREATE TRIGGER event_registrations_server_stamp_client_last_active_at
BEFORE UPDATE OF last_active_at ON public.event_registrations
FOR EACH ROW
EXECUTE FUNCTION public.server_stamp_client_last_active_at();

COMMENT ON TRIGGER event_registrations_server_stamp_client_last_active_at
  ON public.event_registrations IS
  'Compatibility bridge for old clients: direct anon/authenticated last_active_at updates are accepted by existing RLS but server-overwritten to now().';
