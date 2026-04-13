-- Align prune_event_loop_observability_events with Phase 2/3 posture: not callable via PostgREST anon/authenticated.
-- (Default grants can leave EXECUTE on web client roles until explicitly revoked.)

REVOKE ALL ON FUNCTION public.prune_event_loop_observability_events(integer, integer) FROM anon, authenticated;
