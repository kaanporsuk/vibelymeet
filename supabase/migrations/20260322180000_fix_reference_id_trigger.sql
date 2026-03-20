-- Fix reference_id generation: handle whitespace + schema-qualify sequence
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
