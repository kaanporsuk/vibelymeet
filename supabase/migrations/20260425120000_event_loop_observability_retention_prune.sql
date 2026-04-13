-- Phase 3c: 30-day retention for event_loop_observability_events (batched DELETE only).
-- Write path (record_event_loop_observability + instrumented RPCs) unchanged.
-- Read-model views (v_event_loop_*) unchanged — they reflect surviving rows only.
--
-- Delete strategy:
--   * One transaction per invocation; deletes at most p_batch_limit rows oldest-first
--     (ORDER BY created_at ASC among rows with created_at < cutoff).
--   * Relies on existing btree event_loop_observability_events_created_at_idx
--     (created_at DESC) — planner uses it for the subquery range + order.
--   * No new index: ASC delete pattern is satisfied by the same btree scanned backward.
--   * Lock scope: rows deleted in this batch only (short vs deleting full backlog).
--   * Bloat: autovacuum reclaims dead tuples; large backlogs need repeated calls
--     (e.g. daily cron + optional extra runs until has_more_to_prune is false).
--
-- Scheduler (document only; not enabled here): prefer pg_cron on the project running
--   SELECT public.prune_event_loop_observability_events();
--   daily or hourly until backlog clears. See docs/supabase-cloud-deploy.md.

CREATE OR REPLACE FUNCTION public.prune_event_loop_observability_events(
  p_batch_limit integer DEFAULT 5000,
  p_retention_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_batch integer;
  v_days integer;
  v_cutoff timestamptz;
  v_deleted bigint;
  v_has_more boolean;
BEGIN
  v_batch := LEAST(GREATEST(COALESCE(NULLIF(p_batch_limit, 0), 5000), 1), 50000);
  v_days := LEAST(GREATEST(COALESCE(NULLIF(p_retention_days, 0), 30), 1), 365);
  v_cutoff := now() - (v_days || ' days')::interval;

  DELETE FROM public.event_loop_observability_events
  WHERE id IN (
    SELECT id
    FROM public.event_loop_observability_events
    WHERE created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT v_batch
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_loop_observability_events
    WHERE created_at < v_cutoff
    LIMIT 1
  )
  INTO v_has_more;

  RETURN jsonb_build_object(
    'deleted_count', v_deleted,
    'cutoff_utc', to_jsonb(v_cutoff),
    'batch_limit', v_batch,
    'retention_days', v_days,
    'has_more_to_prune', v_has_more
  );
END;
$fn$;

COMMENT ON FUNCTION public.prune_event_loop_observability_events(integer, integer) IS
  'Deletes up to p_batch_limit oldest rows older than now() - p_retention_days (default 30). '
  'Returns JSON with deleted_count and has_more_to_prune. Call from service_role / SQL editor; '
  'repeat until has_more_to_prune is false if clearing a large backlog.';

REVOKE ALL ON FUNCTION public.prune_event_loop_observability_events(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_event_loop_observability_events(integer, integer) TO service_role;
