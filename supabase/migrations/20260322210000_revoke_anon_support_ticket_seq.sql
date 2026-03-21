-- Remove unnecessary anon privilege on support ticket reference sequence.
-- anon was granted USAGE/SELECT directly in the Supabase SQL editor
-- during an earlier fix session. Tickets require authentication.
REVOKE USAGE, SELECT ON SEQUENCE public.support_ticket_ref_seq FROM anon;
