-- Event registration RPC-owned DML lockdown.
--
-- Direct authenticated writes to event_registrations can bypass the server-owned
-- registration, cancellation, Ready Gate, and date lifecycle RPCs. Keep normal
-- clients on SELECT-only table access for realtime/read hydration; all writes
-- must go through SECURITY DEFINER RPCs or service-role workers.

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can register for events"
  ON public.event_registrations;
DROP POLICY IF EXISTS "Users cannot insert event_registrations directly"
  ON public.event_registrations;
DROP POLICY IF EXISTS "Users can update own queue status"
  ON public.event_registrations;
DROP POLICY IF EXISTS "Users can unregister from events"
  ON public.event_registrations;
DROP POLICY IF EXISTS "Admins can delete event registrations"
  ON public.event_registrations;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.event_registrations
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.event_registrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_registrations TO service_role;

COMMENT ON TABLE public.event_registrations IS
  'Registration/admission ledger. Not a public attendee roster API; authenticated clients may SELECT through RLS for own registration/realtime hydration, but INSERT/UPDATE/DELETE are RPC/service-role owned.';

COMMENT ON FUNCTION public.update_participant_status(uuid, text) IS
  'Authenticated event presence/status RPC. Direct event_registrations writes are blocked for authenticated clients; this RPC owns client-requested browsing/idle/in_survey/offline transitions while preserving Ready Gate/date lifecycle authority.';

COMMENT ON FUNCTION public.register_for_event(uuid) IS
  'Authenticated event registration RPC. Direct authenticated inserts into event_registrations are blocked; this function owns self-registration eligibility and admission semantics.';

COMMENT ON FUNCTION public.cancel_event_registration(uuid) IS
  'Authenticated self-cancel RPC for event registrations. Direct authenticated deletes from event_registrations are blocked so event cutoff and terminal-state rules cannot be bypassed.';
