-- Sprint 3 follow-up: authenticated wrapper for one-sided chat-retention release
--
-- This does not change current UI behavior. It exposes the backend-owned
-- participant retention transition as a safe authenticated RPC so the product
-- can later add "delete chat for me" without re-architecting the media model.

CREATE OR REPLACE FUNCTION public.delete_chat_for_current_user(
  p_match_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE id = p_match_id
      AND (profile_id_1 = v_uid OR profile_id_2 = v_uid)
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.chat_media_retention_states
    WHERE match_id = p_match_id
      AND participant_user_key = v_uid::text
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  RETURN public.release_chat_match_participant(
    p_match_id,
    v_uid,
    'chat_deleted',
    'user_action'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_chat_for_current_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_chat_for_current_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_for_current_user(uuid) TO service_role;
