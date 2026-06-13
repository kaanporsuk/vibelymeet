-- Cron-merge stage 1 (docs/investigations/video-date-room-cleanup-consolidation-plan.md):
-- the merged video-date-room-cleanup function runs the provider-reconciliation pass at the
-- current 10-minute cadence via a `last_reconciliation_at` marker derived from the audit table
-- (max created_at WHERE action = 'reconciliation_run'). This migration extends the audit RPC's
-- action allowlist with that marker action; everything else in the function body is unchanged
-- from the live definition (dumped 2026-06-13).
--
-- Marker rows use room_name 'reconciliation-cycle' (not a real Daily room) and carry the pass
-- counters in metadata. A clean scan that deletes nothing still records its marker, so the
-- reconciliation cadence holds even when there is nothing to audit.

CREATE OR REPLACE FUNCTION public.record_video_date_orphan_room_cleanup_audit_v2(p_room_name text, p_action text, p_reason text, p_session_id uuid DEFAULT NULL::uuid, p_provider_room_id text DEFAULT NULL::text, p_provider_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_provider_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_active_participant_count integer DEFAULT 0, p_metadata jsonb DEFAULT '{}'::jsonb)
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
    'delete_failed',
    'reconciliation_run'
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
