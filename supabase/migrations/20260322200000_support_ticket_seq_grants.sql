-- Grant sequence USAGE/SELECT for support_tickets reference_id generation.
-- anon excluded: support tickets require auth.
GRANT USAGE, SELECT ON SEQUENCE public.support_ticket_ref_seq
  TO authenticated, service_role;
