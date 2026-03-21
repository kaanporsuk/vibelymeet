-- Idempotent: ensure RPC is schema-qualified (applies to DBs that already ran 20260322150000)
CREATE OR REPLACE FUNCTION public.mark_support_reply_read(p_reply_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE support_ticket_replies
  SET is_read = true
  WHERE id = p_reply_id
    AND sender_type = 'admin'
    AND EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = support_ticket_replies.ticket_id
        AND t.user_id = auth.uid()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_support_reply_read(uuid) TO authenticated;
