-- Allow recipients to mark others' messages as read (RLS only allows sender to UPDATE rows)
CREATE OR REPLACE FUNCTION public.mark_match_messages_read(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = p_match_id
    AND (m.profile_id_1 = auth.uid() OR m.profile_id_2 = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;
  UPDATE public.messages
  SET read_at = now()
  WHERE match_id = p_match_id
    AND sender_id IS DISTINCT FROM auth.uid()
    AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_match_messages_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_match_messages_read(uuid) TO authenticated;
