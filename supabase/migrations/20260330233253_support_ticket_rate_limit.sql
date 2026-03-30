-- Rate-limit ticket creation: max 5 tickets per user per hour
CREATE OR REPLACE FUNCTION public.check_support_ticket_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*)
  INTO recent_count
  FROM public.support_tickets
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 support tickets per hour'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Fire BEFORE INSERT, before the reference ID trigger
CREATE TRIGGER support_tickets_rate_limit
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.check_support_ticket_rate_limit();

-- Ensure the rate limit trigger fires first (alphabetical trigger name
-- makes "support_tickets_rate_limit" run before "support_tickets_set_reference").

