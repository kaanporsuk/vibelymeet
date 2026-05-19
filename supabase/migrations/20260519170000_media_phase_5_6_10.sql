-- Phase 5.6-5.10 closure support:
-- - route chat media retention attaches through attach_media_reference()
-- - expose the active event-cover asset id to admin clients for stale cover guards

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
  v_attach_result jsonb;
  v_refs_created integer := 0;
  v_refs_reactivated integer := 0;
BEGIN
  IF p_match_id IS NULL OR p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'match_id_and_asset_id_required');
  END IF;

  PERFORM public.ensure_chat_media_retention_states_for_match(p_match_id);

  FOR v_state IN
    SELECT id, participant_user_key, retention_state
    FROM public.chat_media_retention_states
    WHERE match_id = p_match_id
    ORDER BY participant_user_key ASC
  LOOP
    IF v_state.retention_state <> 'retain' THEN
      CONTINUE;
    END IF;

    v_attach_result := public.attach_media_reference(
      p_asset_id,
      'chat_participant_retention',
      'chat_media_retention_states',
      v_state.id::text,
      v_state.participant_user_key
    );

    IF COALESCE((v_attach_result->>'success')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', COALESCE(v_attach_result->>'error', 'chat_media_reference_attach_failed'),
        'refs_created', v_refs_created,
        'refs_reactivated', v_refs_reactivated
      );
    END IF;

    IF COALESCE((v_attach_result->>'created')::boolean, false) THEN
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

CREATE OR REPLACE FUNCTION public.replace_event_cover_media_reference(
  p_event_id uuid,
  p_asset_id uuid,
  p_expected_current_asset_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_asset_id uuid;
  v_ref record;
  v_attach_result jsonb;
  v_reference_id uuid;
  v_release_result jsonb;
  v_released_count integer := 0;
BEGIN
  IF p_event_id IS NULL OR p_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_id_and_asset_id_required');
  END IF;

  PERFORM 1
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_not_found');
  END IF;

  SELECT r.asset_id
  INTO v_current_asset_id
  FROM public.media_references r
  WHERE r.ref_type = 'event_cover'
    AND r.ref_table = 'events'
    AND r.ref_id = p_event_id::text
    AND r.ref_key = 'cover_image'
    AND r.is_active = true
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_current_asset_id IS DISTINCT FROM p_expected_current_asset_id
     AND v_current_asset_id IS DISTINCT FROM p_asset_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'stale_cover_update',
      'code', 'stale_cover_update',
      'current_cover_asset_id', v_current_asset_id
    );
  END IF;

  v_attach_result := public.attach_media_reference(
    p_asset_id,
    'event_cover',
    'events',
    p_event_id::text,
    'cover_image'
  );

  IF COALESCE((v_attach_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_attach_result->>'error', 'event_cover_reference_attach_failed')
    );
  END IF;

  v_reference_id := NULLIF(v_attach_result->>'reference_id', '')::uuid;
  IF v_reference_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_cover_reference_attach_missing_id');
  END IF;

  FOR v_ref IN
    SELECT r.id
    FROM public.media_references r
    WHERE r.ref_type = 'event_cover'
      AND r.ref_table = 'events'
      AND r.ref_id = p_event_id::text
      AND r.ref_key = 'cover_image'
      AND r.is_active = true
      AND r.id IS DISTINCT FROM v_reference_id
    FOR UPDATE
  LOOP
    v_release_result := public.release_media_reference(v_ref.id, 'replace');
    IF COALESCE((v_release_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'event_cover_release_failed:%', COALESCE(v_release_result->>'error', v_ref.id::text);
    END IF;
    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'asset_id', p_asset_id,
    'reference_id', v_reference_id,
    'released_refs', v_released_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_event_cover_media_reference(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_event_cover_media_reference(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_event_cover_media_lifecycle(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_path text;
  v_asset_result jsonb;
  v_asset_id uuid;
  v_ref record;
  v_attach_result jsonb;
  v_reference_id uuid;
  v_release_result jsonb;
  v_released_count integer := 0;
  v_ref_created boolean := false;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_not_found', 'event_id', p_event_id);
  END IF;

  v_path := public.normalize_event_cover_provider_path(v_event.cover_image);

  FOR v_ref IN
    SELECT r.id
    FROM public.media_references r
    JOIN public.media_assets a ON a.id = r.asset_id
    WHERE r.ref_type = 'event_cover'
      AND r.ref_table = 'events'
      AND r.ref_id = p_event_id::text
      AND r.ref_key = 'cover_image'
      AND r.is_active = true
      AND (
        v_path IS NULL
        OR a.provider IS DISTINCT FROM 'bunny_storage'
        OR a.provider_path IS DISTINCT FROM v_path
      )
    FOR UPDATE OF r
  LOOP
    v_release_result := public.release_media_reference(v_ref.id, 'replace');
    IF COALESCE((v_release_result->>'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'event_cover_release_failed:%', COALESCE(v_release_result->>'error', v_ref.id::text);
    END IF;
    v_released_count := v_released_count + 1;
  END LOOP;

  IF v_path IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'tracked', false,
      'released_refs', v_released_count
    );
  END IF;

  v_asset_result := public.upsert_media_asset(
    'bunny_storage',
    'event_cover',
    NULL,
    NULL,
    v_path,
    NULL,
    NULL,
    NULL,
    'uploaded',
    'events',
    p_event_id::text
  );

  IF COALESCE((v_asset_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_asset_result->>'error', 'event_cover_asset_upsert_failed'),
      'event_id', p_event_id
    );
  END IF;

  v_asset_id := NULLIF(v_asset_result->>'asset_id', '')::uuid;

  v_attach_result := public.attach_media_reference(
    v_asset_id,
    'event_cover',
    'events',
    p_event_id::text,
    'cover_image'
  );

  IF COALESCE((v_attach_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', COALESCE(v_attach_result->>'error', 'event_cover_reference_attach_failed'),
      'event_id', p_event_id,
      'asset_id', v_asset_id
    );
  END IF;

  v_reference_id := NULLIF(v_attach_result->>'reference_id', '')::uuid;
  IF v_reference_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_cover_reference_attach_missing_id',
      'event_id', p_event_id,
      'asset_id', v_asset_id
    );
  END IF;
  v_ref_created := COALESCE((v_attach_result->>'created')::boolean, false);

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tracked', true,
    'asset_id', v_asset_id,
    'reference_id', v_reference_id,
    'reference_created', v_ref_created,
    'released_refs', v_released_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_cover_media_lifecycle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_cover_media_lifecycle(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_filters jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text;
  v_show_archived boolean := false;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_filters := CASE WHEN p_filters IS NULL OR p_filters = 'null'::jsonb THEN '{}'::jsonb ELSE p_filters END;
  IF jsonb_typeof(v_filters) <> 'object' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Event filters must be a JSON object.'); END IF;
  IF v_filters ? 'show_archived' AND lower(COALESCE(v_filters ->> 'show_archived', '')) NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'show_archived filter must be boolean.');
  END IF;

  v_search := NULLIF(btrim(COALESCE(v_filters ->> 'search', '')), '');
  v_show_archived := lower(COALESCE(v_filters ->> 'show_archived', 'false')) = 'true';

  WITH filtered AS (
    SELECT e.*
    FROM public.events e
    WHERE (v_show_archived OR e.archived_at IS NULL)
      AND (v_search IS NULL OR position(lower(v_search) in lower(COALESCE(e.title, '') || ' ' || COALESCE(e.description, ''))) > 0)
  ),
  enriched AS (
    SELECT
      filtered.*,
      cover.asset_id AS cover_media_asset_id
    FROM filtered
    LEFT JOIN LATERAL (
      SELECT r.asset_id
      FROM public.media_references r
      WHERE r.ref_type = 'event_cover'
        AND r.ref_table = 'events'
        AND r.ref_id = filtered.id::text
        AND r.ref_key = 'cover_image'
        AND r.is_active = true
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1
    ) cover ON true
  ),
  paged AS (
    SELECT enriched.*, count(*) OVER ()::integer AS total_count
    FROM enriched
    ORDER BY enriched.event_date DESC, enriched.created_at DESC, enriched.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(paged) - 'total_count' ORDER BY paged.event_date DESC, paged.created_at DESC, paged.id DESC), '[]'::jsonb),
         COALESCE(max(paged.total_count), 0)
  INTO v_rows, v_total
  FROM paged;

  RETURN public.admin_json_success(jsonb_build_object('events', v_rows, 'total_count', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_events(jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_events(jsonb, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_list_events(jsonb, integer, integer) IS
  'Admin event listing with active event-cover asset ids for stale upload guards.';
