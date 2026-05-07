-- Admin Support Inbox live drift guard.
--
-- Migration class: schema+policy cleanup.
-- Intent: re-assert realtime publication membership and least-privilege table
-- grants for the governed /kaan Support Inbox. This is a forward-only repair
-- for environments where the original support inbox migration is already
-- marked applied but publication/table grants drifted.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_replies;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_events;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_replies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.support_ticket_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_ticket_replies TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_ticket_attachments TO authenticated;
GRANT SELECT ON TABLE public.support_ticket_events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_tickets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_ticket_replies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_ticket_attachments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_ticket_events TO service_role;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508093000',
  'Admin Support Inbox live drift guard',
  'schema+policy',
  'Re-adds governed Support Inbox tables to realtime publication when absent and tightens table grants back to authenticated user SELECT/INSERT plus admin RPC/service-role authority. No support data is rewritten or deleted.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
