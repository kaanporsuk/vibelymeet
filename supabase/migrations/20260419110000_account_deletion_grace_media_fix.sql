-- Sprint 3 follow-up: account deletion grace semantics for media lifecycle
--
-- Problem:
--   Sprint 3 initially treated a pending deletion request as final
--   `account_deleted` retention, which is too early for the grace window.
--
-- Fix:
--   1. Pending deletion becomes a reversible hold only.
--   2. Chat/media eligibility changes only at the actual completion event.
--   3. Existing pending rows that were prematurely finalized are repaired.

ALTER TABLE public.chat_media_retention_states
  ADD COLUMN IF NOT EXISTS account_deletion_pending_at timestamptz;

COMMENT ON COLUMN public.chat_media_retention_states.account_deletion_pending_at IS
  'Non-null while the participant has a reversible account-deletion request in the grace window. '
  'This does not itself release chat-media retention refs.';

CREATE INDEX IF NOT EXISTS idx_chat_media_retention_states_pending_hold
  ON public.chat_media_retention_states (participant_user_key, account_deletion_pending_at)
  WHERE account_deletion_pending_at IS NOT NULL;


CREATE OR REPLACE FUNCTION public.mark_chat_match_participant_deletion_pending(
  p_match_id uuid,
  p_user_id uuid,
  p_pending_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state_id uuid;
BEGIN
  v_state_id := public.ensure_chat_media_retention_state(p_match_id, p_user_id);

  UPDATE public.chat_media_retention_states
  SET participant_user_id = COALESCE(participant_user_id, p_user_id),
      account_deletion_pending_at = COALESCE(p_pending_at, now()),
      state_changed_at = CASE
        WHEN account_deletion_pending_at IS NULL THEN now()
        ELSE state_changed_at
      END
  WHERE id = v_state_id;

  RETURN jsonb_build_object(
    'success', true,
    'state_id', v_state_id,
    'pending', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_chat_match_participant_deletion_pending(uuid, uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_chat_match_participant_deletion_pending(uuid, uuid, timestamptz) TO service_role;


CREATE OR REPLACE FUNCTION public.apply_account_deletion_media_hold(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row record;
  v_result jsonb;
  v_matches_touched integer := 0;
  v_pending_states_marked integer := 0;
BEGIN
  FOR v_row IN
    SELECT DISTINCT m.id AS match_id
    FROM public.matches m
    WHERE m.profile_id_1 = p_user_id
       OR m.profile_id_2 = p_user_id

    UNION

    SELECT DISTINCT s.match_id
    FROM public.chat_media_retention_states s
    WHERE s.participant_user_key = p_user_id::text
  LOOP
    v_result := public.mark_chat_match_participant_deletion_pending(
      v_row.match_id,
      p_user_id,
      now()
    );

    IF COALESCE((v_result->>'success')::boolean, false) THEN
      v_matches_touched := v_matches_touched + 1;
      v_pending_states_marked := v_pending_states_marked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'matches_touched', v_matches_touched,
    'pending_states_marked', v_pending_states_marked,
    'refs_released', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_account_deletion_media_hold(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_account_deletion_media_hold(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.release_chat_match_participant(
  p_match_id uuid,
  p_user_id uuid,
  p_retention_state text,
  p_release_reason text DEFAULT 'user_action'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state_id uuid;
  v_ref record;
  v_refs_released integer := 0;
  v_remaining_retainers integer := 0;
  v_reason text := CASE
    WHEN p_retention_state = 'account_deleted' THEN 'account_delete'
    ELSE COALESCE(NULLIF(trim(COALESCE(p_release_reason, '')), ''), 'user_action')
  END;
BEGIN
  IF p_retention_state NOT IN ('chat_deleted', 'account_deleted') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_retention_state');
  END IF;

  v_state_id := public.ensure_chat_media_retention_state(p_match_id, p_user_id);

  UPDATE public.chat_media_retention_states
  SET retention_state = p_retention_state,
      state_changed_at = now(),
      participant_user_id = COALESCE(participant_user_id, p_user_id),
      account_deletion_pending_at = CASE
        WHEN p_retention_state = 'account_deleted' THEN NULL
        ELSE account_deletion_pending_at
      END
  WHERE id = v_state_id;

  FOR v_ref IN
    SELECT id
    FROM public.media_references
    WHERE ref_type = 'chat_participant_retention'
      AND ref_table = 'chat_media_retention_states'
      AND ref_id = v_state_id::text
      AND is_active = true
  LOOP
    PERFORM public.release_media_reference(v_ref.id, v_reason);
    v_refs_released := v_refs_released + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining_retainers
  FROM public.chat_media_retention_states
  WHERE match_id = p_match_id
    AND retention_state = 'retain';

  RETURN jsonb_build_object(
    'success', true,
    'state_id', v_state_id,
    'refs_released', v_refs_released,
    'retention_state', p_retention_state,
    'remaining_retainers', v_remaining_retainers,
    'eligible', (v_remaining_retainers = 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_chat_match_participant(uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_chat_match_participant(uuid, uuid, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.cancel_account_deletion_media_hold(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state record;
  v_result jsonb;
  v_matches_touched integer := 0;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
  v_assets_reactivated integer := 0;
  v_pending_states_cleared integer := 0;
BEGIN
  FOR v_state IN
    SELECT DISTINCT match_id, retention_state
    FROM public.chat_media_retention_states
    WHERE participant_user_key = p_user_id::text
      AND account_deletion_pending_at IS NOT NULL
  LOOP
    v_matches_touched := v_matches_touched + 1;

    IF v_state.retention_state = 'account_deleted' THEN
      v_result := public.restore_chat_match_participant(v_state.match_id, p_user_id);
      v_refs_created := v_refs_created + COALESCE((v_result->>'refs_created')::integer, 0);
      v_refs_reactivated := v_refs_reactivated + COALESCE((v_result->>'refs_reactivated')::integer, 0);
      v_assets_reactivated := v_assets_reactivated + COALESCE((v_result->>'assets_reactivated')::integer, 0);
    END IF;
  END LOOP;

  UPDATE public.chat_media_retention_states
  SET account_deletion_pending_at = NULL,
      participant_user_id = COALESCE(participant_user_id, p_user_id),
      state_changed_at = CASE
        WHEN account_deletion_pending_at IS NOT NULL THEN now()
        ELSE state_changed_at
      END
  WHERE participant_user_key = p_user_id::text
    AND account_deletion_pending_at IS NOT NULL;

  GET DIAGNOSTICS v_pending_states_cleared = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'matches_touched', v_matches_touched,
    'pending_states_cleared', v_pending_states_cleared,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated,
    'assets_reactivated', v_assets_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion_media_hold(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion_media_hold(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.complete_account_deletion_media_cleanup(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_match record;
  v_result jsonb;
  v_profile_exists boolean := false;
  v_matches_touched integer := 0;
  v_chat_refs_released integer := 0;
  v_photo_refs_released integer := 0;
  v_photo_assets_soft_deleted integer := 0;
  v_vibe_refs_released integer := 0;
  v_sync_result jsonb;
  v_clear_vibe_result jsonb;
BEGIN
  FOR v_match IN
    SELECT DISTINCT s.match_id
    FROM public.chat_media_retention_states s
    WHERE s.participant_user_key = p_user_id::text
  LOOP
    v_result := public.release_chat_match_participant(
      v_match.match_id,
      p_user_id,
      'account_deleted',
      'account_delete'
    );

    IF COALESCE((v_result->>'success')::boolean, false) THEN
      v_matches_touched := v_matches_touched + 1;
      v_chat_refs_released := v_chat_refs_released + COALESCE((v_result->>'refs_released')::integer, 0);
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
  ) INTO v_profile_exists;

  IF v_profile_exists THEN
    UPDATE public.profiles
    SET photos = ARRAY[]::text[],
        avatar_url = NULL
    WHERE id = p_user_id;

    v_sync_result := public.sync_profile_photo_media(p_user_id, ARRAY[]::text[], NULL);
    v_photo_refs_released := COALESCE((v_sync_result->>'refs_released')::integer, 0);
    v_photo_assets_soft_deleted := COALESCE((v_sync_result->>'assets_soft_deleted')::integer, 0);

    v_clear_vibe_result := public.clear_profile_vibe_video(
      p_user_id,
      true,
      'account_delete'
    );
    v_vibe_refs_released := COALESCE((v_clear_vibe_result->>'references_released')::integer, 0);
  END IF;

  UPDATE public.chat_media_retention_states
  SET account_deletion_pending_at = NULL
  WHERE participant_user_key = p_user_id::text;

  RETURN jsonb_build_object(
    'success', true,
    'matches_touched', v_matches_touched,
    'chat_refs_released', v_chat_refs_released,
    'photo_refs_released', v_photo_refs_released,
    'photo_assets_soft_deleted', v_photo_assets_soft_deleted,
    'vibe_refs_released', v_vibe_refs_released
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_deletion_media_cleanup(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_media_cleanup(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.account_deletion_requests_media_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.complete_account_deletion_media_cleanup(NEW.user_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'completed' AND COALESCE(OLD.status, '') IS DISTINCT FROM 'completed' THEN
      PERFORM public.complete_account_deletion_media_cleanup(NEW.user_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_deletion_requests_media_lifecycle
  ON public.account_deletion_requests;
CREATE TRIGGER trg_account_deletion_requests_media_lifecycle
  AFTER INSERT OR UPDATE OF status
  ON public.account_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.account_deletion_requests_media_lifecycle();


DO $$
DECLARE
  v_state record;
  v_req record;
BEGIN
  FOR v_state IN
    SELECT
      s.id AS state_id,
      s.match_id,
      COALESCE(s.participant_user_id, adr.user_id) AS user_id,
      adr.requested_at,
      EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.ref_table = 'chat_media_retention_states'
          AND r.ref_id = s.id::text
          AND r.released_by = 'account_delete'
      ) AS has_account_delete_release,
      EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.ref_table = 'chat_media_retention_states'
          AND r.ref_id = s.id::text
          AND r.released_by IN ('user_action', 'unmatch')
      ) AS has_non_account_delete_release
    FROM public.chat_media_retention_states s
    JOIN public.account_deletion_requests adr
      ON adr.user_id::text = s.participant_user_key
    WHERE adr.status = 'pending'
      AND s.retention_state = 'account_deleted'
  LOOP
    IF v_state.has_account_delete_release THEN
      PERFORM public.restore_chat_match_participant(v_state.match_id, v_state.user_id);
    ELSIF v_state.has_non_account_delete_release THEN
      UPDATE public.chat_media_retention_states
      SET retention_state = 'chat_deleted',
          participant_user_id = COALESCE(participant_user_id, v_state.user_id),
          state_changed_at = now()
      WHERE id = v_state.state_id;
    ELSE
      UPDATE public.chat_media_retention_states
      SET retention_state = 'retain',
          participant_user_id = COALESCE(participant_user_id, v_state.user_id),
          state_changed_at = now()
      WHERE id = v_state.state_id;
    END IF;
  END LOOP;

  FOR v_req IN
    SELECT user_id, MIN(requested_at) AS requested_at
    FROM public.account_deletion_requests
    WHERE status = 'pending'
    GROUP BY user_id
  LOOP
    PERFORM public.apply_account_deletion_media_hold(v_req.user_id);

    UPDATE public.chat_media_retention_states
    SET account_deletion_pending_at = COALESCE(account_deletion_pending_at, v_req.requested_at)
    WHERE participant_user_key = v_req.user_id::text;
  END LOOP;
END;
$$;
