-- Remove dead queue-drain operator read-model views.
--
-- These views observed the queued auto-promotion / drain subsystem
-- (promote_ready_gate_if_eligible, drain_match_queue, drain_match_queue_v2),
-- which was removed from the active backend contract by
-- 20260610000100_remove_post_date_instant_next.sql and
-- 20260610120000_remove_match_queue_source_always_ready.sql. Nothing produces
-- the rows they summarize anymore.
--
-- Pre-removal evidence (2026-06-10, linked project schdyxcunwcvddlcshwd):
--   - pg_depend shows zero normal-dependency dependents for both views;
--   - repo-wide search shows zero readers outside generated Supabase types;
--   - underlying observability event log tables are intentionally preserved.

DROP VIEW IF EXISTS public.v_event_loop_drain_outcomes_hourly;
DROP VIEW IF EXISTS public.v_event_loop_drain_events;
