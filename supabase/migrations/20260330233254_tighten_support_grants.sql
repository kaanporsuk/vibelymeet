-- Tighten GRANTs on support tables: users only need SELECT + INSERT.

-- Remove unnecessary UPDATE and DELETE grants from authenticated
-- on support_tickets. Users should only SELECT and INSERT.
REVOKE UPDATE, DELETE ON public.support_tickets FROM authenticated;

-- Tighten support_ticket_replies: users only need SELECT + INSERT.
REVOKE UPDATE, DELETE ON public.support_ticket_replies FROM authenticated;

-- Tighten support_ticket_attachments: users only need SELECT + INSERT.
REVOKE UPDATE, DELETE ON public.support_ticket_attachments FROM authenticated;

-- Ensure service_role retains full access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_replies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_attachments TO service_role;

