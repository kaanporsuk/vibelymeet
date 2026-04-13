-- Sprint 3: chat media lifecycle + account-deletion retention wiring
--
-- Scope:
--   1. Chat media lifecycle for chat images, chat videos, chat thumbnails, voice
--   2. Account-deletion retention state integration for shared chat media
--   3. Safe worker rollout preparation (cron still disabled)
--
-- Design:
--   - Chat media retention is participant-based, not message-row-based.
--   - Each chat asset is kept alive by one active reference per retaining participant.
--   - This survives existing hard deletes of messages/matches.
--   - Eligibility rule is explicit and backend-owned:
--       media is purge-eligible only when neither participant remains in
--       retention_state = 'retain'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Chat retention settings move from Sprint 1 placeholder → live policy
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.media_retention_settings
SET eligible_days = COALESCE(eligible_days, 0),
    notes = CASE
      WHEN notes IS NULL OR notes LIKE 'FOUNDATION ONLY%' THEN
        'Sprint 3 — retain until no participant still retains the chat; default purge immediately when eligible.'
      ELSE notes
    END
WHERE media_family IN ('chat_image', 'chat_video', 'chat_video_thumbnail', 'voice_message');


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Durable per-participant chat retention state
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_media_retention_states (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id             uuid        NOT NULL,
  participant_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  participant_user_key text        NOT NULL,
  retention_state      text        NOT NULL DEFAULT 'retain'
    CHECK (retention_state IN ('retain', 'chat_deleted', 'account_deleted')),
  state_changed_at     timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_chat_media_retention_states UNIQUE (match_id, participant_user_key)
);

COMMENT ON TABLE public.chat_media_retention_states IS
  'Durable chat-media retention state per match participant. '
  'Rows survive message/match hard deletes so shared chat media can remain retained '
  'until both sides no longer retain the conversation.';

CREATE INDEX IF NOT EXISTS idx_chat_media_retention_states_match
  ON public.chat_media_retention_states (match_id);

CREATE INDEX IF NOT EXISTS idx_chat_media_retention_states_user
  ON public.chat_media_retention_states (participant_user_key, retention_state);

CREATE OR REPLACE FUNCTION public.chat_media_retention_states_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_media_retention_states_updated_at
  ON public.chat_media_retention_states;
CREATE TRIGGER trg_chat_media_retention_states_updated_at
  BEFORE UPDATE ON public.chat_media_retention_states
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_media_retention_states_set_updated_at();

ALTER TABLE public.chat_media_retention_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chat media retention states"
  ON public.chat_media_retention_states FOR SELECT
  USING (auth.uid()::text = participant_user_key);

CREATE POLICY "Service role full access to chat media retention states"
  ON public.chat_media_retention_states FOR ALL
  USING (auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend media_references ref_type for participant-retention refs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.media_references
  DROP CONSTRAINT IF EXISTS media_references_ref_type_check;

ALTER TABLE public.media_references
  ADD CONSTRAINT media_references_ref_type_check
  CHECK (ref_type IN (
    'profile_vibe_video',
    'profile_photo_slot',
    'profile_avatar',
    'message_attachment',
    'event_cover',
    'verification_selfie',
    'verification_reference',
    'chat_participant_retention'
  ));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper functions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_media_provider_path(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value text := NULLIF(trim(COALESCE(p_value, '')), '');
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := regexp_replace(v_value, '[?#].*$', '');

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+/', '');
  END IF;

  v_value := regexp_replace(v_value, '^/+', '');

  IF strpos(v_value, '..') > 0 THEN
    RETURN NULL;
  END IF;

  IF v_value LIKE 'photos/%'
     OR v_value LIKE 'chat-videos/%'
     OR v_value LIKE 'voice/%' THEN
    RETURN v_value;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_media_provider_path(text) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.extract_chat_image_path_from_content(
  p_content text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_content text := trim(COALESCE(p_content, ''));
  v_raw text;
BEGIN
  IF v_content = '' THEN
    RETURN NULL;
  END IF;

  IF v_content LIKE '__IMAGE__|%' THEN
    v_raw := trim(substring(v_content FROM length('__IMAGE__|') + 1));
    RETURN public.normalize_media_provider_path(v_raw);
  END IF;

  IF v_content ~* '^https?://\\S+$'
     AND v_content ~* '\\.(jpe?g|png|gif|webp)([?#].*)?$' THEN
    RETURN public.normalize_media_provider_path(v_content);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_chat_image_path_from_content(text) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_chat_media_retention_state(
  p_match_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state_id uuid;
  v_match public.matches%ROWTYPE;
BEGIN
  IF p_match_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'match id and user id are required';
  END IF;

  SELECT id INTO v_state_id
  FROM public.chat_media_retention_states
  WHERE match_id = p_match_id
    AND participant_user_key = p_user_id::text
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.chat_media_retention_states
    SET participant_user_id = COALESCE(participant_user_id, p_user_id)
    WHERE id = v_state_id;
    RETURN v_state_id;
  END IF;

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF v_match.profile_id_1 IS DISTINCT FROM p_user_id
     AND v_match.profile_id_2 IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'participant_not_in_match';
  END IF;

  INSERT INTO public.chat_media_retention_states (
    match_id,
    participant_user_id,
    participant_user_key
  ) VALUES (
    p_match_id,
    p_user_id,
    p_user_id::text
  )
  ON CONFLICT (match_id, participant_user_key) DO UPDATE
  SET participant_user_id = COALESCE(public.chat_media_retention_states.participant_user_id, EXCLUDED.participant_user_id)
  RETURNING id INTO v_state_id;

  RETURN v_state_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_chat_media_retention_state(uuid, uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_chat_media_retention_states_for_match(
  p_match_id uuid
)
RETURNS TABLE (
  state_id uuid,
  participant_user_id uuid,
  participant_user_key text,
  retention_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.ensure_chat_media_retention_state(p_match_id, v_match.profile_id_1);
  PERFORM public.ensure_chat_media_retention_state(p_match_id, v_match.profile_id_2);

  RETURN QUERY
  SELECT s.id, s.participant_user_id, s.participant_user_key, s.retention_state
  FROM public.chat_media_retention_states s
  WHERE s.match_id = p_match_id
  ORDER BY s.participant_user_key ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_chat_media_retention_states_for_match(uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.ensure_chat_media_asset(
  p_owner_user_id uuid,
  p_media_family text,
  p_provider_path text,
  p_legacy_table text DEFAULT 'matches',
  p_legacy_id text DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset_id uuid;
  v_status text := CASE
    WHEN p_status IN ('uploading', 'active') THEN p_status
    ELSE 'active'
  END;
  v_path text := public.normalize_media_provider_path(p_provider_path);
BEGIN
  IF p_media_family NOT IN ('chat_image', 'chat_video', 'chat_video_thumbnail', 'voice_message') THEN
    RAISE EXCEPTION 'invalid chat media family: %', p_media_family;
  END IF;

  IF v_path IS NULL THEN
    RAISE EXCEPTION 'provider path is required';
  END IF;

  SELECT id INTO v_asset_id
  FROM public.media_assets
  WHERE provider = 'bunny_storage'
    AND provider_path = v_path
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.media_assets
    SET media_family = p_media_family,
        owner_user_id = COALESCE(public.media_assets.owner_user_id, p_owner_user_id),
        legacy_table = CASE
          WHEN p_legacy_table = 'messages' THEN 'messages'
          ELSE COALESCE(public.media_assets.legacy_table, p_legacy_table)
        END,
        legacy_id = CASE
          WHEN p_legacy_table = 'messages' AND p_legacy_id IS NOT NULL THEN p_legacy_id
          ELSE COALESCE(public.media_assets.legacy_id, p_legacy_id)
        END,
        status = CASE
          WHEN v_status = 'active' THEN 'active'
          WHEN public.media_assets.status IN ('soft_deleted', 'purge_ready', 'failed') THEN v_status
          ELSE public.media_assets.status
        END,
        deleted_at = CASE WHEN v_status = 'active' THEN NULL ELSE deleted_at END,
        purge_after = CASE WHEN v_status = 'active' THEN NULL ELSE purge_after END,
        purged_at = CASE WHEN v_status = 'active' THEN NULL ELSE purged_at END,
        last_error = CASE WHEN v_status = 'active' THEN NULL ELSE last_error END
    WHERE id = v_asset_id;
  ELSE
    INSERT INTO public.media_assets (
      provider,
      media_family,
      owner_user_id,
      provider_path,
      status,
      legacy_table,
      legacy_id
    ) VALUES (
      'bunny_storage',
      p_media_family,
      p_owner_user_id,
      v_path,
      v_status,
      p_legacy_table,
      p_legacy_id
    )
    RETURNING id INTO v_asset_id;
  END IF;

  RETURN v_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_chat_media_asset(uuid, text, text, text, text, text) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.attach_chat_media_asset_to_match(
  p_match_id uuid,
  p_asset_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state record;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
BEGIN
  IF p_match_id IS NULL OR p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_id_and_asset_id_required');
  END IF;

  PERFORM public.ensure_chat_media_retention_states_for_match(p_match_id);

  UPDATE public.media_assets
  SET status = 'active',
      deleted_at = NULL,
      purge_after = NULL,
      purged_at = NULL,
      last_error = NULL
  WHERE id = p_asset_id
    AND status IN ('soft_deleted', 'purge_ready', 'failed');

  FOR v_state IN
    SELECT id, participant_user_key, retention_state
    FROM public.chat_media_retention_states
    WHERE match_id = p_match_id
    ORDER BY participant_user_key ASC
  LOOP
    IF v_state.retention_state <> 'retain' THEN
      CONTINUE;
    END IF;

    UPDATE public.media_references
    SET is_active = true,
        released_at = NULL,
        released_by = NULL
    WHERE asset_id = p_asset_id
      AND ref_type = 'chat_participant_retention'
      AND ref_table = 'chat_media_retention_states'
      AND ref_id = v_state.id::text
      AND is_active = false;

    IF FOUND THEN
      v_refs_reactivated := v_refs_reactivated + 1;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM public.media_references
      WHERE asset_id = p_asset_id
        AND ref_type = 'chat_participant_retention'
        AND ref_table = 'chat_media_retention_states'
        AND ref_id = v_state.id::text
        AND is_active = true
    ) THEN
      INSERT INTO public.media_references (
        asset_id, ref_type, ref_table, ref_id, ref_key, is_active
      ) VALUES (
        p_asset_id,
        'chat_participant_retention',
        'chat_media_retention_states',
        v_state.id::text,
        v_state.participant_user_key,
        true
      );
      v_refs_created := v_refs_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_chat_media_asset_to_match(uuid, uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.sync_chat_message_media(
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_message public.messages%ROWTYPE;
  v_asset_id uuid;
  v_attach_result jsonb;
  v_assets_synced integer := 0;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
  v_path text;
  v_thumb text;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_message
  FROM public.messages
  WHERE id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  v_path := public.extract_chat_image_path_from_content(v_message.content);
  IF v_path IS NOT NULL THEN
    v_asset_id := public.ensure_chat_media_asset(
      v_message.sender_id,
      'chat_image',
      v_path,
      'messages',
      v_message.id::text,
      'active'
    );
    v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
    v_assets_synced := v_assets_synced + 1;
    v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
    v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
  END IF;

  v_path := public.normalize_media_provider_path(v_message.video_url);
  IF v_path IS NOT NULL THEN
    v_asset_id := public.ensure_chat_media_asset(
      v_message.sender_id,
      'chat_video',
      v_path,
      'messages',
      v_message.id::text,
      'active'
    );
    v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
    v_assets_synced := v_assets_synced + 1;
    v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
    v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
  END IF;

  v_path := public.normalize_media_provider_path(v_message.audio_url);
  IF v_path IS NOT NULL THEN
    v_asset_id := public.ensure_chat_media_asset(
      v_message.sender_id,
      'voice_message',
      v_path,
      'messages',
      v_message.id::text,
      'active'
    );
    v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
    v_assets_synced := v_assets_synced + 1;
    v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
    v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
  END IF;

  v_payload := CASE
    WHEN jsonb_typeof(to_jsonb(v_message.structured_payload)) = 'object' THEN to_jsonb(v_message.structured_payload)
    ELSE '{}'::jsonb
  END;

  v_thumb := public.normalize_media_provider_path(v_payload->>'thumbnail_url');
  IF v_thumb IS NOT NULL AND COALESCE(v_message.message_kind, '') = 'vibe_clip' THEN
    v_asset_id := public.ensure_chat_media_asset(
      v_message.sender_id,
      'chat_video_thumbnail',
      v_thumb,
      'messages',
      v_message.id::text,
      'active'
    );
    v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
    v_assets_synced := v_assets_synced + 1;
    v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
    v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
  END IF;

  IF COALESCE(v_message.message_kind, '') = 'vibe_game'
     AND COALESCE(v_payload->>'game_type', '') = 'scavenger' THEN
    v_path := public.normalize_media_provider_path(v_payload->'payload'->>'sender_photo_url');
    IF v_path IS NOT NULL THEN
      v_asset_id := public.ensure_chat_media_asset(
        v_message.sender_id,
        'chat_image',
        v_path,
        'messages',
        v_message.id::text,
        'active'
      );
      v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
      v_assets_synced := v_assets_synced + 1;
      v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
      v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
    END IF;

    v_path := public.normalize_media_provider_path(v_payload->'payload'->>'receiver_photo_url');
    IF v_path IS NOT NULL THEN
      v_asset_id := public.ensure_chat_media_asset(
        v_message.sender_id,
        'chat_image',
        v_path,
        'messages',
        v_message.id::text,
        'active'
      );
      v_attach_result := public.attach_chat_media_asset_to_match(v_message.match_id, v_asset_id);
      v_assets_synced := v_assets_synced + 1;
      v_refs_created := v_refs_created + COALESCE((v_attach_result->>'refs_created')::integer, 0);
      v_refs_reactivated := v_refs_reactivated + COALESCE((v_attach_result->>'refs_reactivated')::integer, 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'assets_synced', v_assets_synced,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_chat_message_media(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_chat_message_media(uuid) TO service_role;


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
      participant_user_id = COALESCE(participant_user_id, p_user_id)
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


CREATE OR REPLACE FUNCTION public.restore_chat_match_participant(
  p_match_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_state_id uuid;
  v_asset record;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
  v_assets_reactivated integer := 0;
BEGIN
  v_state_id := public.ensure_chat_media_retention_state(p_match_id, p_user_id);

  UPDATE public.chat_media_retention_states
  SET retention_state = 'retain',
      state_changed_at = now(),
      participant_user_id = COALESCE(participant_user_id, p_user_id)
  WHERE id = v_state_id;

  FOR v_asset IN
    SELECT DISTINCT a.id, a.status
    FROM public.media_assets a
    JOIN public.media_references r ON r.asset_id = a.id
    JOIN public.chat_media_retention_states s ON s.id::text = r.ref_id
    WHERE r.ref_type = 'chat_participant_retention'
      AND r.ref_table = 'chat_media_retention_states'
      AND s.match_id = p_match_id
      AND a.media_family IN ('chat_image', 'chat_video', 'chat_video_thumbnail', 'voice_message')
      AND a.status <> 'purged'
  LOOP
    UPDATE public.media_assets
    SET status = 'active',
        deleted_at = NULL,
        purge_after = NULL,
        purged_at = NULL,
        last_error = NULL
    WHERE id = v_asset.id
      AND status IN ('soft_deleted', 'purge_ready', 'failed');

    IF FOUND THEN
      v_assets_reactivated := v_assets_reactivated + 1;
    END IF;

    UPDATE public.media_references
    SET is_active = true,
        released_at = NULL,
        released_by = NULL
    WHERE asset_id = v_asset.id
      AND ref_type = 'chat_participant_retention'
      AND ref_table = 'chat_media_retention_states'
      AND ref_id = v_state_id::text
      AND is_active = false;

    IF FOUND THEN
      v_refs_reactivated := v_refs_reactivated + 1;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM public.media_references
      WHERE asset_id = v_asset.id
        AND ref_type = 'chat_participant_retention'
        AND ref_table = 'chat_media_retention_states'
        AND ref_id = v_state_id::text
        AND is_active = true
    ) THEN
      INSERT INTO public.media_references (
        asset_id, ref_type, ref_table, ref_id, ref_key, is_active
      ) VALUES (
        v_asset.id,
        'chat_participant_retention',
        'chat_media_retention_states',
        v_state_id::text,
        p_user_id::text,
        true
      );
      v_refs_created := v_refs_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'state_id', v_state_id,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated,
    'assets_reactivated', v_assets_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_chat_match_participant(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_chat_match_participant(uuid, uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.apply_account_deletion_media_hold(
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
  v_refs_released integer := 0;
BEGIN
  FOR v_state IN
    SELECT DISTINCT match_id
    FROM public.chat_media_retention_states
    WHERE participant_user_key = p_user_id::text
  LOOP
    v_result := public.release_chat_match_participant(
      v_state.match_id,
      p_user_id,
      'account_deleted',
      'account_delete'
    );
    v_matches_touched := v_matches_touched + 1;
    v_refs_released := v_refs_released + COALESCE((v_result->>'refs_released')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'matches_touched', v_matches_touched,
    'refs_released', v_refs_released
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_account_deletion_media_hold(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_account_deletion_media_hold(uuid) TO service_role;


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
BEGIN
  FOR v_state IN
    SELECT DISTINCT match_id
    FROM public.chat_media_retention_states
    WHERE participant_user_key = p_user_id::text
      AND retention_state = 'account_deleted'
  LOOP
    v_result := public.restore_chat_match_participant(v_state.match_id, p_user_id);
    v_matches_touched := v_matches_touched + 1;
    v_refs_created := v_refs_created + COALESCE((v_result->>'refs_created')::integer, 0);
    v_refs_reactivated := v_refs_reactivated + COALESCE((v_result->>'refs_reactivated')::integer, 0);
    v_assets_reactivated := v_assets_reactivated + COALESCE((v_result->>'assets_reactivated')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'matches_touched', v_matches_touched,
    'refs_created', v_refs_created,
    'refs_reactivated', v_refs_reactivated,
    'assets_reactivated', v_assets_reactivated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion_media_hold(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion_media_hold(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.backfill_chat_message_media_lifecycle(
  p_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row record;
  v_result jsonb;
  v_processed integer := 0;
  v_assets_synced integer := 0;
BEGIN
  FOR v_row IN
    SELECT m.id
    FROM public.messages m
    WHERE public.extract_chat_image_path_from_content(m.content) IS NOT NULL
       OR public.normalize_media_provider_path(m.video_url) IS NOT NULL
       OR public.normalize_media_provider_path(m.audio_url) IS NOT NULL
       OR (
            COALESCE(m.message_kind, '') = 'vibe_clip'
            AND public.normalize_media_provider_path((to_jsonb(m.structured_payload)->>'thumbnail_url')) IS NOT NULL
          )
       OR (
            COALESCE(m.message_kind, '') = 'vibe_game'
            AND COALESCE((to_jsonb(m.structured_payload)->>'game_type'), '') = 'scavenger'
            AND (
              public.normalize_media_provider_path((to_jsonb(m.structured_payload)->'payload'->>'sender_photo_url')) IS NOT NULL
              OR public.normalize_media_provider_path((to_jsonb(m.structured_payload)->'payload'->>'receiver_photo_url')) IS NOT NULL
            )
          )
    ORDER BY m.created_at ASC
    LIMIT COALESCE(p_limit, 2147483647)
  LOOP
    v_result := public.sync_chat_message_media(v_row.id);
    v_processed := v_processed + 1;
    v_assets_synced := v_assets_synced + COALESCE((v_result->>'assets_synced')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'messages_processed', v_processed,
    'assets_synced', v_assets_synced
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_chat_message_media_lifecycle(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_chat_message_media_lifecycle(integer) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Triggers / automatic release on existing destructive match deletes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.before_match_delete_release_chat_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.release_chat_match_participant(
    OLD.id,
    OLD.profile_id_1,
    'chat_deleted',
    'unmatch'
  );

  PERFORM public.release_chat_match_participant(
    OLD.id,
    OLD.profile_id_2,
    'chat_deleted',
    'unmatch'
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_match_delete_release_chat_media
  ON public.matches;
CREATE TRIGGER trg_before_match_delete_release_chat_media
  BEFORE DELETE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.before_match_delete_release_chat_media();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Conservative backfill + pending deletion-hold replay
-- ─────────────────────────────────────────────────────────────────────────────

SELECT public.backfill_chat_message_media_lifecycle(NULL);

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT DISTINCT user_id
    FROM public.account_deletion_requests
    WHERE status = 'pending'
  LOOP
    PERFORM public.apply_account_deletion_media_hold(v_row.user_id);
  END LOOP;
END;
$$;
