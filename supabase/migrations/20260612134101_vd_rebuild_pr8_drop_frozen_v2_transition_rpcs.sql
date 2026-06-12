-- VD rebuild PR 8 (Part 2): drop the frozen v2 transition RPC family.
--
-- PR 6 (client single-path freeze) removed every client call path for these
-- four RPCs; canonical lifecycle traffic goes through video_date_transition
-- and ready_gate_transition. Pre-drop evidence against the linked project
-- (schdyxcunwcvddlcshwd, 2026-06-12):
--   * prosrc scan: video_session_continue_entry_v2, video_session_date_timeout_v2,
--     video_session_forfeit_v2 are referenced only by themselves (idempotency/
--     observability labels). video_session_entry_auto_promote_v2 is referenced
--     only by its two chain-private bases below; the live promotion path runs
--     through the evidence single bodies (video_date_promote_confirmed_encounter_v1 /
--     video_date_promote_provider_overlap_v1), not this RPC.
--   * vd_auto_promote_eligible_base / vd_auto_promote_stable_media_base are
--     referenced only inside the auto-promote trio (chain-private).
--   * zero pg_rewrite (view), pg_policy, and pg_trigger dependents.
--   * repo grep: zero references in src/, apps/mobile/, shared/, and
--     supabase/functions/ outside generated types (regenerated with this PR)
--     and contract tests asserting the drop.
--   * video_session_continue_handshake_v2* and
--     vs_handshake_auto_promote_20260605115657_base no longer exist in the
--     live catalog (removed by the PR 5 vocabulary flip).
--
-- Deliberately KEPT after live verification (documented in the PR):
--   * video_date_session_is_post_date_survey_eligible (v1): 6 live callers
--     (check_mutual_vibe_and_match, claim_video_date_surface,
--     finalize_video_date_entry_deadline, get_video_date_sprint7_ops_health,
--     resolve_post_date_next_surface, submit_video_date_safety_report_v2) and
--     it is NOT a dead twin of _v2 — v1 gates on encounter exposure while _v2
--     gates on confirmed (remote-seen-proofed) encounters. Re-pointing callers
--     would tighten product behavior; deferred to an explicit decision.
--   * video_sessions.snooze_expires_at / snoozed_by: live in 11/8 functions
--     including enforce_one_active_video_session and the ready_gate_transition
--     snooze machine.
--   * video_sessions.refund_* : live in video_session_refund_on_end_trigger
--     and refund_failed_video_date.
--   * video_sessions.started_at and entry_started_at: both carry live
--     references (webhook terminal truth base, drift validators, swipe bases);
--     neither is write-orphaned.

DROP FUNCTION IF EXISTS public.video_session_continue_entry_v2(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_session_date_timeout_v2(uuid, text, text);
DROP FUNCTION IF EXISTS public.video_session_forfeit_v2(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.video_session_entry_auto_promote_v2(uuid, text, text);
DROP FUNCTION IF EXISTS public.vd_auto_promote_eligible_base(uuid, text, text);
DROP FUNCTION IF EXISTS public.vd_auto_promote_stable_media_base(uuid, text, text);
