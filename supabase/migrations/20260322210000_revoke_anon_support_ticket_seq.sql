-- Remove unnecessary anon privilege on support ticket reference sequence
-- (20260322200000 previously granted anon; tickets require authentication.)
REVOKE USAGE, SELECT ON SEQUENCE public.support_ticket_ref_seq FROM anon;
