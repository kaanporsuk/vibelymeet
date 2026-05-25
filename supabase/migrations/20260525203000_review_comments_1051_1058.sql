-- Follow-up for PR #1051-#1058 review comments.
-- Keep the orphan-room cleanup audit table constraint aligned with the RPC
-- action allow-list introduced for safety-interlock skips.

ALTER TABLE public.video_date_orphan_room_cleanup_audit
  DROP CONSTRAINT IF EXISTS video_date_orphan_room_cleanup_audit_action_check;

ALTER TABLE public.video_date_orphan_room_cleanup_audit
  ADD CONSTRAINT video_date_orphan_room_cleanup_audit_action_check
  CHECK (action IN (
    'delete_candidate',
    'dry_run_delete',
    'deleted',
    'skipped_active',
    'skipped_recent',
    'skipped_unknown',
    'skipped_safety_review',
    'delete_failed'
  ));
