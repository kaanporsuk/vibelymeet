-- Cron-merge stage 1 follow-up: the live gate caught marker writes failing with 23514 — the
-- audit table has its own action CHECK constraint, separate from the RPC allowlist extended in
-- 20260613000240. Extend the table constraint with the same 'reconciliation_run' marker action.
-- Validated existing rows trivially satisfy the superset list.

ALTER TABLE public.video_date_orphan_room_cleanup_audit
  DROP CONSTRAINT IF EXISTS video_date_orphan_room_cleanup_audit_action_check;

ALTER TABLE public.video_date_orphan_room_cleanup_audit
  ADD CONSTRAINT video_date_orphan_room_cleanup_audit_action_check
  CHECK ((action = ANY (ARRAY[
    'delete_candidate'::text,
    'dry_run_delete'::text,
    'deleted'::text,
    'skipped_active'::text,
    'skipped_recent'::text,
    'skipped_unknown'::text,
    'skipped_safety_review'::text,
    'delete_failed'::text,
    'reconciliation_run'::text
  ])));
