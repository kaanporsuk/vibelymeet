-- Drop the overly broad UPDATE policy that allowed users to modify
-- admin reply content
DROP POLICY IF EXISTS "users_update_read_admin_replies"
  ON public.support_ticket_replies;

-- Revoke UPDATE grant from authenticated users on this table
REVOKE UPDATE ON public.support_ticket_replies FROM authenticated;

-- Safe RPC: only allows marking a specific admin reply as read
-- Users can only mark replies on their OWN tickets
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

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION public.mark_support_reply_read(uuid) TO authenticated;
