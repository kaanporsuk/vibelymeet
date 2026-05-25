-- Follow-up for PR #1041-#1049 review comments.
-- Allow the orphan-room cleanup worker to persist safety-interlock skips so
-- the Phase 5 circuit-breaker metric can observe them.

CREATE OR REPLACE FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  p_room_name text,
  p_action text,
  p_reason text,
  p_session_id uuid DEFAULT NULL,
  p_provider_room_id text DEFAULT NULL,
  p_provider_created_at timestamptz DEFAULT NULL,
  p_provider_expires_at timestamptz DEFAULT NULL,
  p_active_participant_count integer DEFAULT 0,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_room_name text := left(btrim(COALESCE(p_room_name, '')), 180);
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_reason text := left(lower(btrim(COALESCE(p_reason, 'unknown'))), 160);
  v_metadata jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_metadata, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_id bigint;
BEGIN
  IF v_room_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_name_required');
  END IF;

  IF v_action NOT IN (
    'delete_candidate',
    'dry_run_delete',
    'deleted',
    'skipped_active',
    'skipped_recent',
    'skipped_unknown',
    'skipped_safety_review',
    'delete_failed'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_cleanup_action');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_metadata) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'secret_metadata_rejected');
  END IF;

  INSERT INTO public.video_date_orphan_room_cleanup_audit (
    room_name,
    session_id,
    provider_room_id,
    provider_created_at,
    provider_expires_at,
    active_participant_count,
    action,
    reason,
    metadata
  )
  VALUES (
    v_room_name,
    p_session_id,
    NULLIF(left(btrim(COALESCE(p_provider_room_id, '')), 180), ''),
    p_provider_created_at,
    p_provider_expires_at,
    GREATEST(0, COALESCE(p_active_participant_count, 0)),
    v_action,
    v_reason,
    v_metadata
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(
  text, text, text, uuid, text, timestamptz, timestamptz, integer, jsonb
) IS
  'Service-role audit helper used by the Daily orphan room cleanup worker after presence, safety-interlock, and DB reconciliation checks.';
