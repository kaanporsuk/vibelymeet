-- Replace random-loop reference_id with a sequence-based approach
-- Sequences are atomic and concurrency-safe by design

CREATE SEQUENCE IF NOT EXISTS support_ticket_ref_seq
  START WITH 10001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- Replace the trigger function
CREATE OR REPLACE FUNCTION public.set_support_ticket_reference_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only set if not already provided
  IF NEW.reference_id IS NULL OR NEW.reference_id = '' THEN
    NEW.reference_id := 'VB-' || LPAD(nextval('support_ticket_ref_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger is already in place from the original migration
-- The function replacement above takes effect immediately
