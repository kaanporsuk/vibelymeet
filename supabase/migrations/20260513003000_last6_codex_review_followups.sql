-- Follow-up to Codex review comments on the latest six PRs.
--
-- 1. Keep schedule-share entitlement enforcement inside the DB wrapper that
--    normalizes share_schedule payloads before legacy dispatch.
-- 2. Provide an aggregate Home unread summary so clients never page raw unread
--    messages before excluding archived conversations.

BEGIN;

CREATE OR REPLACE FUNCTION public.date_suggestion_apply(
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_plan_id_raw text := nullif(v_payload->>'plan_id', '');
  v_plan_id uuid;
  v_revision jsonb;
  v_share_raw text;
  v_time_choice text;
  v_share boolean;
BEGIN
  IF p_action = 'plan_mark_complete' THEN
    IF v_plan_id_raw IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'plan_id_required');
    END IF;

    BEGIN
      v_plan_id := v_plan_id_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_plan_id');
    END;

    RETURN public.date_plan_mark_complete_v2(v_plan_id);
  END IF;

  IF p_action IN ('send_proposal', 'counter') THEN
    IF jsonb_typeof(v_payload->'revision') IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'revision_fields_required');
    END IF;

    v_revision := v_payload->'revision';
    v_time_choice := coalesce(v_revision->>'time_choice_key', '');
    v_share_raw := lower(coalesce(v_revision->>'schedule_share_enabled', 'false'));
    IF v_share_raw IN ('true', 't', '1', 'yes') THEN
      v_share := true;
    ELSIF v_share_raw IN ('false', 'f', '0', 'no', 'off') THEN
      v_share := false;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_schedule_share_enabled');
    END IF;

    IF v_time_choice = 'share_schedule' THEN
      v_share := true;
    END IF;

    IF v_share THEN
      IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
      END IF;

      IF NOT public._get_user_tier_capability_bool_unchecked(v_uid, 'canUseVibeSchedule') THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'tier_capability_disabled',
          'error_code', 'tier_capability_disabled',
          'capability', 'canUseVibeSchedule'
        );
      END IF;
    END IF;

    IF v_time_choice = 'share_schedule' THEN
      v_revision := jsonb_set(v_revision, '{schedule_share_enabled}', 'true'::jsonb, true);
    END IF;

    IF v_revision ? 'selected_slot_keys' THEN
      IF v_revision->'selected_slot_keys' IS NULL
         OR jsonb_typeof(v_revision->'selected_slot_keys') = 'null' THEN
        v_revision := v_revision - 'selected_slot_keys';
      ELSIF jsonb_typeof(v_revision->'selected_slot_keys') <> 'array' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_slot_keys');
      ELSIF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_revision->'selected_slot_keys') AS elem(value)
        WHERE jsonb_typeof(elem.value) <> 'string'
           OR btrim(elem.value #>> '{}') = ''
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_slot_keys');
      ELSIF v_share AND jsonb_array_length(v_revision->'selected_slot_keys') = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
      ELSIF NOT v_share THEN
        v_revision := v_revision - 'selected_slot_keys';
      END IF;

      v_payload := jsonb_set(v_payload, '{revision}', v_revision, true);
    END IF;

    IF v_share AND NOT (v_revision ? 'selected_slot_keys') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
    END IF;
  ELSIF p_action = 'edit_schedule_share_slots' THEN
    IF v_payload->'selected_slot_keys' IS NULL
       OR jsonb_typeof(v_payload->'selected_slot_keys') = 'null' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'selected_slots_required');
    ELSIF jsonb_typeof(v_payload->'selected_slot_keys') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_slot_keys');
    ELSIF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_payload->'selected_slot_keys') AS elem(value)
      WHERE jsonb_typeof(elem.value) <> 'string'
         OR btrim(elem.value #>> '{}') = ''
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_slot_keys');
    END IF;
  END IF;

  RETURN public.date_suggestion_apply_legacy_dispatch_20260512(p_action, v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.date_suggestion_apply(text, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.date_suggestion_apply(text, jsonb) IS
  'Internal legacy date suggestion write RPC wrapper. Normalizes selected_slot_keys after schedule-share entitlement checks and routes plan_mark_complete to date_plan_mark_complete_v2.';

CREATE OR REPLACE FUNCTION public.get_home_unread_summary()
RETURNS TABLE(message_count integer, match_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH viewer AS (
    SELECT auth.uid() AS user_id
  ),
  visible_unread AS (
    SELECT msg.match_id
    FROM viewer
    JOIN public.messages msg
      ON viewer.user_id IS NOT NULL
     AND msg.read_at IS NULL
     AND msg.sender_id <> viewer.user_id
    JOIN public.matches mt
      ON mt.id = msg.match_id
     AND (mt.profile_id_1 = viewer.user_id OR mt.profile_id_2 = viewer.user_id)
     AND NOT public.is_blocked(mt.profile_id_1, mt.profile_id_2)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.match_archives archive
      WHERE archive.match_id = msg.match_id
        AND archive.user_id = viewer.user_id
    )
  )
  SELECT
    count(*)::integer AS message_count,
    count(DISTINCT visible_unread.match_id)::integer AS match_count
  FROM visible_unread;
$$;

REVOKE ALL ON FUNCTION public.get_home_unread_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_unread_summary() TO authenticated;

COMMENT ON FUNCTION public.get_home_unread_summary() IS
  'Returns aggregate unread message and match counts for the current user, excluding per-user archived conversations before counting.';

COMMIT;
