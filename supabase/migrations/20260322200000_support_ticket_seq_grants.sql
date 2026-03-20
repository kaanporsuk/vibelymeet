-- Grant sequence permissions so nextval() succeeds when the trigger runs as
-- SECURITY INVOKER (default) during authenticated inserts on support_tickets.
GRANT USAGE, SELECT ON SEQUENCE public.support_ticket_ref_seq
  TO authenticated, anon, service_role;
