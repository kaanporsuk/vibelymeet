-- Replace random-loop reference_id with a sequence-based approach
-- Sequences are atomic and concurrency-safe by design

-- NOTE: After applying this migration in production, setval was run
-- manually to advance the sequence past any existing VB-##### values:
--   SELECT setval('public.support_ticket_ref_seq', GREATEST(10001,
--     COALESCE((SELECT MAX(CAST(NULLIF(regexp_replace(reference_id,
--     '[^0-9]', '', 'g'), '') AS integer)) FROM support_tickets
--     WHERE reference_id ~ '^VB-[0-9]+$'), 10000) + 1), false);
-- This ensures no UNIQUE constraint collisions on first use.
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_ref_seq
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
