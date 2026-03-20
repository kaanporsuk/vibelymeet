-- Replace random-loop reference_id with a sequence-based approach
-- Sequences are atomic and concurrency-safe by design

CREATE SEQUENCE IF NOT EXISTS support_ticket_ref_seq
  START WITH 10001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- Replace the trigger function (SECURITY INVOKER: callers need sequence USAGE;
-- see 20260322200000_support_ticket_seq_grants.sql.)
CREATE OR REPLACE FUNCTION public.set_support_ticket_reference_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.reference_id, '')), '') IS NULL THEN
    NEW.reference_id := 'VB-' || LPAD(
      nextval('public.support_ticket_ref_seq'::regclass)::text,
      5,
      '0'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger is already in place from the original migration
-- The function replacement above takes effect immediately
