-- Replace random-loop reference_id with a sequence-based approach
-- Sequences are atomic and concurrency-safe by design

CREATE SEQUENCE IF NOT EXISTS support_ticket_ref_seq
  START WITH 10001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- Trigger function: final production shape (btrim, schema-qualified nextval,
-- SECURITY DEFINER + search_path for safe nextval without per-role sequence grants).
CREATE OR REPLACE FUNCTION public.set_support_ticket_reference_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
