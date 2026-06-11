-- ============================================================================
-- Video Date rebuild PR 5: maintenance-family single bodies + the
-- handshake -> entry vocabulary flip.
--
-- Part 1 (maintenance single bodies):
--   - public.expire_stale_video_sessions() becomes one bounded single body
--     (internal limit 100; the minutely cron keeps calling this exact name),
--     folding: expire_stale_video_sessions_bounded,
--     expire_stale_vsessions_bounded_202605232020_base,
--     expire_stale_vsessions_bounded_202605060900_base,
--     expire_stale_video_sessions_bounded_202605031300_base.
--   - public.finalize_video_date_entry_deadline becomes the only deadline
--     finalizer, folding finalize_video_date_handshake_deadline +
--     finalize_vd_handshake_deadline_20260603090000_base /
--     _20260605085010_base / _20260605115657_base +
--     finalize_video_date_handshake_deadline_20260603215948_handoff_b.
--     Rescue-only semantics and both launch-evidence extension passes are
--     preserved verbatim (stages B/C/D below mirror the dropped chain).
--   - public.expire_due_joined_video_date_entries_bounded keeps the live
--     body of its dropped _handshakes_ twin.
--   - public.expire_stale_video_date_phases_bounded becomes a single body
--     (folds expire_vd_phases_base_20260501133000/_20260502143000); the
--     unbounded public.expire_stale_video_date_phases (caller-less) is
--     dropped.
--   - public.repair_stale_video_date_prepare_entries becomes a single body
--     (folds repair_stale_vd_prepare_both_join_v1 - not redundant: it owns
--     the provider-room-missing repair; both sweeps are preserved).
--   - every remaining video-date public function named like '_20[0-9]{6}'
--     is folded into its surviving caller and dropped (full list at the
--     bottom of this file). Non-video-date date-stamped families
--     (handle_swipe_*, date_suggestion_*, get_event_deck_*,
--     get_profile_for_viewer_*, register_for_event_*,
--     settle_event_ticket_checkout_*) are intentionally untouched.
--
-- Part 2 (vocabulary flip; server-side only - clients already dual-read via
-- shared/matching/videoDateEntryCompatibility.ts and already send
-- entry-vocabulary RPC names and actions):
--   - ALTER TYPE public.video_date_state RENAME VALUE 'handshake' -> 'entry'.
--   - video_sessions.entry_started_at / entry_grace_expires_at were GENERATED
--     ALWAYS AS (handshake_*) STORED shadows; the shadows are dropped and the
--     physical handshake_* columns are renamed to entry_*, so client reads of
--     entry_* keep working unchanged and there is exactly one column pair.
--   - every surviving function that referenced the 'handshake' state, the
--     handshake_* columns, or handshake_* reason/kind/event vocabulary is
--     rewritten in entry vocabulary (entry_timeout, entry_grace_expired,
--     entry_not_mutual, entry_deadline_*, entry_auto_promote, continue_entry,
--     complete_entry, entry_started/entry_continued_to_date event kinds).
--   - video_date_transition keeps accepting the legacy action aliases
--     'complete_handshake' / 'continue_handshake' and keeps the pinned
--     standalone 'enter_handshake' rejection payload.
--   - event_registrations.queue_status vocabulary (including 'in_handshake')
--     is survey-route continuity and is intentionally NOT touched.
--   - views vw_session_health / vw_session_funnel are recreated on the
--     renamed column (vw_session_funnel.handshake_sessions ->
--     entry_sessions); the two phase8 ops views get their state/phase
--     literals flipped. client_feature_flags keys
--     ('video_date.outbox_v2.continue_handshake' / '.handshake_auto_promote')
--     are data keys and stay as-is.
--   - video_session_commands.command_kind now records 'continue_entry' /
--     'entry_auto_promote' (no CHECK constraint exists on command_kind; the
--     table holds only per-session disposable rows).
--   - video_session_deadlines kinds route as 'entry_auto_promote' /
--     'entry_timeout' (legacy kind names still accepted defensively; the
--     table is empty and has no live writers).
--
-- Shared-dependency touches (mechanical column/literal updates only, called
-- out per the PR-5 scope rules): get_event_deck,
-- event_deck_candidate_eligibility, get_active_session_context,
-- update_participant_status, handle_swipe_20260506090000_stale_room_base,
-- handle_swipe_20260507190000_tier_authority_base,
-- event_lobby_video_session_blocks_new_match (param renamed -> drop/create),
-- video_session_blocks_global_active_conflict (param renamed -> drop/create).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Enum rename
-- ────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.video_date_state RENAME VALUE 'handshake' TO 'entry';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Column convergence (drop generated shadows, rename physical columns)
-- ────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.vw_session_health;
DROP VIEW IF EXISTS public.vw_session_funnel;

ALTER TABLE public.video_sessions DROP COLUMN entry_started_at;
ALTER TABLE public.video_sessions DROP COLUMN entry_grace_expires_at;
ALTER TABLE public.video_sessions RENAME COLUMN handshake_started_at TO entry_started_at;
ALTER TABLE public.video_sessions RENAME COLUMN handshake_grace_expires_at TO entry_grace_expires_at;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Ops views recreated in entry vocabulary
--    (vw_session_funnel.handshake_sessions -> entry_sessions)
-- ────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.vw_session_health WITH (security_invoker = true) AS
 SELECT vs.id AS session_id,
    vs.event_id,
    COALESCE(e.is_test_event, false) AS is_test_event,
        CASE
            WHEN COALESCE(e.is_test_event, false) THEN 'synthetic'::text
            ELSE 'production'::text
        END AS sample_class,
    vs.participant_1_id,
    vs.participant_2_id,
    (vs.state)::text AS state,
    vs.phase,
    vs.ready_gate_status,
    vs.started_at,
    vs.state_updated_at,
    vs.ready_gate_expires_at,
    vs.entry_started_at,
    vs.date_started_at,
    vs.ended_at,
    vs.ended_reason,
    vs.daily_room_name,
    vs.session_seq,
    COALESCE(vs.ended_at, vs.state_updated_at, vs.started_at) AS last_state_at,
        CASE
            WHEN ((vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text) AND ((now() - COALESCE(vs.state_updated_at, vs.started_at)) > '00:02:00'::interval)) THEN true
            ELSE false
        END AS active_stuck_over_2m,
        CASE
            WHEN ((vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text)) THEN (EXTRACT(epoch FROM (now() - COALESCE(vs.state_updated_at, vs.started_at))))::integer
            ELSE NULL::integer
        END AS active_age_seconds
   FROM (video_sessions vs
     LEFT JOIN events e ON ((e.id = vs.event_id)));

CREATE VIEW public.vw_session_funnel WITH (security_invoker = true) AS
 SELECT vs.event_id,
    COALESCE(e.is_test_event, false) AS is_test_event,
        CASE
            WHEN COALESCE(e.is_test_event, false) THEN 'synthetic'::text
            ELSE 'production'::text
        END AS sample_class,
    date_trunc('hour'::text, COALESCE(vs.started_at, now())) AS bucket_utc,
    count(*) AS sessions_created,
    count(*) FILTER (WHERE ((vs.ready_gate_status IS NOT NULL) OR (vs.phase = 'ready_gate'::text) OR ((vs.state)::text = 'ready_gate'::text))) AS ready_gate_sessions,
    count(*) FILTER (WHERE ((vs.entry_started_at IS NOT NULL) OR (vs.phase = 'entry'::text) OR ((vs.state)::text = 'entry'::text))) AS entry_sessions,
    count(*) FILTER (WHERE ((vs.date_started_at IS NOT NULL) OR (vs.phase = 'date'::text) OR ((vs.state)::text = 'date'::text))) AS date_sessions,
    count(*) FILTER (WHERE ((vs.ended_at IS NOT NULL) OR (vs.phase = 'ended'::text) OR ((vs.state)::text = 'ended'::text))) AS ended_sessions,
    count(*) FILTER (WHERE ((vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text))) AS active_sessions,
    count(*) FILTER (WHERE ((vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text) AND ((now() - COALESCE(vs.state_updated_at, vs.started_at)) > '00:02:00'::interval))) AS stuck_over_2m_sessions
   FROM (video_sessions vs
     LEFT JOIN events e ON ((e.id = vs.event_id)))
  GROUP BY vs.event_id, COALESCE(e.is_test_event, false),
        CASE
            WHEN COALESCE(e.is_test_event, false) THEN 'synthetic'::text
            ELSE 'production'::text
        END, (date_trunc('hour'::text, COALESCE(vs.started_at, now())));

-- replicate the previous ops-only access posture (service_role only)
REVOKE ALL ON public.vw_session_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vw_session_funnel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_session_health TO service_role;
GRANT SELECT ON public.vw_session_funnel TO service_role;

CREATE OR REPLACE VIEW public.vw_video_date_phase8_release_closure AS
 WITH core_flags(flag_key) AS (
         VALUES ('video_date.snapshot_v2'::text), ('video_date.deck_deal_v2'::text), ('video_date.readiness_v2'::text), ('video_date.micro_verdict_v2'::text), ('video_date.broadcast_v2'::text), ('video_date.timeline_v2'::text), ('video_date.daily_webhooks_v2'::text), ('video_date.extension_mutual_v2'::text), ('video_date.safety_always_on_v2'::text), ('video_date.multi_device_v2'::text), ('video_date.outbox_v2.mark_ready'::text), ('video_date.outbox_v2.forfeit'::text), ('video_date.outbox_v2.continue_handshake'::text), ('video_date.outbox_v2.handshake_auto_promote'::text), ('video_date.outbox_v2.date_timeout'::text), ('video_date.outbox_v2.submit_verdict'::text), ('video_date.outbox_v2.extension'::text), ('video_date.outbox_v2.safety'::text)
        ), flag_rollup AS (
         SELECT (count(f.flag_key) = count(cf.flag_key)) AS core_flags_present,
            COALESCE(bool_and(COALESCE(f.enabled, false)), false) AS core_flags_enabled,
            COALESCE(bool_or(COALESCE(f.kill_switch_active, false)), false) AS core_flags_killed,
            COALESCE(min(COALESCE(f.rollout_bps, 0)), 0) AS current_rollout_bps,
            (count(cf.flag_key))::integer AS required_flag_count,
            (count(f.flag_key))::integer AS present_flag_count
           FROM (core_flags cf
             LEFT JOIN client_feature_flags f ON ((f.flag_key = cf.flag_key)))
        ), rollout_steps AS (
         SELECT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 100)))) AS rollout_1pct_passed,
            (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 1000)))) AS rollout_10pct_passed,
            (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 5000)))) AS rollout_50pct_passed,
            (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 10000)))) AS rollout_100pct_passed
        ), legacy_cleanup AS (
         SELECT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'legacy_cleanup'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text)))) AS legacy_cleanup_passed
        ), alerts AS (
         SELECT (count(*) FILTER (WHERE (vw_video_date_recovery_alerts.severity = 'page'::text)))::integer AS recovery_page_alerts,
            (count(*) FILTER (WHERE (vw_video_date_recovery_alerts.severity = 'watch'::text)))::integer AS recovery_watch_alerts
           FROM vw_video_date_recovery_alerts
        ), stuck AS (
         SELECT (count(*))::integer AS stuck_active_sessions_over_2m
           FROM video_sessions vs
          WHERE ((vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text) AND (COALESCE(vs.phase, ''::text) <> 'ended'::text) AND (COALESCE(vs.state_updated_at, vs.started_at, now()) <= (now() - '00:02:00'::interval)) AND ((vs.ready_gate_status = ANY (ARRAY['ready'::text, 'ready_a'::text, 'ready_b'::text, 'both_ready'::text])) OR (COALESCE(vs.phase, ''::text) = ANY (ARRAY['entry'::text, 'date'::text])) OR (COALESCE((vs.state)::text, ''::text) = ANY (ARRAY['ready'::text, 'entry'::text, 'date'::text]))))
        ), deck AS (
         SELECT COALESCE(vw_video_date_legacy_deck_cleanup_readiness.deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
            vw_video_date_legacy_deck_cleanup_readiness.cleanup_readiness_reason
           FROM vw_video_date_legacy_deck_cleanup_readiness
          WHERE (vw_video_date_legacy_deck_cleanup_readiness.flag_key = 'video_date.deck_deal_v2'::text)
         LIMIT 1
        )
 SELECT 'global'::text AS release_track,
    fr.core_flags_present,
    fr.core_flags_enabled,
    fr.core_flags_killed,
    fr.current_rollout_bps,
    fr.required_flag_count,
    fr.present_flag_count,
    rs.rollout_1pct_passed,
    rs.rollout_10pct_passed,
    rs.rollout_50pct_passed,
    rs.rollout_100pct_passed,
    COALESCE(d.deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
    COALESCE(d.cleanup_readiness_reason, 'deck_cleanup_readiness_missing'::text) AS legacy_deck_cleanup_reason,
    lc.legacy_cleanup_passed,
    COALESCE(a.recovery_page_alerts, 0) AS recovery_page_alerts,
    COALESCE(a.recovery_watch_alerts, 0) AS recovery_watch_alerts,
    COALESCE(s.stuck_active_sessions_over_2m, 0) AS stuck_active_sessions_over_2m,
    array_remove(ARRAY[
        CASE
            WHEN (NOT fr.core_flags_present) THEN 'core_flags_missing'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT fr.core_flags_enabled) THEN 'core_flags_not_enabled'::text
            ELSE NULL::text
        END,
        CASE
            WHEN fr.core_flags_killed THEN 'core_flag_kill_switch_active'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (fr.current_rollout_bps < 10000) THEN 'current_rollout_bps_below_100pct'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT rs.rollout_1pct_passed) THEN 'rollout_1pct_not_certified'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT rs.rollout_10pct_passed) THEN 'rollout_10pct_not_certified'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT rs.rollout_50pct_passed) THEN 'rollout_50pct_not_certified'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT rs.rollout_100pct_passed) THEN 'rollout_100pct_not_certified'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT COALESCE(d.deck_deal_100pct_baked, false)) THEN 'deck_deal_100pct_not_baked'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT lc.legacy_cleanup_passed) THEN 'legacy_cleanup_not_certified'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(a.recovery_page_alerts, 0) > 0) THEN 'recovery_page_alerts_active'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(s.stuck_active_sessions_over_2m, 0) > 0) THEN 'stuck_active_sessions_over_2m'::text
            ELSE NULL::text
        END], NULL::text) AS release_blockers,
    now() AS generated_at
   FROM (((((flag_rollup fr
     CROSS JOIN rollout_steps rs)
     CROSS JOIN legacy_cleanup lc)
     CROSS JOIN alerts a)
     CROSS JOIN stuck s)
     LEFT JOIN deck d ON (true));

CREATE OR REPLACE VIEW public.vw_video_date_phase8_rollout_readiness AS
 WITH core_flags(flag_key) AS (
         VALUES ('video_date.snapshot_v2'::text), ('video_date.deck_deal_v2'::text), ('video_date.readiness_v2'::text), ('video_date.micro_verdict_v2'::text), ('video_date.broadcast_v2'::text), ('video_date.timeline_v2'::text), ('video_date.daily_webhooks_v2'::text), ('video_date.extension_mutual_v2'::text), ('video_date.safety_always_on_v2'::text), ('video_date.multi_device_v2'::text), ('video_date.outbox_v2.mark_ready'::text), ('video_date.outbox_v2.forfeit'::text), ('video_date.outbox_v2.continue_handshake'::text), ('video_date.outbox_v2.handshake_auto_promote'::text), ('video_date.outbox_v2.date_timeout'::text), ('video_date.outbox_v2.submit_verdict'::text), ('video_date.outbox_v2.extension'::text), ('video_date.outbox_v2.safety'::text)
        ), flag_rollup AS (
         SELECT (count(f.flag_key) = count(cf.flag_key)) AS core_flags_present,
            bool_and(COALESCE(f.enabled, false)) AS core_flags_enabled,
            bool_or(COALESCE(f.kill_switch_active, false)) AS core_flags_killed,
            min(COALESCE(f.rollout_bps, 0)) AS current_rollout_bps,
            (count(cf.flag_key))::integer AS required_flag_count,
            (count(f.flag_key))::integer AS present_flag_count
           FROM (core_flags cf
             LEFT JOIN client_feature_flags f ON ((f.flag_key = cf.flag_key)))
        ), windows(window_id, window_label, max_p95_ms, max_p99_ms) AS (
         VALUES ('24h'::text,'24h'::text,5000,8000), ('7d'::text,'7d'::text,5000,8000)
        ), targets(target_rollout_bps, target_label, min_samples, requires_deck_bake) AS (
         VALUES (100,'1%'::text,0,false), (1000,'10%'::text,20,false), (5000,'50%'::text,50,false), (10000,'100%'::text,100,true)
        ), event_scope AS (
         SELECT e.id AS event_id
           FROM events e
          WHERE ((e.event_date >= (now() - '30 days'::interval)) AND (e.event_date < (now() + '30 days'::interval)))
        UNION
         SELECT DISTINCT vs.event_id
           FROM video_sessions vs
          WHERE ((vs.event_id IS NOT NULL) AND (COALESCE(vs.started_at, vs.state_updated_at, now()) >= (now() - '30 days'::interval)))
        UNION
         SELECT DISTINCT r.event_id
           FROM video_date_phase8_certification_runs r
          WHERE (r.event_id IS NOT NULL)
        ), stuck AS (
         SELECT vs.event_id,
            (count(*))::integer AS stuck_active_sessions_over_2m
           FROM video_sessions vs
          WHERE ((vs.event_id IS NOT NULL) AND (vs.ended_at IS NULL) AND (COALESCE((vs.state)::text, ''::text) <> 'ended'::text) AND (COALESCE(vs.phase, ''::text) <> 'ended'::text) AND (COALESCE(vs.state_updated_at, vs.started_at, now()) <= (now() - '00:02:00'::interval)) AND ((vs.ready_gate_status = ANY (ARRAY['ready'::text, 'ready_a'::text, 'ready_b'::text, 'both_ready'::text])) OR (COALESCE(vs.phase, ''::text) = ANY (ARRAY['entry'::text, 'date'::text])) OR (COALESCE((vs.state)::text, ''::text) = ANY (ARRAY['ready'::text, 'entry'::text, 'date'::text]))))
          GROUP BY vs.event_id
        ), alerts AS (
         SELECT (count(*) FILTER (WHERE (vw_video_date_recovery_alerts.severity = 'page'::text)))::integer AS recovery_page_alerts,
            (count(*) FILTER (WHERE (vw_video_date_recovery_alerts.severity = 'watch'::text)))::integer AS recovery_watch_alerts
           FROM vw_video_date_recovery_alerts
        ), cert AS (
         SELECT es.event_id,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['web'::text, 'cross_platform'::text])) AND (r.status = 'passed'::text)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['web'::text, 'cross_platform'::text])))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['web'::text, 'cross_platform'::text])) AND (r.status = 'passed'::text)))))) AS two_user_web_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (((r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text]))) OR ((r.run_kind = 'native_smoke'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text])))) AND (r.status = 'passed'::text)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (((r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text]))) OR ((r.run_kind = 'native_smoke'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text])))))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (((r.run_kind = 'two_user_e2e'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text]))) OR ((r.run_kind = 'native_smoke'::text) AND (r.platform = ANY (ARRAY['native'::text, 'mobile'::text, 'cross_platform'::text])))) AND (r.status = 'passed'::text)))))) AS two_user_native_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rls_negative'::text) AND (r.status = 'passed'::text)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rls_negative'::text))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'rls_negative'::text) AND (r.status = 'passed'::text)))))) AS rls_negative_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'chaos'::text) AND (r.status = 'passed'::text)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'chaos'::text))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'chaos'::text) AND (r.status = 'passed'::text)))))) AS chaos_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'load'::text) AND (r.status = 'passed'::text)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'load'::text))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_certification_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'load'::text) AND (r.status = 'passed'::text)))))) AS load_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 100)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.rollout_bps = 100))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 100)))))) AS rollout_1pct_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 1000)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.rollout_bps = 1000))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 1000)))))) AS rollout_10pct_passed,
            ((EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 5000)))) OR ((NOT (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id = es.event_id) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.rollout_bps = 5000))))) AND (EXISTS ( SELECT 1
                   FROM vw_video_date_phase8_rollout_step_latest r
                  WHERE ((r.event_id IS NULL) AND (r.run_kind = 'rollout_step'::text) AND (r.platform = 'ops'::text) AND (r.status = 'passed'::text) AND (r.rollout_bps = 5000)))))) AS rollout_50pct_passed
           FROM event_scope es
        ), readiness AS (
         SELECT w.window_id,
            w.window_label,
            es.event_id,
            t.target_rollout_bps,
            t.target_label,
            COALESCE(c.two_user_web_passed, false) AS two_user_web_passed,
            COALESCE(c.two_user_native_passed, false) AS two_user_native_passed,
            COALESCE(c.rls_negative_passed, false) AS rls_negative_passed,
            COALESCE(c.chaos_passed, false) AS chaos_passed,
            COALESCE(c.load_passed, false) AS load_passed,
            COALESCE(c.rollout_1pct_passed, false) AS rollout_1pct_passed,
            COALESCE(c.rollout_10pct_passed, false) AS rollout_10pct_passed,
            COALESCE(c.rollout_50pct_passed, false) AS rollout_50pct_passed,
            COALESCE(a.recovery_page_alerts, 0) AS recovery_page_alerts,
            COALESCE(a.recovery_watch_alerts, 0) AS recovery_watch_alerts,
            COALESCE(s.stuck_active_sessions_over_2m, 0) AS stuck_active_sessions_over_2m,
            COALESCE(d.first_frame_sample_count, 0) AS first_frame_sample_count,
            d.first_frame_p95_ms,
            d.first_frame_p99_ms,
            fr.core_flags_present,
            fr.core_flags_enabled,
            fr.core_flags_killed,
            fr.current_rollout_bps,
            COALESCE(deck.deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
            deck.cleanup_readiness_reason AS legacy_deck_cleanup_reason,
            array_remove(ARRAY[
                CASE
                    WHEN (NOT COALESCE(c.two_user_web_passed, false)) THEN 'two_user_web_not_passed'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT COALESCE(c.two_user_native_passed, false)) THEN 'two_user_native_not_passed'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT COALESCE(c.rls_negative_passed, false)) THEN 'rls_negative_not_passed'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT COALESCE(c.chaos_passed, false)) THEN 'chaos_not_passed'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT COALESCE(c.load_passed, false)) THEN 'load_not_passed'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT fr.core_flags_present) THEN 'core_flags_missing'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (NOT fr.core_flags_enabled) THEN 'core_flags_not_enabled'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN fr.core_flags_killed THEN 'core_flag_kill_switch_active'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (COALESCE(a.recovery_page_alerts, 0) > 0) THEN 'recovery_page_alerts_active'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (COALESCE(s.stuck_active_sessions_over_2m, 0) > 0) THEN 'stuck_active_sessions_over_2m'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 1000) AND (NOT COALESCE(c.rollout_1pct_passed, false))) THEN 'rollout_1pct_not_certified'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 1000) AND (COALESCE(fr.current_rollout_bps, 0) < 100)) THEN 'current_rollout_bps_below_1pct'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 5000) AND (NOT COALESCE(c.rollout_10pct_passed, false))) THEN 'rollout_10pct_not_certified'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 5000) AND (COALESCE(fr.current_rollout_bps, 0) < 1000)) THEN 'current_rollout_bps_below_10pct'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 10000) AND (NOT COALESCE(c.rollout_50pct_passed, false))) THEN 'rollout_50pct_not_certified'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.target_rollout_bps >= 10000) AND (COALESCE(fr.current_rollout_bps, 0) < 5000)) THEN 'current_rollout_bps_below_50pct'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (COALESCE(d.first_frame_sample_count, 0) < t.min_samples) THEN 'insufficient_first_frame_samples'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.min_samples > 0) AND ((d.first_frame_p95_ms IS NULL) OR (d.first_frame_p95_ms > w.max_p95_ms))) THEN 'first_frame_p95_over_target'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((t.min_samples > 0) AND ((d.first_frame_p99_ms IS NULL) OR (d.first_frame_p99_ms > w.max_p99_ms))) THEN 'first_frame_p99_over_target'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (t.requires_deck_bake AND (NOT COALESCE(deck.deck_deal_100pct_baked, false))) THEN 'deck_deal_100pct_not_baked'::text
                    ELSE NULL::text
                END], NULL::text) AS rollout_blockers
           FROM ((((((((event_scope es
             CROSS JOIN windows w)
             CROSS JOIN targets t)
             CROSS JOIN flag_rollup fr)
             CROSS JOIN alerts a)
             LEFT JOIN cert c ON ((c.event_id = es.event_id)))
             LEFT JOIN stuck s ON ((s.event_id = es.event_id)))
             LEFT JOIN vw_video_date_daily_pool_decision d ON (((d.event_id = es.event_id) AND (d.window_id = w.window_id))))
             LEFT JOIN vw_video_date_legacy_deck_cleanup_readiness deck ON ((deck.flag_key = 'video_date.deck_deal_v2'::text)))
        )
 SELECT window_id,
    window_label,
    event_id,
    target_rollout_bps,
    target_label,
    two_user_web_passed,
    two_user_native_passed,
    rls_negative_passed,
    chaos_passed,
    load_passed,
    rollout_1pct_passed,
    rollout_10pct_passed,
    rollout_50pct_passed,
    recovery_page_alerts,
    recovery_watch_alerts,
    stuck_active_sessions_over_2m,
    first_frame_sample_count,
    first_frame_p95_ms,
    first_frame_p99_ms,
    core_flags_present,
    core_flags_enabled,
    core_flags_killed,
    current_rollout_bps,
    deck_deal_100pct_baked,
    legacy_deck_cleanup_reason,
    rollout_blockers,
    (COALESCE(array_length(rollout_blockers, 1), 0) = 0) AS can_advance_rollout,
    now() AS generated_at
   FROM readiness;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Session-conflict predicate helpers (input parameter renamed, so the old
--    functions are dropped and recreated; grants replicated)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone);
DROP FUNCTION public.video_session_blocks_global_active_conflict(uuid, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.event_lobby_video_session_blocks_new_match(p_ready_gate_status text, p_state text, p_phase text, p_entry_started_at timestamp with time zone, p_date_started_at timestamp with time zone, p_ended_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_ended_at IS NULL
    AND COALESCE(p_ready_gate_status, '') <> 'queued'
    AND (
      p_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR p_state IN ('entry', 'date')
      OR p_phase IN ('entry', 'date')
      OR p_entry_started_at IS NOT NULL
      OR p_date_started_at IS NOT NULL
    );
$function$;

CREATE OR REPLACE FUNCTION public.video_session_blocks_global_active_conflict(p_event_id uuid, p_ready_gate_status text, p_state text, p_phase text, p_entry_started_at timestamp with time zone, p_date_started_at timestamp with time zone, p_ended_at timestamp with time zone, p_ready_gate_expires_at timestamp with time zone, p_snooze_expires_at timestamp with time zone, p_prepare_entry_expires_at timestamp with time zone, p_participant_1_joined_at timestamp with time zone, p_participant_2_joined_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_status text := COALESCE(NULLIF(p_ready_gate_status, ''), '');
  v_state text := COALESCE(NULLIF(p_state, ''), '');
  v_phase text := COALESCE(NULLIF(p_phase, ''), '');
  v_inactive_reason text;
BEGIN
  IF p_ended_at IS NOT NULL OR v_state = 'ended' OR v_phase = 'ended' THEN
    RETURN false;
  END IF;

  IF p_entry_started_at IS NOT NULL
     OR p_date_started_at IS NOT NULL
     OR p_participant_1_joined_at IS NOT NULL
     OR p_participant_2_joined_at IS NOT NULL
     OR v_state IN ('entry', 'date')
     OR v_phase IN ('entry', 'date') THEN
    RETURN true;
  END IF;

  IF v_status IN ('expired', 'forfeited') THEN
    RETURN false;
  END IF;

  IF v_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    IF p_event_id IS NOT NULL THEN
      v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
      IF v_inactive_reason IS NOT NULL THEN
        RETURN false;
      END IF;
    END IF;

    IF p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now THEN
      RETURN true;
    END IF;

    IF v_status = 'snoozed' THEN
      RETURN p_snooze_expires_at IS NULL OR p_snooze_expires_at > v_now;
    END IF;

    RETURN p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_session_blocks_global_active_conflict(uuid, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.video_session_blocks_global_active_conflict(uuid, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Folded single bodies (effective composition of each dropped chain)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_video_date_entry_deadline(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_promotion jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  -- Stage A: rescue-only early confirmed-encounter promotion (head).
  v_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    p_actor,
    COALESCE(NULLIF(p_source, ''), 'finalize_video_date_entry_deadline'),
    p_reason,
    false
  );

  IF COALESCE((v_promotion->>'promoted')::boolean, false) THEN
    RETURN v_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'retryable', false
    );
  END IF;

  <<base>>
  BEGIN
    -- Stage B (fold of finalize_vd_*_20260605115657): preflight repair,
    -- already-in-date short-circuit, active-confirmed-encounter rescue
    -- promotion, and the v2 launch-evidence deadline extension.
    DECLARE
    v_now timestamptz := clock_timestamp();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_latest_webhook_join_at timestamptz;
    v_latest_launch_evidence_at timestamptz;
    v_participant_1_latest_evidence_at timestamptz;
    v_participant_2_latest_evidence_at timestamptz;
    v_first_confirmed_encounter_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_due boolean := false;
    v_confirmed_encounter boolean := false;
    v_active_confirmed_encounter boolean := false;
    v_previous_entry_started_at timestamptz;
    v_date_started_at timestamptz;
    v_seconds_remaining integer;
    v_event jsonb := '{}'::jsonb;
    BEGIN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        'confirmed_encounter_deadline_preflight'
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      -- (fold) session row missing: fall through to the core stage below

      IF v_session.state::text = 'date'
         OR v_session.phase = 'date'
         OR v_session.date_started_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_session.date_started_at,
          'reason', 'already_in_date',
          'session_seq', COALESCE(v_session.session_seq, 0)
        );
        EXIT base;
      END IF;

      IF v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL THEN
        v_previous_entry_started_at := v_session.entry_started_at;
        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_has_explicit_pass := (
          (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
          OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
        );
        v_both_decided := v_session.participant_1_decided_at IS NOT NULL
          AND v_session.participant_2_decided_at IS NOT NULL;

        v_participant_1_latest_evidence_at := GREATEST(
          COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz)
        );
        v_participant_2_latest_evidence_at := GREATEST(
          COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
        );

        v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        );
        v_active_confirmed_encounter := v_confirmed_encounter
          AND (
            v_session.participant_1_away_at IS NULL
            OR v_session.participant_1_away_at <= v_participant_1_latest_evidence_at
          )
          AND (
            v_session.participant_2_away_at IS NULL
            OR v_session.participant_2_away_at <= v_participant_2_latest_evidence_at
          );

        v_first_confirmed_encounter_at := GREATEST(
          COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_active_confirmed_encounter THEN
          v_date_started_at := v_now;

          UPDATE public.video_sessions
          SET
            state = 'date'::public.video_date_state,
            phase = 'date',
            date_started_at = v_date_started_at,
            ended_at = NULL,
            ended_reason = NULL,
            reconnect_grace_ends_at = NULL,
            entry_grace_expires_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            daily_room_name = COALESCE(daily_room_name, v_expected_room_name),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
            AND date_started_at IS NULL
          RETURNING * INTO v_session;

          UPDATE public.event_registrations
          SET
            queue_status = 'in_date',
            current_room_id = p_session_id,
            current_partner_id = CASE
              WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
              ELSE v_session.participant_1_id
            END,
            last_active_at = v_now
          WHERE event_id = v_session.event_id
            AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

          v_event := public.append_video_session_event_v2(
            p_session_id,
            'confirmed_encounter_deadline_promoted_to_date',
            'participants',
            p_actor,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'date_started_at', v_date_started_at,
              'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
            ),
            jsonb_build_object(
              'state', 'date',
              'phase', 'date',
              'date_started_at', v_date_started_at,
              'reason', 'confirmed_encounter_deadline_rescue'
            ),
            true,
            gen_random_uuid()
          );

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'confirmed_encounter_deadline_promoted_to_date',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'date_started_at', v_date_started_at,
              'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'participant_1_away_at', v_session.participant_1_away_at,
              'participant_2_away_at', v_session.participant_2_away_at,
              'event_result', v_event
            )
          );

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'date',
            'phase', 'date',
            'date_started_at', v_session.date_started_at,
            'reason', 'confirmed_encounter_deadline_rescue',
            'recovered_confirmed_encounter', true,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

        v_latest_launch_evidence_at := GREATEST(
          COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = v_now,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL
            AND state = 'entry'::public.video_date_state
            AND date_started_at IS NULL
          RETURNING * INTO v_session;

          v_seconds_remaining := GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM ((v_now + interval '60 seconds') - clock_timestamp())))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence_v2',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_previous_entry_started_at,
              'extension_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'ok', true,
            'success', true,
            'state', 'entry',
            'phase', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true,
            'extension_started_at', v_session.entry_started_at,
            'session_seq', COALESCE(v_session.session_seq, 0)
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to launch-evidence v1 stage
    END;

    -- Stage C (fold of finalize_vd_*_20260605085010): both-joined v1
    -- launch-evidence deadline extension.
    DECLARE
    v_now timestamptz := now();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_latest_webhook_join_at timestamptz;
    v_latest_launch_evidence_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_due boolean := false;
    v_seconds_remaining integer;
    BEGIN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        'entry_deadline_preflight'
      );

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND v_session.ended_at IS NULL
         AND v_session.state = 'entry'::public.video_date_state
         AND v_session.date_started_at IS NULL
         AND v_session.entry_started_at IS NOT NULL
         AND v_session.participant_1_joined_at IS NOT NULL
         AND v_session.participant_2_joined_at IS NOT NULL THEN

        v_due := v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_has_explicit_pass := (
          (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
          OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
        );
        v_both_decided := v_session.participant_1_decided_at IS NOT NULL
          AND v_session.participant_2_decided_at IS NOT NULL;

        SELECT max(w.occurred_at)
        INTO v_latest_webhook_join_at
        FROM public.video_date_daily_webhook_events w
        WHERE (w.session_id = p_session_id OR w.room_name = v_expected_room_name)
          AND replace(replace(lower(w.event_type), '_', '.'), '-', '.') IN ('participant.joined', 'participant.join')
          AND w.occurred_at >= v_session.entry_started_at;

        v_latest_launch_evidence_at := GREATEST(
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
          COALESCE(v_latest_webhook_join_at, '-infinity'::timestamptz)
        );

        IF v_due
           AND NOT v_has_explicit_pass
           AND NOT v_both_decided
           AND v_latest_launch_evidence_at IS NOT NULL
           AND v_latest_launch_evidence_at <> '-infinity'::timestamptz
           AND v_latest_launch_evidence_at > v_session.entry_started_at THEN
          UPDATE public.video_sessions
          SET
            entry_started_at = LEAST(v_now, v_latest_launch_evidence_at),
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          v_seconds_remaining := GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((LEAST(v_now, v_latest_launch_evidence_at) + interval '60 seconds') - v_now)))::int
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_extended_for_launch_evidence',
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason,
              'previous_entry_started_at', v_session.entry_started_at,
              'latest_launch_evidence_at', v_latest_launch_evidence_at,
              'latest_webhook_join_at', v_latest_webhook_join_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'seconds_remaining', v_seconds_remaining
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'reason', 'entry_launch_evidence_extension',
            'seconds_remaining', v_seconds_remaining,
            'extended', true
          );
          EXIT base;
        END IF;
      END IF;

      -- (fold) fall through to the terminal core stage
    END;

    -- Stage D (fold of *_20260603215948_handoff + *_20260603090000): the
    -- terminal deadline core plus the unconfirmed-date guard and v2
    -- survey continuity.
    DECLARE
    v_result jsonb;

    v_session public.video_sessions%ROWTYPE;

    v_should_open_survey boolean := false;

    v_event_live boolean := false;

    v_resume_status text := 'idle';
    v_now timestamptz := now();

    v_ev uuid;

    v_p1 uuid;

    v_p2 uuid;

    v_is_p1 boolean := false;

    v_is_p2 boolean := false;

    v_actor_decided_at timestamptz;

    v_partner_decided_at timestamptz;

    v_waiting_for_self boolean := false;

    v_waiting_for_partner boolean := false;

    v_p1_decided boolean := false;

    v_p2_decided boolean := false;

    v_p1_explicit_pass boolean := false;

    v_p2_explicit_pass boolean := false;

    v_due boolean := false;

    v_seconds_remaining integer;

    v_state_before text;

    v_reason_code text;

    v_terminal_reason text;
    BEGIN
      <<term_core>>
      BEGIN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'session_not_found',
            NULL,
            NULL,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
          EXIT term_core;
        END IF;

        v_ev := v_session.event_id;
        v_p1 := v_session.participant_1_id;
        v_p2 := v_session.participant_2_id;
        v_state_before := v_session.state::text;
        v_is_p1 := p_actor IS NOT NULL AND v_p1 = p_actor;
        v_is_p2 := p_actor IS NOT NULL AND v_p2 = p_actor;

        IF p_actor IS NOT NULL AND NOT v_is_p1 AND NOT v_is_p2 THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'blocked',
            'access_denied',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'state_before', v_state_before,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
          EXIT term_core;
        END IF;

        v_p1_decided := v_session.participant_1_decided_at IS NOT NULL;
        v_p2_decided := v_session.participant_2_decided_at IS NOT NULL;
        v_p1_explicit_pass := v_p1_decided AND v_session.participant_1_liked IS FALSE;
        v_p2_explicit_pass := v_p2_decided AND v_session.participant_2_liked IS FALSE;
        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;
        v_due := v_session.entry_started_at IS NOT NULL
          AND v_session.entry_started_at + interval '60 seconds' <= v_now;
        v_seconds_remaining := CASE
          WHEN v_session.entry_started_at IS NULL THEN NULL
          ELSE GREATEST(
            0,
            CEIL(EXTRACT(EPOCH FROM ((v_session.entry_started_at + interval '60 seconds') - v_now)))::int
          )
        END;

        IF v_session.ended_at IS NOT NULL THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at
          );

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'session_already_ended',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'survey_required', v_should_open_survey,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );
          v_result := jsonb_build_object(
            'success', true,
            'state', 'ended',
            'already_ended', true,
            'reason', v_session.ended_reason,
            'survey_required', v_should_open_survey,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner
          );
          EXIT term_core;
        END IF;

        IF v_session.state = 'date'::public.video_date_state
           OR v_session.phase = 'date'
           OR v_session.date_started_at IS NOT NULL THEN
          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF v_p1_decided
           AND v_p2_decided
           AND v_session.participant_1_liked IS TRUE
           AND v_session.participant_2_liked IS TRUE THEN
          UPDATE public.video_sessions
          SET
            state = 'date'::public.video_date_state,
            phase = 'date',
            date_started_at = COALESCE(date_started_at, v_now),
            entry_grace_expires_at = NULL,
            reconnect_grace_ends_at = NULL,
            participant_1_away_at = NULL,
            participant_2_away_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND ended_at IS NULL;

          UPDATE public.event_registrations
          SET
            queue_status = 'in_date',
            current_room_id = p_session_id,
            current_partner_id = CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END,
            last_active_at = v_now
          WHERE event_id = v_ev
            AND profile_id IN (v_p1, v_p2);

          SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'entry_deadline_completed_mutual',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', false,
              'waiting_for_partner', false,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', v_due,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'date',
            'waiting_for_self', false,
            'waiting_for_partner', false,
            'local_decision_persisted', true,
            'partner_decision_persisted', true
          );
          EXIT term_core;
        END IF;

        IF NOT v_due THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'entry_deadline_not_due',
            NULL,
            v_ev,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'complete_entry',
              'source', p_source,
              'participant_1_liked', v_session.participant_1_liked,
              'participant_2_liked', v_session.participant_2_liked,
              'participant_1_decided_at', v_session.participant_1_decided_at,
              'participant_2_decided_at', v_session.participant_2_decided_at,
              'waiting_for_self', v_waiting_for_self,
              'waiting_for_partner', v_waiting_for_partner,
              'seconds_remaining', v_seconds_remaining,
              'state_before', v_state_before,
              'state_after', v_session.state::text,
              'deadline_due', false,
              'entry_grace_expires_at', v_session.entry_grace_expires_at,
              'p_reason', p_reason
            )
          );

          v_result := jsonb_build_object(
            'success', true,
            'state', 'entry',
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'seconds_remaining', v_seconds_remaining
          );
          EXIT term_core;
        END IF;

        IF v_p1_explicit_pass OR v_p2_explicit_pass OR (v_p1_decided AND v_p2_decided) THEN
          v_terminal_reason := 'entry_not_mutual';
          v_reason_code := 'entry_deadline_not_mutual';
        ELSE
          v_terminal_reason := 'entry_timeout';
          v_reason_code := 'entry_deadline_timeout';
        END IF;

        UPDATE public.video_sessions
        SET
          state = 'ended'::public.video_date_state,
          phase = 'ended',
          ended_at = COALESCE(ended_at, v_now),
          ended_reason = v_terminal_reason,
          entry_grace_expires_at = NULL,
          reconnect_grace_ends_at = NULL,
          participant_1_away_at = NULL,
          participant_2_away_at = NULL,
          duration_seconds = COALESCE(
            duration_seconds,
            GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.entry_started_at, v_session.started_at))))::int)
          ),
          state_updated_at = v_now
        WHERE id = p_session_id
          AND ended_at IS NULL;

        SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

        v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
          v_session.ended_at,
          v_session.ended_reason,
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at
        );

        UPDATE public.event_registrations
        SET
          queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'idle' END,
          current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
          current_partner_id = CASE
            WHEN v_should_open_survey THEN CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END
            ELSE NULL
          END,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);

        v_actor_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_1_decided_at
          WHEN v_is_p2 THEN v_session.participant_2_decided_at
          ELSE NULL
        END;
        v_partner_decided_at := CASE
          WHEN v_is_p1 THEN v_session.participant_2_decided_at
          WHEN v_is_p2 THEN v_session.participant_1_decided_at
          ELSE NULL
        END;
        v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
        v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          v_reason_code,
          NULL,
          v_ev,
          p_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'complete_entry',
            'source', p_source,
            'participant_1_liked', v_session.participant_1_liked,
            'participant_2_liked', v_session.participant_2_liked,
            'participant_1_decided_at', v_session.participant_1_decided_at,
            'participant_2_decided_at', v_session.participant_2_decided_at,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'waiting_for_self', v_waiting_for_self,
            'waiting_for_partner', v_waiting_for_partner,
            'local_decision_persisted', NOT v_waiting_for_self,
            'partner_decision_persisted', NOT v_waiting_for_partner,
            'state_before', v_state_before,
            'state_after', v_session.state::text,
            'deadline_due', true,
            'entry_deadline_seconds', 60,
            'entry_grace_removed', true,
            'survey_required', v_should_open_survey,
            'entry_grace_expires_at', v_session.entry_grace_expires_at,
            'p_reason', p_reason
          )
        );

        v_result := jsonb_build_object(
          'success', true,
          'state', 'ended',
          'reason', v_terminal_reason,
          'survey_required', v_should_open_survey,
          'waiting_for_self', v_waiting_for_self,
          'waiting_for_partner', v_waiting_for_partner,
          'local_decision_persisted', NOT v_waiting_for_self,
          'partner_decision_persisted', NOT v_waiting_for_partner
        );
        EXIT term_core;  END;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'date' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND NOT public.video_date_session_has_confirmed_encounter(
             v_session.date_started_at,
             v_session.state::text,
             v_session.phase,
             v_session.participant_1_joined_at,
             v_session.participant_2_joined_at,
             v_session.participant_1_remote_seen_at,
             v_session.participant_2_remote_seen_at
           ) THEN
          v_result := public.end_unconfirmed_video_date_start(
            p_session_id,
            p_actor,
            'deadline_' || COALESCE(NULLIF(p_source, ''), 'unknown'),
            p_reason
          );
          EXIT base;
        END IF;
      END IF;

      IF COALESCE(v_result->>'success', 'false') = 'true'
         AND v_result->>'state' = 'ended' THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND THEN
          v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
            v_session.ended_at,
            v_session.ended_reason,
            v_session.date_started_at,
            v_session.state::text,
            v_session.phase,
            v_session.participant_1_joined_at,
            v_session.participant_2_joined_at,
            v_session.participant_1_remote_seen_at,
            v_session.participant_2_remote_seen_at
          );

          IF v_should_open_survey THEN
            UPDATE public.event_registrations
            SET
              queue_status = 'in_survey',
              current_room_id = p_session_id,
              current_partner_id = CASE
                WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
                ELSE v_session.participant_1_id
              END,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);
          ELSE
            SELECT EXISTS (
              SELECT 1
              FROM public.events ev
              WHERE ev.id = v_session.event_id
                AND ev.status = 'live'
                AND ev.archived_at IS NULL
            ) INTO v_event_live;
            v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

            UPDATE public.event_registrations
            SET
              queue_status = v_resume_status,
              current_room_id = NULL,
              current_partner_id = NULL,
              last_active_at = now()
            WHERE event_id = v_session.event_id
              AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
              AND (current_room_id = p_session_id OR current_room_id IS NULL);
          END IF;

          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            CASE WHEN v_should_open_survey THEN 'deadline_confirmed_encounter_survey' ELSE 'deadline_unconfirmed_encounter_no_survey' END,
            NULL,
            v_session.event_id,
            p_actor,
            p_session_id,
            jsonb_build_object(
              'source', p_source,
              'reason', p_reason,
              'ended_reason', v_session.ended_reason,
              'date_started_at', v_session.date_started_at,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'survey_required', v_should_open_survey,
              'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END
            )
          );
        END IF;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey);
        EXIT base;
      END IF;

      v_result := v_result;
      EXIT base;    END;
  END;

  -- Head tail: post-base canonical room repair + promotion metadata merge.
  PERFORM public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    'finalize_video_date_entry_deadline:post_base_room_repair'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'promotion_reason', v_promotion->>'reason',
    'active_confirmed_encounter', COALESCE((v_promotion->>'active_confirmed_encounter')::boolean, false)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_due_joined_video_date_entries_bounded(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_result jsonb;
  v_mutual integer := 0;
  v_non_mutual integer := 0;
  v_timeout integer := 0;
  v_noop integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'entry'::public.video_date_state
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NOT NULL
      AND participant_2_joined_at IS NOT NULL
      AND entry_started_at IS NOT NULL
      AND entry_started_at + interval '60 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY entry_started_at, id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_result := public.finalize_video_date_entry_deadline(
      r.id,
      NULL,
      'server_cleanup_due_joined_entry',
      NULL
    );

    IF v_result->>'state' = 'date' THEN
      v_mutual := v_mutual + 1;
    ELSIF v_result->>'reason' = 'entry_not_mutual' THEN
      v_non_mutual := v_non_mutual + 1;
    ELSIF v_result->>'reason' = 'entry_timeout' THEN
      v_timeout := v_timeout + 1;
    ELSE
      v_noop := v_noop + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'entry_deadline_completed_mutual', v_mutual,
    'entry_deadline_not_mutual', v_non_mutual,
    'entry_deadline_timeout', v_timeout,
    'entry_deadline_noop', v_noop,
    'limit', v_limit,
    'total', v_mutual + v_non_mutual + v_timeout + v_noop
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases_bounded(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();

  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));

  r record;

  v_h int := 0;

  v_hg int := 0;

  v_d int := 0;

  v_ev uuid;

  v_p1 uuid;

  v_p2 uuid;
  v_base jsonb;

  v_partial jsonb;

  v_due jsonb;
BEGIN
  -- (fold of expire_vd_phases_base_20260501133000) entry-grace, entry-timeout
  -- and date-timeout sweeps
  <<leaf>>
  BEGIN
    FOR r IN
      SELECT id, event_id, participant_1_id, participant_2_id, entry_started_at, started_at
      FROM public.video_sessions
      WHERE ended_at IS NULL
        AND state = 'entry'::public.video_date_state
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND entry_grace_expires_at IS NOT NULL
        AND entry_grace_expires_at <= v_now
        AND NOT (
          reconnect_grace_ends_at IS NOT NULL
          AND reconnect_grace_ends_at > v_now
        )
      ORDER BY entry_grace_expires_at, id
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
    LOOP
      v_ev := r.event_id;
      v_p1 := r.participant_1_id;
      v_p2 := r.participant_2_id;

      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'entry_grace_expired',
        entry_grace_expires_at = NULL,
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.entry_started_at, r.started_at))))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2)
        AND current_room_id = r.id;

      v_hg := v_hg + 1;
    END LOOP;

    FOR r IN
      SELECT id, event_id, participant_1_id, participant_2_id, entry_started_at, started_at
      FROM public.video_sessions
      WHERE ended_at IS NULL
        AND state = 'entry'::public.video_date_state
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND entry_grace_expires_at IS NULL
        AND entry_started_at IS NOT NULL
        AND entry_started_at + interval '90 seconds' <= v_now
        AND NOT (
          reconnect_grace_ends_at IS NOT NULL
          AND reconnect_grace_ends_at > v_now
        )
      ORDER BY entry_started_at, id
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
    LOOP
      v_ev := r.event_id;
      v_p1 := r.participant_1_id;
      v_p2 := r.participant_2_id;

      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'entry_timeout',
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.entry_started_at, r.started_at))))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL
        AND date_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2)
        AND current_room_id = r.id;

      v_h := v_h + 1;
    END LOOP;

    FOR r IN
      SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
      FROM public.video_sessions
      WHERE ended_at IS NULL
        AND state = 'date'::public.video_date_state
        AND date_started_at IS NOT NULL
        AND date_started_at
          + ((300 + COALESCE(date_extra_seconds, 0) + 60) * interval '1 second') <= v_now
        AND NOT (
          reconnect_grace_ends_at IS NOT NULL
          AND reconnect_grace_ends_at > v_now
        )
      ORDER BY date_started_at, id
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
    LOOP
      v_ev := r.event_id;
      v_p1 := r.participant_1_id;
      v_p2 := r.participant_2_id;

      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'date_timeout',
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.date_started_at, r.started_at))))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL
        AND date_started_at IS NOT NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2)
        AND current_room_id = r.id;

      v_d := v_d + 1;
    END LOOP;

    v_base := jsonb_build_object(
      'entry_timeout', v_h,
      'entry_grace_expired', v_hg,
      'date_timeout', v_d,
      'limit', v_limit,
      'total', v_h + v_hg + v_d
    );
    EXIT leaf;  END;

  -- (fold of expire_vd_phases_base_20260502143000) stale partial-join sweep
  v_partial := public.expire_stale_video_date_partial_joins_bounded(v_limit);

  -- due joined-entry deadline finalization
  v_due := public.expire_due_joined_video_date_entries_bounded(v_limit);

  RETURN v_base || jsonb_build_object(
    'partial_join_peer_timeout', COALESCE((v_partial->>'partial_join_peer_timeout')::int, 0),
    'entry_deadline_completed_mutual', COALESCE((v_due->>'entry_deadline_completed_mutual')::int, 0),
    'entry_deadline_not_mutual', COALESCE((v_due->>'entry_deadline_not_mutual')::int, 0),
    'entry_deadline_timeout', COALESCE((v_due->>'entry_deadline_timeout')::int, 0),
    'entry_deadline_noop', COALESCE((v_due->>'entry_deadline_noop')::int, 0),
    'total', COALESCE((v_base->>'total')::int, 0)
      + COALESCE((v_partial->>'total')::int, 0)
      + COALESCE((v_due->>'total')::int, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_stale_video_date_prepare_entries(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  n integer := 0;
  v_base integer := 0;
  v_registration_rows integer := 0;
BEGIN
  -- (fold of repair_stale_vd_prepare_both_join_v1) provider-room-missing repair
  DECLARE
    v_now timestamptz := now();
    r record;
    n integer := 0;
    v_registration_rows integer := 0;
  BEGIN
    FOR r IN
      SELECT id, event_id, participant_1_id, participant_2_id, started_at
      FROM public.video_sessions
      WHERE ended_at IS NULL
        AND state = 'entry'::public.video_date_state
        AND entry_started_at IS NOT NULL
        AND entry_started_at < v_now - interval '5 minutes'
        AND daily_room_name IS NULL
        AND daily_room_url IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
      ORDER BY entry_started_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
      FOR UPDATE SKIP LOCKED
    LOOP
      UPDATE public.video_sessions
      SET
        state = 'ended',
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'prepare_entry_provider_failed_repair',
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = r.event_id
        AND profile_id IN (r.participant_1_id, r.participant_2_id)
        AND current_room_id = r.id;

      GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

      IF v_registration_rows = 0 THEN
        PERFORM public.record_event_loop_observability(
          'repair_stale_video_date_prepare_entries',
          'deferred',
          'stale_prepare_entry_registration_unlinked',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object('reason', 'no_registration_current_room_link')
        );
      END IF;

      PERFORM public.record_event_loop_observability(
        'repair_stale_video_date_prepare_entries',
        'success',
        'stale_prepare_entry_no_daily_room',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('ended_reason', 'prepare_entry_provider_failed_repair')
      );
      n := n + 1;
    END LOOP;

    v_base := n;  END;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at, state_updated_at, ready_gate_expires_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'entry'::public.video_date_state
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND daily_room_name IS NOT NULL
      AND daily_room_url IS NOT NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND COALESCE(state_updated_at, ready_gate_expires_at, started_at) < v_now - interval '5 minutes'
    ORDER BY COALESCE(state_updated_at, ready_gate_expires_at, started_at), id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'prepare_entry_daily_join_missing',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'repair_stale_video_date_prepare_entries',
      CASE WHEN v_registration_rows = 0 THEN 'deferred' ELSE 'success' END,
      'stale_prepare_entry_no_daily_join',
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'ended_reason', 'prepare_entry_daily_join_missing',
        'entry_timer', 'never_started',
        'registration_rows', v_registration_rows
      )
    );
    n := n + 1;
  END LOOP;

  RETURN COALESCE(v_base, 0) + n;END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := 100;

  v_total integer := 0;

  v_recovery jsonb;

  v_repaired integer := 0;

  v_phase jsonb;
  v_now timestamptz := now();

  r record;

  v_rows integer := 0;

  v_registration_rows integer := 0;

  v_base integer := 0;

  v_extended integer := 0;
BEGIN
  -- (fold of expire_stale_video_sessions_bounded) ready-gate room recovery
  v_recovery := public.recover_ready_gate_missing_rooms_v1(v_limit, 20, 120);
  v_total := v_total + COALESCE((v_recovery->>'terminalized')::integer, 0);

  -- (fold of *_202605232020_base) stale pre-date ready-gate blocker repair
  v_repaired := public.terminalize_stale_pre_date_ready_gate_blockers(
    v_limit,
    'expire_stale_video_sessions'
  );
  v_total := v_total + COALESCE(v_repaired, 0);

  -- (fold of *_202605060900_base) prepare-entry lease guard + expiry
  -- Defensive compatibility: if a lease exists from a previous deploy window,
  -- make the legacy ready_gate_expires_at guard match the lease so delegated
  -- cleanup cannot expire an active provider handoff.
  UPDATE public.video_sessions
  SET
    ready_gate_expires_at = prepare_entry_expires_at,
    state_updated_at = v_now
  WHERE ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status = 'both_ready'
    AND prepare_entry_expires_at IS NOT NULL
    AND prepare_entry_expires_at > v_now
    AND (ready_gate_expires_at IS NULL OR ready_gate_expires_at < prepare_entry_expires_at)
    AND date_started_at IS NULL
    AND entry_started_at IS NULL
    AND daily_room_name IS NULL
    AND daily_room_url IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL;

  GET DIAGNOSTICS v_extended = ROW_COUNT;

  FOR r IN
    SELECT *
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND prepare_entry_expires_at IS NOT NULL
      AND prepare_entry_expires_at <= v_now
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY prepare_entry_expires_at, id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'prepare_entry_timeout',
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND prepare_entry_expires_at IS NOT NULL
      AND prepare_entry_expires_at <= v_now
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      'prepare_entry_timeout',
      NULL,
      r.event_id,
      r.prepare_entry_actor_id,
      r.id,
      jsonb_build_object(
        'entry_attempt_id', r.prepare_entry_attempt_id,
        'prepare_entry_started_at', r.prepare_entry_started_at,
        'prepare_entry_expires_at', r.prepare_entry_expires_at,
        'registration_rows', v_registration_rows
      )
    );

    v_base := v_base + 1;
  END LOOP;

  -- (fold of *_202605031300_base) phase expiry + prepare-entry repair
  v_phase := public.expire_stale_video_date_phases_bounded(v_limit);
  v_base := v_base + COALESCE((v_phase->>'total')::integer, 0)
    + COALESCE(public.repair_stale_video_date_prepare_entries(v_limit), 0);

  IF v_extended > 0 THEN
    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'no_op',
      'active_prepare_entry_lease_preserved',
      NULL,
      NULL,
      NULL,
      NULL,
      jsonb_build_object('extended_rows', v_extended)
    );
  END IF;

  v_total := v_total + COALESCE(v_base, 0);
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r record;

  v_reconcile jsonb;

  v_provider_absence_terminalized integer := 0;

  v_base_count integer := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= now()
    ORDER BY id
    LIMIT 100
  LOOP
    v_reconcile := public.video_date_reconcile_provider_absence_v1(
      r.id,
      'expire_video_date_reconnect_graces_provider_absence'
    );
    IF COALESCE((v_reconcile->>'terminalized')::boolean, false) THEN
      v_provider_absence_terminalized := v_provider_absence_terminalized + 1;
    END IF;
  END LOOP;

  -- (fold of expire_vd_reconnect_graces_202606071031_base) presence-aware
  -- reconnect-grace expiry with survey continuity
  DECLARE
    v_now timestamptz := now();
    r public.video_sessions%ROWTYPE;
    n int := 0;
    v_event_live boolean := false;
    v_resume_status text := 'idle';
    v_should_open_survey boolean := false;
    v_participant_1_active boolean := false;
    v_participant_2_active boolean := false;
    v_latest_away_at timestamptz;
    v_latest_away_reason text;
    v_lifecycle_away boolean := false;
    v_remote_seen_after_away boolean := false;
    v_participant_1_join_after_away boolean := false;
    v_participant_2_join_after_away boolean := false;
    v_join_after_away boolean := false;
    v_surface_active_near_away boolean := false;
    v_recent_lifecycle_media boolean := false;
  BEGIN
    FOR r IN
      SELECT *
      FROM public.video_sessions
      WHERE ended_at IS NULL
        AND reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at <= v_now
      ORDER BY id
      FOR UPDATE SKIP LOCKED
    LOOP
      v_participant_1_active := public.video_date_latest_presence_is_active(
        r.participant_1_joined_at,
        r.participant_1_away_at
      );
      v_participant_2_active := public.video_date_latest_presence_is_active(
        r.participant_2_joined_at,
        r.participant_2_away_at
      );
      v_latest_away_at := GREATEST(
        COALESCE(r.participant_1_away_at, '-infinity'::timestamptz),
        COALESCE(r.participant_2_away_at, '-infinity'::timestamptz)
      );

      SELECT lower(NULLIF(COALESCE(e.detail->>'reason', e.detail->>'p_reason'), ''))
      INTO v_latest_away_reason
      FROM public.event_loop_observability_events e
      WHERE e.session_id = r.id
        AND e.operation = 'video_date_transition'
        AND e.reason_code = 'mark_reconnect_self_away'
      ORDER BY e.created_at DESC
      LIMIT 1;

      v_lifecycle_away := v_latest_away_reason IN (
        'web_visibilitychange',
        'web_freeze',
        'web_beforeunload',
        'web_pagehide',
        'app_background'
      );

      v_participant_1_join_after_away :=
        r.participant_1_away_at IS NOT NULL
        AND COALESCE(r.participant_1_joined_at, '-infinity'::timestamptz) > r.participant_1_away_at;
      v_participant_2_join_after_away :=
        r.participant_2_away_at IS NOT NULL
        AND COALESCE(r.participant_2_joined_at, '-infinity'::timestamptz) > r.participant_2_away_at;

      v_join_after_away :=
        v_latest_away_at <> '-infinity'::timestamptz
        AND (
          (
            r.participant_1_away_at = v_latest_away_at
            AND v_participant_1_join_after_away
          )
          OR (
            r.participant_2_away_at = v_latest_away_at
            AND v_participant_2_join_after_away
          )
        );

      v_remote_seen_after_away :=
        r.participant_1_remote_seen_at IS NOT NULL
        AND r.participant_2_remote_seen_at IS NOT NULL
        AND v_latest_away_at <> '-infinity'::timestamptz
        AND GREATEST(r.participant_1_remote_seen_at, r.participant_2_remote_seen_at) > v_latest_away_at;

      v_recent_lifecycle_media :=
        v_lifecycle_away
        AND r.participant_1_remote_seen_at IS NOT NULL
        AND r.participant_2_remote_seen_at IS NOT NULL
        AND v_latest_away_at <> '-infinity'::timestamptz
        AND GREATEST(r.participant_1_remote_seen_at, r.participant_2_remote_seen_at) >= v_latest_away_at - interval '30 seconds';

      SELECT EXISTS (
        SELECT 1
        FROM public.video_date_surface_claims c
        WHERE c.session_id = r.id
          AND c.profile_id IN (r.participant_1_id, r.participant_2_id)
          AND c.surface = 'video_date'
          AND c.released_at IS NULL
          AND v_latest_away_at <> '-infinity'::timestamptz
          AND c.expires_at >= v_latest_away_at
          AND c.expires_at >= v_now
          AND GREATEST(COALESCE(c.updated_at, c.claimed_at), c.claimed_at) >= v_latest_away_at - interval '20 seconds'
      )
      INTO v_surface_active_near_away;

      IF (v_participant_1_active AND v_participant_2_active)
         OR v_remote_seen_after_away
         OR v_join_after_away
         OR (v_lifecycle_away AND (v_surface_active_near_away OR v_recent_lifecycle_media)) THEN
        UPDATE public.video_sessions
        SET
          reconnect_grace_ends_at = NULL,
          participant_1_away_at = CASE
            WHEN v_participant_1_active
              OR v_remote_seen_after_away
              OR v_participant_1_join_after_away
              OR v_lifecycle_away THEN NULL
            ELSE participant_1_away_at
          END,
          participant_2_away_at = CASE
            WHEN v_participant_2_active
              OR v_remote_seen_after_away
              OR v_participant_2_join_after_away
              OR v_lifecycle_away THEN NULL
            ELSE participant_2_away_at
          END,
          state_updated_at = v_now
        WHERE id = r.id;

        PERFORM public.bump_video_session_seq(r.id);
        PERFORM public.record_event_loop_observability(
          'expire_video_date_reconnect_graces',
          'no_op',
          'reconnect_grace_expiry_suppressed_latest_presence',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object(
            'participant_1_active', v_participant_1_active,
            'participant_2_active', v_participant_2_active,
            'remote_seen_after_away', v_remote_seen_after_away,
            'participant_1_join_after_away', v_participant_1_join_after_away,
            'participant_2_join_after_away', v_participant_2_join_after_away,
            'join_after_away', v_join_after_away,
            'surface_active_near_away', v_surface_active_near_away,
            'recent_lifecycle_media', v_recent_lifecycle_media,
            'latest_away_reason', v_latest_away_reason,
            'participant_1_joined_at', r.participant_1_joined_at,
            'participant_2_joined_at', r.participant_2_joined_at,
            'participant_1_away_at', r.participant_1_away_at,
            'participant_2_away_at', r.participant_2_away_at,
            'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
            'participant_2_remote_seen_at', r.participant_2_remote_seen_at
          )
        );
        CONTINUE;
      END IF;

      v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
        v_now,
        'reconnect_grace_expired',
        r.date_started_at,
        r.state::text,
        r.phase,
        r.participant_1_joined_at,
        r.participant_2_joined_at,
        r.participant_1_remote_seen_at,
        r.participant_2_remote_seen_at
      );

      SELECT EXISTS (
        SELECT 1
        FROM public.events ev
        WHERE ev.id = r.event_id
          AND ev.status = 'live'
          AND ev.archived_at IS NULL
      ) INTO v_event_live;

      v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

      UPDATE public.video_sessions
      SET
        state = 'ended'::public.video_date_state,
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'reconnect_grace_expired',
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        duration_seconds = COALESCE(
          r.duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.started_at, v_now))))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id;

      UPDATE public.event_registrations
      SET
        queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
        current_room_id = CASE WHEN v_should_open_survey THEN r.id ELSE NULL END,
        current_partner_id = CASE
          WHEN v_should_open_survey AND profile_id = r.participant_1_id THEN r.participant_2_id
          WHEN v_should_open_survey AND profile_id = r.participant_2_id THEN r.participant_1_id
          ELSE NULL
        END,
        last_active_at = v_now
      WHERE event_id = r.event_id
        AND profile_id IN (r.participant_1_id, r.participant_2_id);

      PERFORM public.record_event_loop_observability(
        'expire_video_date_reconnect_graces',
        'success',
        CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'ended_reason', 'reconnect_grace_expired',
          'survey_required', v_should_open_survey,
          'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
          'latest_away_reason', v_latest_away_reason,
          'participant_1_joined_at', r.participant_1_joined_at,
          'participant_2_joined_at', r.participant_2_joined_at,
          'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', r.participant_2_remote_seen_at
        )
      );

      n := n + 1;
    END LOOP;

    v_base_count := n;  END;
  RETURN v_provider_absence_terminalized + v_base_count;END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_continue_entry_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();

  v_result jsonb;

  v_session public.video_sessions%ROWTYPE;

  v_success boolean := false;

  v_survey_required boolean := false;

  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:continue_entry');

  v_request jsonb := jsonb_build_object('action', 'continue_entry');

  v_begin jsonb;

  v_command_id bigint;

  v_transition jsonb;

  v_before public.video_sessions%ROWTYPE;

  v_after public.video_sessions%ROWTYPE;

  v_actor_role text;

  v_actor_decision_changed boolean := false;

  v_advanced_to_date boolean := false;

  v_event jsonb := '{}'::jsonb;
BEGIN
  <<core>>
  BEGIN
    IF v_actor IS NULL THEN
      v_result := jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
      EXIT core;
    END IF;

    v_begin := public.video_session_command_begin_v2(
      p_session_id,
      v_actor,
      'continue_entry',
      v_key,
      v_request,
      p_request_hash
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      v_result := COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'commandStatus', COALESCE(v_begin->>'status', 'rejected')
      );
      EXIT core;
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
        'commandStatus', v_begin->>'status',
        'commandId', (v_begin->>'commandId')::bigint,
        'requestHash', v_begin->>'requestHash',
        'state', COALESCE(v_after.state::text, COALESCE(v_begin->'result', '{}'::jsonb)->>'state'),
        'phase', COALESCE(v_after.phase, COALESCE(v_begin->'result', '{}'::jsonb)->>'phase'),
        'date_started_at', COALESCE(
          to_jsonb(v_after.date_started_at),
          COALESCE(v_begin->'result', '{}'::jsonb)->'date_started_at'
        ),
        'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
      );
      EXIT core;
    END IF;

    IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
      v_result := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'command_in_progress',
        'retryable', true,
        'commandStatus', v_begin->>'status',
        'commandId', (v_begin->>'commandId')::bigint,
        'requestHash', v_begin->>'requestHash'
      );
      EXIT core;
    END IF;

    v_command_id := (v_begin->>'commandId')::bigint;

    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      v_result := jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'session_not_found',
        'commandStatus', 'rejected',
        'commandId', v_command_id,
        'requestHash', v_begin->>'requestHash'
      );
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      v_result := v_result;
      EXIT core;
    END IF;

    v_transition := public.video_date_transition(p_session_id, 'vibe', NULL);
    v_success := COALESCE(
      jsonb_typeof(v_transition->'success') = 'boolean'
        AND (v_transition->>'success')::boolean,
      false
    );

    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_actor_role := CASE
      WHEN v_actor = v_after.participant_1_id THEN 'participant_1'
      WHEN v_actor = v_after.participant_2_id THEN 'participant_2'
      ELSE NULL
    END;
    v_actor_decision_changed := v_success AND (
      (
        v_actor = v_after.participant_1_id
        AND v_before.participant_1_decided_at IS NULL
        AND v_after.participant_1_decided_at IS NOT NULL
      )
      OR (
        v_actor = v_after.participant_2_id
        AND v_before.participant_2_decided_at IS NULL
        AND v_after.participant_2_decided_at IS NOT NULL
      )
    );
    v_advanced_to_date := v_success AND (
      v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
      OR v_before.state::text IS DISTINCT FROM v_after.state::text
      OR v_before.phase IS DISTINCT FROM v_after.phase
    ) AND (v_after.state::text = 'date' OR v_after.phase = 'date');

    IF v_advanced_to_date THEN
      v_event := public.append_video_session_event_v2(
        p_session_id,
        'entry_continued_to_date',
        'participants',
        v_actor,
        jsonb_build_object(
          'action', 'continue_entry',
          'state', v_after.state::text,
          'phase', v_after.phase,
          'date_started_at', v_after.date_started_at
        ),
        jsonb_build_object(
          'state', v_after.state::text,
          'phase', v_after.phase,
          'date_started_at', v_after.date_started_at
        ),
        true,
        gen_random_uuid()
      );
    ELSIF v_actor_decision_changed THEN
      v_event := public.append_video_session_event_v2(
        p_session_id,
        'entry_continue_recorded',
        'actor_only',
        v_actor,
        jsonb_build_object(
          'action', 'continue_entry',
          'actor_role', v_actor_role,
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        jsonb_build_object(
          'actor_role', v_actor_role,
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        false,
        gen_random_uuid()
      );
    END IF;

    v_result := COALESCE(v_transition, '{}'::jsonb) || jsonb_build_object(
      'ok', v_success,
      'success', v_success,
      'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash',
      'state', v_after.state::text,
      'phase', v_after.phase,
      'date_started_at', v_after.date_started_at,
      'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq)
    );

    PERFORM public.video_session_command_finish_v2(
      v_command_id,
      v_actor,
      CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      v_result
    );
    v_result := v_result;
    EXIT core;  END;

  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF v_success AND v_result->>'state' = 'date' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND NOT public.video_date_session_has_confirmed_encounter(
         v_session.date_started_at,
         v_session.state::text,
         v_session.phase,
         v_session.participant_1_joined_at,
         v_session.participant_2_joined_at,
         v_session.participant_1_remote_seen_at,
         v_session.participant_2_remote_seen_at
       ) THEN
      RETURN public.end_unconfirmed_video_date_start(
        p_session_id,
        v_actor,
        'video_session_continue_entry_v2',
        COALESCE(NULLIF(v_result->>'reason', ''), p_request_hash)
      );
    END IF;
  END IF;

  IF v_success AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_survey_required := public.video_date_session_is_post_date_survey_eligible_v2(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at,
        v_session.participant_1_remote_seen_at,
        v_session.participant_2_remote_seen_at
      );
      RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_survey_required);
    END IF;
  END IF;

  RETURN v_result;END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_entry_auto_promote_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_session public.video_sessions%ROWTYPE;
  v_eligibility jsonb := '{}'::jsonb;
  v_gate jsonb := '{}'::jsonb;
  v_mark jsonb := '{}'::jsonb;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'video_session_entry_auto_promote_v2'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', false,
      'promotion_blocked_by_lifecycle_eligibility', true
    );
  END IF;

  v_gate := public.video_date_stable_bilateral_media_gate_v1(p_session_id);

  IF COALESCE((v_gate->>'stable_bilateral_media')::boolean, false) IS NOT TRUE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'stable_bilateral_media_auto_promotion_waiting',
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'source', 'video_session_entry_auto_promote_v2',
          'stable_bilateral_media_gate', v_gate,
          'idempotency_key_present', p_idempotency_key IS NOT NULL,
          'request_hash_present', p_request_hash IS NOT NULL
        )
      );
    END IF;

    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'promotion_reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'retryable', true,
      'terminal', false,
      'waiting_for_stable_copresence', true,
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', true,
      'promotion_blocked_by_stable_bilateral_media', true,
      'stable_bilateral_media_gate', v_gate
    );
  END IF;

  v_mark := public.video_date_mark_stable_bilateral_media_v1(
    p_session_id,
    'video_session_entry_auto_promote_v2',
    v_gate
  );

  v_payload := COALESCE(public.vd_auto_promote_stable_media_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  ), '{}'::jsonb);

  RETURN v_payload || jsonb_build_object(
    'lifecycle_eligibility_checked', true,
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate,
    'stable_bilateral_media_mark', v_mark
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_auto_promote_eligible_base(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();

  v_provider_promotion jsonb := '{}'::jsonb;

  v_confirmed_promotion jsonb := '{}'::jsonb;

  v_result jsonb;

  v_session public.video_sessions%ROWTYPE;

  v_success boolean := false;

  v_survey_required boolean := false;

  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:entry_auto_promote');

  v_request jsonb := jsonb_build_object('action', 'entry_auto_promote');

  v_begin jsonb;

  v_command_id bigint;

  v_transition jsonb;

  v_before public.video_sessions%ROWTYPE;

  v_after public.video_sessions%ROWTYPE;

  v_event jsonb := '{}'::jsonb;

  v_delete_room_name text;

  v_seconds_remaining integer := NULL;

  v_state_changed boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_provider_promotion := public.video_date_promote_provider_overlap_v1(
    p_session_id,
    v_actor,
    'video_session_entry_auto_promote_v2',
    COALESCE(NULLIF(p_request_hash, ''), NULLIF(p_idempotency_key, ''), 'client_auto_promote'),
    true
  );

  IF COALESCE((v_provider_promotion->>'provider_overlap_promoted_to_date')::boolean, false) THEN
    RETURN v_provider_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', false,
      'retryable', false
    );
  END IF;

  v_confirmed_promotion := public.video_date_promote_confirmed_encounter_v1(
    p_session_id,
    v_actor,
    'video_session_entry_auto_promote_v2',
    COALESCE(NULLIF(p_request_hash, ''), NULLIF(p_idempotency_key, ''), 'client_auto_promote'),
    true
  );

  IF COALESCE((v_confirmed_promotion->>'promoted')::boolean, false) THEN
    RETURN v_confirmed_promotion || jsonb_build_object(
      'early_confirmed_encounter_promoted', true,
      'provider_overlap_promotion', v_provider_promotion,
      'retryable', false
    );
  END IF;

  IF COALESCE(v_confirmed_promotion->>'error', '') IN ('not_participant', 'session_not_found') THEN
    RETURN v_confirmed_promotion || jsonb_build_object(
      'provider_overlap_promotion', v_provider_promotion
    );
  END IF;

  <<auto_core>>
  BEGIN
    <<auto_inner>>
    BEGIN
      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
        EXIT auto_inner;
      END IF;

      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF NOT FOUND THEN
        v_result := jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
        EXIT auto_inner;
      END IF;

      IF v_actor IS DISTINCT FROM v_before.participant_1_id
         AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
        v_result := jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
        EXIT auto_inner;
      END IF;

      IF v_before.ended_at IS NOT NULL
         OR v_before.state::text = 'ended'
         OR v_before.phase = 'ended' THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'ended',
          'phase', 'ended',
          'already_ended', true,
          'reason', v_before.ended_reason,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      IF v_before.state::text = 'date'
         OR v_before.phase = 'date'
         OR v_before.date_started_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_before.date_started_at,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      IF v_before.entry_started_at IS NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', COALESCE(v_before.state::text, 'unknown'),
          'phase', COALESCE(v_before.phase, 'unknown'),
          'reason', 'entry_not_started',
          'retryable', true,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      v_seconds_remaining := GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM ((v_before.entry_started_at + interval '60 seconds') - now())))::int
      );

      IF v_seconds_remaining > 0 THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'entry',
          'phase', 'entry',
          'reason', 'entry_auto_promote_not_due',
          'seconds_remaining', v_seconds_remaining,
          'retryable', true,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_result := jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
        EXIT auto_inner;
      END IF;

      IF v_before.ended_at IS NOT NULL
         OR v_before.state::text = 'ended'
         OR v_before.phase = 'ended' THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'ended',
          'phase', 'ended',
          'already_ended', true,
          'reason', v_before.ended_reason,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      IF v_before.state::text = 'date'
         OR v_before.phase = 'date'
         OR v_before.date_started_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'date',
          'phase', 'date',
          'date_started_at', v_before.date_started_at,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      IF v_before.entry_started_at IS NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', COALESCE(v_before.state::text, 'unknown'),
          'phase', COALESCE(v_before.phase, 'unknown'),
          'reason', 'entry_not_started',
          'retryable', true,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      v_seconds_remaining := GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM ((v_before.entry_started_at + interval '60 seconds') - now())))::int
      );

      IF v_seconds_remaining > 0 THEN
        v_result := jsonb_build_object(
          'ok', true,
          'success', true,
          'state', 'entry',
          'phase', 'entry',
          'reason', 'entry_auto_promote_not_due',
          'seconds_remaining', v_seconds_remaining,
          'retryable', true,
          'session_seq', COALESCE(v_before.session_seq, 0)
        );
        EXIT auto_inner;
      END IF;

      v_begin := public.video_session_command_begin_v2(
        p_session_id,
        v_actor,
        'entry_auto_promote',
        v_key,
        v_request,
        p_request_hash
      );

      IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
        v_result := COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
          'ok', false,
          'success', false,
          'commandStatus', COALESCE(v_begin->>'status', 'rejected')
        );
        EXIT auto_inner;
      END IF;

      IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
        SELECT *
        INTO v_after
        FROM public.video_sessions
        WHERE id = p_session_id;

        v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
          'commandStatus', v_begin->>'status',
          'commandId', (v_begin->>'commandId')::bigint,
          'requestHash', v_begin->>'requestHash',
          'state', COALESCE(v_after.state::text, COALESCE(v_begin->'result', '{}'::jsonb)->>'state'),
          'phase', COALESCE(v_after.phase, COALESCE(v_begin->'result', '{}'::jsonb)->>'phase'),
          'date_started_at', COALESCE(to_jsonb(v_after.date_started_at), COALESCE(v_begin->'result', '{}'::jsonb)->'date_started_at'),
          'reason', COALESCE(v_after.ended_reason, COALESCE(v_begin->'result', '{}'::jsonb)->>'reason'),
          'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
        );
        EXIT auto_inner;
      END IF;

      IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'command_in_progress',
          'retryable', true,
          'commandStatus', v_begin->>'status',
          'commandId', (v_begin->>'commandId')::bigint,
          'requestHash', v_begin->>'requestHash'
        );
        EXIT auto_inner;
      END IF;

      v_command_id := (v_begin->>'commandId')::bigint;

      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF NOT FOUND THEN
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'session_not_found',
          'commandStatus', 'rejected',
          'commandId', v_command_id,
          'requestHash', v_begin->>'requestHash'
        );
        PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
        v_result := v_result;
        EXIT auto_inner;
      END IF;

      v_transition := public.finalize_video_date_entry_deadline(
        p_session_id,
        v_actor,
        'video_session_entry_auto_promote_v2',
        'entry_auto_promote'
      );
      v_success := COALESCE(
        CASE WHEN jsonb_typeof(v_transition->'success') = 'boolean' THEN (v_transition->>'success')::boolean ELSE NULL END,
        CASE WHEN jsonb_typeof(v_transition->'ok') = 'boolean' THEN (v_transition->>'ok')::boolean ELSE NULL END,
        false
      );

      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_state_changed := v_success AND (
        v_before.state::text IS DISTINCT FROM v_after.state::text
        OR v_before.phase IS DISTINCT FROM v_after.phase
        OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
        OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
        OR v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
      );

      IF v_state_changed AND (v_after.state::text = 'date' OR v_after.phase = 'date') THEN
        v_event := public.append_video_session_event_v2(
          p_session_id,
          'entry_auto_promoted_to_date',
          'participants',
          v_actor,
          jsonb_build_object(
            'action', 'entry_auto_promote',
            'state', v_after.state::text,
            'phase', v_after.phase,
            'date_started_at', v_after.date_started_at
          ),
          jsonb_build_object(
            'state', v_after.state::text,
            'phase', v_after.phase,
            'date_started_at', v_after.date_started_at
          ),
          true,
          gen_random_uuid()
        );
      ELSIF v_state_changed AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended') THEN
        v_event := public.append_video_session_event_v2(
          p_session_id,
          'entry_auto_promoted_terminal',
          'participants',
          v_actor,
          jsonb_build_object(
            'action', 'entry_auto_promote',
            'state', v_after.state::text,
            'phase', v_after.phase,
            'reason', v_after.ended_reason
          ),
          jsonb_build_object(
            'state', v_after.state::text,
            'phase', v_after.phase,
            'reason', v_after.ended_reason
          ),
          true,
          gen_random_uuid()
        );
      END IF;

      v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_before.daily_room_name, ''));
      IF v_success
         AND (v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended')
         AND v_delete_room_name IS NOT NULL THEN
        PERFORM public.video_date_outbox_enqueue_v2(
          p_session_id,
          'daily.delete_video_date_room',
          jsonb_build_object(
            'roomName', v_delete_room_name,
            'source', 'video_session_entry_auto_promote_v2'
          ),
          'phase3:delete_room:' || p_session_id::text,
          now()
        );
      END IF;

      v_result := COALESCE(v_transition, '{}'::jsonb) || jsonb_build_object(
        'ok', v_success,
        'success', v_success,
        'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
        'commandId', v_command_id,
        'requestHash', v_begin->>'requestHash',
        'state', COALESCE(v_after.state::text, COALESCE(v_transition->>'state', 'unknown')),
        'phase', COALESCE(v_after.phase, COALESCE(v_transition->>'phase', 'unknown')),
        'date_started_at', v_after.date_started_at,
        'reason', COALESCE(v_after.ended_reason, v_transition->>'reason'),
        'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq)
      );

      PERFORM public.video_session_command_finish_v2(
        v_command_id,
        v_actor,
        CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
        v_result
      );
      v_result := v_result;
      EXIT auto_inner;  END;

    v_success := COALESCE(
      CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
      CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
      false
    );

    IF v_success AND v_result->>'state' = 'date' THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND NOT public.video_date_session_has_confirmed_encounter(
           v_session.date_started_at,
           v_session.state::text,
           v_session.phase,
           v_session.participant_1_joined_at,
           v_session.participant_2_joined_at,
           v_session.participant_1_remote_seen_at,
           v_session.participant_2_remote_seen_at
         ) THEN
        v_result := public.end_unconfirmed_video_date_start(
          p_session_id,
          v_actor,
          'video_session_entry_auto_promote_v2',
          COALESCE(NULLIF(v_result->>'reason', ''), p_request_hash)
        );
        EXIT auto_core;
      END IF;
    END IF;

    IF v_success AND v_result->>'state' = 'ended' THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND THEN
        v_survey_required := public.video_date_session_is_post_date_survey_eligible_v2(
          v_session.ended_at,
          v_session.ended_reason,
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        );
        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_survey_required);
        EXIT auto_core;
      END IF;
    END IF;

    v_result := v_result;
    EXIT auto_core;  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'early_confirmed_encounter_promoted', false,
    'provider_overlap_promotion', v_provider_promotion,
    'provider_overlap_promoted_to_date', COALESCE((v_provider_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
    'promotion_reason', COALESCE(v_provider_promotion->>'reason', v_confirmed_promotion->>'reason'),
    'active_confirmed_encounter', COALESCE((v_confirmed_promotion->>'active_confirmed_encounter')::boolean, false)
  );END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_promote_ce_stable_media_base(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'video_date_promote_confirmed_encounter_v1'::text, p_reason text DEFAULT NULL::text, p_require_participant boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_auth_actor uuid := auth.uid();
  v_effective_actor uuid;
  v_require_participant boolean := COALESCE(p_require_participant, false);
  v_is_service_role boolean := auth.role() = 'service_role';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF v_is_service_role THEN
    v_effective_actor := COALESCE(p_actor, v_auth_actor);
  ELSE
    IF v_auth_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    IF p_actor IS NOT NULL AND p_actor IS DISTINCT FROM v_auth_actor THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'actor_mismatch');
    END IF;

    v_effective_actor := v_auth_actor;
    v_require_participant := true;
  END IF;

  IF v_require_participant THEN
    IF v_effective_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
    END IF;

    IF v_effective_actor IS DISTINCT FROM v_session.participant_1_id
       AND v_effective_actor IS DISTINCT FROM v_session.participant_2_id THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
    END IF;
  END IF;

  -- (fold of vd_promote_ce_auth_20260605221535_base; p_actor bound to
  -- v_effective_actor, p_require_participant to v_require_participant)
  DECLARE
    v_now timestamptz := clock_timestamp();
    v_session public.video_sessions%ROWTYPE;
    v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
    v_room_repair jsonb := '{}'::jsonb;
    v_expected_room_url text;
    v_participant_1_latest_evidence_at timestamptz;
    v_participant_2_latest_evidence_at timestamptz;
    v_first_confirmed_encounter_at timestamptz;
    v_has_explicit_pass boolean := false;
    v_both_decided boolean := false;
    v_confirmed_encounter boolean := false;
    v_active_confirmed_encounter boolean := false;
    v_previous_entry_started_at timestamptz;
    v_date_started_at timestamptz;
    v_event jsonb := '{}'::jsonb;
  BEGIN
    IF p_session_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
    END IF;

    v_room_repair := public.video_date_restore_canonical_room_metadata_v1(
      p_session_id,
      COALESCE(NULLIF(p_source, ''), 'confirmed_encounter_promotion') || ':preflight'
    );
    v_expected_room_url := COALESCE(
      NULLIF(v_room_repair->>'room_url', ''),
      'https://vibelyapp.daily.co/' || v_expected_room_name
    );

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
    END IF;

    IF v_require_participant AND v_effective_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    IF v_require_participant
       AND v_effective_actor IS DISTINCT FROM v_session.participant_1_id
       AND v_effective_actor IS DISTINCT FROM v_session.participant_2_id THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
    END IF;

    IF v_session.state::text = 'date'
       OR v_session.phase = 'date'
       OR v_session.date_started_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'promoted', false,
        'state', 'date',
        'phase', 'date',
        'date_started_at', v_session.date_started_at,
        'reason', 'already_in_date',
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    IF v_session.ended_at IS NOT NULL
       OR v_session.state::text = 'ended'
       OR v_session.phase = 'ended' THEN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        p_session_id,
        COALESCE(NULLIF(p_source, ''), 'confirmed_encounter_promotion') || ':terminal_room_repair'
      );

      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'promoted', false,
        'state', 'ended',
        'phase', 'ended',
        'reason', COALESCE(v_session.ended_reason, 'already_ended'),
        'survey_required', public.video_date_session_is_post_date_survey_eligible_v2(
          v_session.ended_at,
          v_session.ended_reason,
          v_session.date_started_at,
          v_session.state::text,
          v_session.phase,
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at,
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        ),
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    IF v_session.state IS DISTINCT FROM 'entry'::public.video_date_state
       OR COALESCE(v_session.phase, '') <> 'entry'
       OR v_session.entry_started_at IS NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'promoted', false,
        'state', COALESCE(v_session.state::text, 'unknown'),
        'phase', COALESCE(v_session.phase, 'unknown'),
        'reason', 'not_active_entry',
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    v_previous_entry_started_at := v_session.entry_started_at;
    v_has_explicit_pass := (
      (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
      OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
    );
    v_both_decided := v_session.participant_1_decided_at IS NOT NULL
      AND v_session.participant_2_decided_at IS NOT NULL;

    v_participant_1_latest_evidence_at := GREATEST(
      COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz)
    );
    v_participant_2_latest_evidence_at := GREATEST(
      COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
    );
    v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    );
    v_active_confirmed_encounter := v_confirmed_encounter
      AND (
        v_session.participant_1_away_at IS NULL
        OR v_session.participant_1_away_at <= v_participant_1_latest_evidence_at
      )
      AND (
        v_session.participant_2_away_at IS NULL
        OR v_session.participant_2_away_at <= v_participant_2_latest_evidence_at
      );

    IF v_has_explicit_pass
       OR v_both_decided
       OR NOT v_active_confirmed_encounter THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'confirmed_encounter_promotion_not_ready',
        NULL,
        v_session.event_id,
        v_effective_actor,
        p_session_id,
        jsonb_build_object(
          'source', p_source,
          'p_reason', p_reason,
          'has_explicit_pass', v_has_explicit_pass,
          'both_decided', v_both_decided,
          'confirmed_encounter', v_confirmed_encounter,
          'active_confirmed_encounter', v_active_confirmed_encounter,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'participant_1_away_at', v_session.participant_1_away_at,
          'participant_2_away_at', v_session.participant_2_away_at,
          'participant_1_latest_evidence_at', NULLIF(v_participant_1_latest_evidence_at, '-infinity'::timestamptz),
          'participant_2_latest_evidence_at', NULLIF(v_participant_2_latest_evidence_at, '-infinity'::timestamptz)
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'promoted', false,
        'state', v_session.state::text,
        'phase', v_session.phase,
        'reason', CASE
          WHEN v_has_explicit_pass THEN 'explicit_pass_present'
          WHEN v_both_decided THEN 'both_decided_before_promotion'
          WHEN NOT v_confirmed_encounter THEN 'confirmed_encounter_not_ready'
          ELSE 'confirmed_encounter_not_active'
        END,
        'confirmed_encounter', v_confirmed_encounter,
        'active_confirmed_encounter', v_active_confirmed_encounter,
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    v_date_started_at := v_now;
    v_first_confirmed_encounter_at := GREATEST(
      COALESCE(v_session.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
      COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
    );

    UPDATE public.video_sessions
    SET
      state = 'date'::public.video_date_state,
      phase = 'date',
      date_started_at = v_date_started_at,
      ended_at = NULL,
      ended_reason = NULL,
      reconnect_grace_ends_at = NULL,
      entry_grace_expires_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      daily_room_name = v_expected_room_name,
      daily_room_url = v_expected_room_url,
      daily_room_provider_verify_reason = COALESCE(
        daily_room_provider_verify_reason,
        'confirmed_encounter_promotion_room_restored'
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND state = 'entry'::public.video_date_state
      AND COALESCE(phase, '') = 'entry'
      AND date_started_at IS NULL
    RETURNING * INTO v_session;

    IF NOT FOUND THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      RETURN jsonb_build_object(
        'ok', true,
        'success', true,
        'promoted', false,
        'state', COALESCE(v_session.state::text, 'unknown'),
        'phase', COALESCE(v_session.phase, 'unknown'),
        'reason', 'promotion_lost_race',
        'session_seq', COALESCE(v_session.session_seq, 0)
      );
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_date',
      current_room_id = p_session_id,
      current_partner_id = CASE
        WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END,
      last_active_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

    v_event := public.append_video_session_event_v2(
      p_session_id,
      'confirmed_encounter_promoted_to_date',
      'participants',
      v_effective_actor,
      jsonb_build_object(
        'action', 'complete_entry',
        'source', p_source,
        'p_reason', p_reason,
        'previous_entry_started_at', v_previous_entry_started_at,
        'date_started_at', v_date_started_at,
        'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
        'participant_1_joined_at', v_session.participant_1_joined_at,
        'participant_2_joined_at', v_session.participant_2_joined_at,
        'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
        'daily_room_name', v_session.daily_room_name,
        'daily_room_url', v_session.daily_room_url
      ),
      jsonb_build_object(
        'state', 'date',
        'phase', 'date',
        'date_started_at', v_date_started_at,
        'reason', 'confirmed_encounter_early_promotion'
      ),
      true,
      gen_random_uuid()
    );

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'confirmed_encounter_promoted_to_date',
      NULL,
      v_session.event_id,
      v_effective_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_entry',
        'source', p_source,
        'p_reason', p_reason,
        'previous_entry_started_at', v_previous_entry_started_at,
        'date_started_at', v_session.date_started_at,
        'first_confirmed_encounter_at', NULLIF(v_first_confirmed_encounter_at, '-infinity'::timestamptz),
        'participant_1_joined_at', v_session.participant_1_joined_at,
        'participant_2_joined_at', v_session.participant_2_joined_at,
        'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
        'participant_1_away_at', v_session.participant_1_away_at,
        'participant_2_away_at', v_session.participant_2_away_at,
        'daily_room_name', v_session.daily_room_name,
        'daily_room_url', v_session.daily_room_url,
        'event_result', v_event
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', true,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'confirmed_encounter_early_promotion',
      'confirmed_encounter', true,
      'active_confirmed_encounter', true,
      'event_result', v_event,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared(p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_already_entry boolean := false;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.ended_at IS NOT NULL THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  v_already_entry := (
    v_session.entry_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
    OR v_session.daily_room_name IS NOT NULL
    OR v_session.daily_room_url IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
    OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('entry', 'date')
  );

  IF NOT v_already_entry THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NOT NULL THEN
      v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'confirm_prepare_entry_event_inactive',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'entry_attempt_id', p_entry_attempt_id,
          'inactive_reason', v_inactive_reason,
          'cleanup', v_cleanup
        )
      );

      RETURN jsonb_build_object(
        'success', false,
        'error', 'Event is no longer active',
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'EVENT_NOT_ACTIVE',
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'state', COALESCE(v_session.state::text, 'ended'),
        'phase', COALESCE(v_session.phase, 'ended'),
        'event_id', v_session.event_id,
        'participant_1_id', v_session.participant_1_id,
        'participant_2_id', v_session.participant_2_id,
        'entry_started_at', v_session.entry_started_at,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'terminal', v_session.ended_at IS NOT NULL
      );
    END IF;
  END IF;

  RETURN public.confirm_vde_event_inactive_base_v1(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_seed_video_session_vibe_questions(p_session_id uuid, p_questions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();

  v_result jsonb;

  v_message text;

  v_detail text;

  v_hint text;

  v_server_now_ms bigint;
  v_uid uuid := auth.uid();

  v_row record;

  v_questions jsonb := '[]'::jsonb;

  v_question_count integer := 0;

  v_question_index integer := 0;

  v_question_anchor_at timestamptz := NULL;

  v_now timestamptz := now();
BEGIN
  -- (fold of *_20260607155414_lifecycle_base + vd_vibe_q_outer_20260605170249_base)
  <<questions>>
  BEGIN
    IF v_uid IS NULL THEN
      v_result := jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'questions', '[]'::jsonb);
      EXIT questions;
    END IF;

    SELECT id, participant_1_id, participant_2_id, vibe_questions, vibe_question_index, vibe_question_anchor_at
    INTO v_row
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'questions', '[]'::jsonb);
      EXIT questions;
    END IF;

    IF v_uid IS DISTINCT FROM v_row.participant_1_id
       AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
      v_result := jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'questions', '[]'::jsonb);
      EXIT questions;
    END IF;

    IF jsonb_typeof(v_row.vibe_questions) = 'array'
       AND jsonb_array_length(v_row.vibe_questions) > 0 THEN
      v_questions := v_row.vibe_questions;
      v_question_count := jsonb_array_length(v_questions);
      v_question_index := mod(mod(COALESCE(v_row.vibe_question_index, 0), v_question_count) + v_question_count, v_question_count);
      v_question_anchor_at := COALESCE(v_row.vibe_question_anchor_at, v_now);

      IF v_row.vibe_question_index IS DISTINCT FROM v_question_index
         OR v_row.vibe_question_anchor_at IS NULL THEN
        UPDATE public.video_sessions
        SET vibe_question_index = v_question_index,
            vibe_question_anchor_at = v_question_anchor_at
        WHERE id = p_session_id
        RETURNING vibe_questions, vibe_question_index, vibe_question_anchor_at
        INTO v_questions, v_question_index, v_question_anchor_at;
      END IF;

      v_result := jsonb_build_object(
        'success', true,
        'seeded', false,
        'questions', v_questions,
        'question_index', v_question_index,
        'question_anchor_at', v_question_anchor_at
      );
      EXIT questions;
    END IF;

    IF jsonb_typeof(p_questions) = 'array' THEN
      SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_questions
      FROM (
        SELECT value
        FROM jsonb_array_elements(p_questions) AS q(value)
        WHERE jsonb_typeof(value) = 'string'
          AND length(btrim(value #>> '{}')) BETWEEN 1 AND 240
        LIMIT 8
      ) limited;
    END IF;

    IF jsonb_array_length(v_questions) = 0 THEN
      v_result := jsonb_build_object('success', false, 'code', 'INVALID_QUESTIONS', 'questions', '[]'::jsonb);
      EXIT questions;
    END IF;

    UPDATE public.video_sessions
    SET vibe_questions = v_questions,
        vibe_question_index = 0,
        vibe_question_anchor_at = v_now
    WHERE id = p_session_id
    RETURNING vibe_questions, vibe_question_index, vibe_question_anchor_at
    INTO v_questions, v_question_index, v_question_anchor_at;

    v_result := jsonb_build_object(
      'success', true,
      'seeded', true,
      'questions', v_questions,
      'question_index', v_question_index,
      'question_anchor_at', v_question_anchor_at
    );
    EXIT questions;  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;
      v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
      v_result := jsonb_build_object(
        'ok', false,
        'success', false,
        'seeded', false,
        'questions', '[]'::jsonb,
        'error', 'vibe_questions_seed_failed',
        'code', 'VIBE_QUESTIONS_SEED_FAILED',
        'error_code', 'VIBE_QUESTIONS_SEED_FAILED',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'detail', NULLIF(v_detail, ''),
        'hint', NULLIF(v_hint, ''),
        'retryable', true,
        'retry_after_ms', 1500,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      v_actor,
      'get_or_seed_video_session_vibe_questions',
      'vibe_questions_seed_failed',
      'VIBE_QUESTIONS_SEED_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    ) || jsonb_build_object('seeded', false, 'questions', '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(p_session_id uuid, p_checkpoint text, p_payload jsonb DEFAULT '{}'::jsonb, p_latency_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;

  v_result jsonb;

  v_message text;

  v_detail text;

  v_hint text;

  v_session public.video_sessions%ROWTYPE;

  v_checkpoint text := lower(btrim(COALESCE(p_checkpoint, '')));

  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object' THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;

  v_latency_ms integer;

  v_outcome text;

  v_extra jsonb;

  v_own_ready_at timestamptz;

  v_peer_ready_at timestamptz;

  v_ready_actor_order text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- (fold of vd_launch_latency_20260609130139_hot_base ->
  --  record_vd_launch_lat_20260609105249_active_base ->
  --  record_vd_launch_latency_20260603150106_start_base ->
  --  *_202605252340 -> *_202605220240 -> *_202605061020)
  BEGIN
    <<dispatch>>
    BEGIN
      IF v_checkpoint = 'swipe_result' THEN
        IF v_actor IS NULL THEN
          v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
          EXIT dispatch;
        END IF;

        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF NOT FOUND THEN
          v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
          EXIT dispatch;
        END IF;

        IF v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
          v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
          EXIT dispatch;
        END IF;

        v_latency_ms := COALESCE(
          public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
          CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
          public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
        );

        v_outcome := CASE
          WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
            THEN v_payload->>'outcome'
          ELSE 'success'
        END;

        v_detail := jsonb_strip_nulls(jsonb_build_object(
          'client_event_name', 'ready_gate_to_date_latency_checkpoint',
          'checkpoint', v_checkpoint,
          'platform', CASE
            WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
            ELSE NULL
          END,
          'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
          'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
          'outcome', v_outcome,
          'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
          'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
          'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
          'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
          'swipe_result_ms', public.video_date_launch_latency_safe_int(v_payload->>'swipe_result_ms', 0, 86400000),
          'observed_at', now()
        ));

        INSERT INTO public.event_loop_observability_events (
          operation,
          outcome,
          reason_code,
          latency_ms,
          event_id,
          actor_id,
          session_id,
          detail
        ) VALUES (
          'video_date_launch_latency_checkpoint',
          v_outcome,
          v_checkpoint,
          v_latency_ms,
          v_session.event_id,
          v_actor,
          p_session_id,
          v_detail
        );

        v_result := jsonb_build_object('ok', true, 'inserted', true);
        EXIT dispatch;
      END IF;

      BEGIN
        IF v_checkpoint IN (
          'daily_join_started',
          'daily_join_success',
          'daily_join_failure',
          'first_remote_frame'
        ) THEN
          IF v_actor IS NULL THEN
            v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
            EXIT dispatch;
          END IF;

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          IF NOT FOUND THEN
            v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
            EXIT dispatch;
          END IF;

          IF v_session.participant_1_id IS DISTINCT FROM v_actor
             AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
            v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
            EXIT dispatch;
          END IF;

          v_latency_ms := CASE
            WHEN v_checkpoint = 'first_remote_frame' THEN
              COALESCE(
                public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
              )
            WHEN v_checkpoint IN ('daily_join_success', 'daily_join_failure') THEN
              COALESCE(
                public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
              )
            ELSE
              COALESCE(
                CASE WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms)) ELSE NULL END,
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
              )
          END;

          v_outcome := CASE
            WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
              THEN v_payload->>'outcome'
            WHEN v_checkpoint LIKE '%failure' THEN 'failure'
            ELSE 'success'
          END;

          v_detail := jsonb_strip_nulls(jsonb_build_object(
            'client_event_name', 'ready_gate_to_date_latency_checkpoint',
            'checkpoint', v_checkpoint,
            'platform', CASE
              WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
              ELSE NULL
            END,
            'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
            'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
            'outcome', v_outcome,
            'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
            'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
            'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
            'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
            'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
            'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
            'daily_performance_segment', CASE
              WHEN v_checkpoint LIKE 'daily_join_%' THEN 'daily_join'
              WHEN v_checkpoint = 'first_remote_frame' THEN 'first_remote_frame'
              ELSE public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment')
            END,
            'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
            'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
            'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
            'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
            'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
            'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
            'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
            'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
            'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
            'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
            'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
            'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
            'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
            'observed_at', now()
          ));

          INSERT INTO public.event_loop_observability_events (
            operation,
            outcome,
            reason_code,
            latency_ms,
            event_id,
            actor_id,
            session_id,
            detail
          ) VALUES (
            'video_date_launch_latency_checkpoint',
            v_outcome,
            v_checkpoint,
            v_latency_ms,
            v_session.event_id,
            v_actor,
            p_session_id,
            v_detail
          );

          v_result := jsonb_build_object('ok', true, 'inserted', true);
          EXIT dispatch;
        END IF;

        BEGIN
          IF v_checkpoint IN (
            'daily_room_create_started',
            'daily_room_create_success',
            'daily_room_create_failure',
            'daily_token_mint_started',
            'daily_token_mint_success',
            'daily_token_mint_failure',
            'daily_reconnect_started',
            'daily_reconnect_success',
            'daily_reconnect_failure',
            'extension_refresh_started',
            'extension_refresh_success',
            'extension_refresh_failure'
          ) THEN
            IF v_actor IS NULL THEN
              v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
              EXIT dispatch;
            END IF;

            SELECT *
            INTO v_session
            FROM public.video_sessions
            WHERE id = p_session_id;

            IF NOT FOUND THEN
              v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
              EXIT dispatch;
            END IF;

            IF v_session.participant_1_id IS DISTINCT FROM v_actor
               AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
              v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
              EXIT dispatch;
            END IF;

            v_latency_ms := CASE
              WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
              WHEN v_checkpoint IN ('daily_room_create_success', 'daily_room_create_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('daily_token_mint_success', 'daily_token_mint_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('daily_reconnect_success', 'daily_reconnect_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              WHEN v_checkpoint IN ('extension_refresh_success', 'extension_refresh_failure') THEN
                COALESCE(
                  public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
                  public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
                )
              ELSE
                public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000)
            END;

            v_outcome := CASE
              WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
                THEN v_payload->>'outcome'
              WHEN v_checkpoint LIKE '%failure' THEN 'failure'
              ELSE 'success'
            END;

            v_detail := jsonb_strip_nulls(jsonb_build_object(
              'client_event_name', 'ready_gate_to_date_latency_checkpoint',
              'checkpoint', v_checkpoint,
              'platform', CASE
                WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
                ELSE NULL
              END,
              'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
              'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
              'outcome', v_outcome,
              'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
              'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
              'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
              'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
              'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
              'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
              'daily_performance_segment', public.video_date_launch_latency_safe_text(v_payload->>'daily_performance_segment'),
              'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
              'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
              'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
              'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000),
              'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
              'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
              'extension_mode', public.video_date_launch_latency_safe_text(v_payload->>'extension_mode'),
              'credit_type', public.video_date_launch_latency_safe_text(v_payload->>'credit_type'),
              'extension_mutual', public.video_date_launch_latency_safe_bool(v_payload->>'extension_mutual'),
              'extension_awaiting_partner', public.video_date_launch_latency_safe_bool(v_payload->>'extension_awaiting_partner'),
              'extension_applied', public.video_date_launch_latency_safe_bool(v_payload->>'extension_applied'),
              'reconnect_source', public.video_date_launch_latency_safe_text(v_payload->>'reconnect_source'),
              'observed_at', now()
            ));

            INSERT INTO public.event_loop_observability_events (
              operation,
              outcome,
              reason_code,
              latency_ms,
              event_id,
              actor_id,
              session_id,
              detail
            ) VALUES (
              'video_date_launch_latency_checkpoint',
              v_outcome,
              v_checkpoint,
              v_latency_ms,
              v_session.event_id,
              v_actor,
              p_session_id,
              v_detail
            );

            v_result := jsonb_build_object('ok', true, 'inserted', true);
            EXIT dispatch;
          END IF;

              <<leafblk>>
              BEGIN
                IF v_actor IS NULL THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'unauthorized');
                  EXIT leafblk;
                END IF;

                IF v_checkpoint NOT IN (
                  'ready_gate_impression',
                  'ready_tap',
                  'ready_gate_transition_started',
                  'ready_gate_transition_success',
                  'both_ready_observed',
                  'both_ready_observed_via_rpc_short_circuit',
                  'mutual_swipe_observed',
                  'room_pre_create_started',
                  'room_pre_create_success',
                  'room_pre_create_failure',
                  'room_warmup_started',
                  'room_warmup_success',
                  'room_warmup_failure',
                  'prepare_entry_started',
                  'prepare_entry_success',
                  'prepare_entry_failure',
                  'provider_verify_started',
                  'provider_verify_success',
                  'provider_verify_skipped',
                  'token_created',
                  'navigation_started',
                  'date_route_entered',
                  'date_route_module_preloaded',
                  'video_stage_shell_visible',
                  'permission_check_started',
                  'permission_check_success',
                  'permission_check_skipped',
                  'enter_handshake_started',
                  'enter_handshake_success',
                  'enter_handshake_failure',
                  'daily_token_started',
                  'daily_token_success',
                  'daily_token_failure',
                  'daily_join_started',
                  'daily_join_success',
                  'daily_join_failure',
                  'local_video_ready',
                  'remote_seen',
                  'first_remote_frame',
                  'remote_readable',
                  'warmup_timer_started',
                  'daily_prewarm_started',
                  'daily_prewarm_camera_ready',
                  'daily_prewarm_preauth_success',
                  'daily_prewarm_join_started',
                  'daily_prewarm_join_success',
                  'daily_prewarm_join_failure',
                  'daily_prewarm_solo_join_started',
                  'daily_prewarm_solo_join_success',
                  'daily_prewarm_solo_join_failure',
                  'daily_prewarm_consumed',
                  'daily_prewarm_fallback',
                  'daily_prewarm_destroyed',
                  'video_date_route_preload_started',
                  'video_date_route_preload_success'
                ) THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'unknown_checkpoint');
                  EXIT leafblk;
                END IF;

                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'session_not_found');
                  EXIT leafblk;
                END IF;

                IF v_session.participant_1_id IS DISTINCT FROM v_actor
                   AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'access_denied');
                  EXIT leafblk;
                END IF;

                IF v_session.participant_1_id = v_actor THEN
                  v_own_ready_at := v_session.ready_participant_1_at;
                  v_peer_ready_at := v_session.ready_participant_2_at;
                ELSE
                  v_own_ready_at := v_session.ready_participant_2_at;
                  v_peer_ready_at := v_session.ready_participant_1_at;
                END IF;

                v_ready_actor_order := CASE
                  WHEN v_own_ready_at IS NULL OR v_peer_ready_at IS NULL THEN NULL
                  WHEN v_own_ready_at <= v_peer_ready_at THEN 'first_ready'
                  ELSE 'second_ready'
                END;

                v_latency_ms := CASE
                  WHEN p_latency_ms IS NOT NULL THEN LEAST(86400000, GREATEST(0, p_latency_ms))
                  WHEN v_checkpoint = 'first_remote_frame' THEN
                    public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
                  WHEN v_checkpoint = 'room_pre_create_success' THEN
                    public.video_date_launch_latency_safe_int(v_payload->>'mutual_swipe_to_room_ready_ms', 0, 86400000)
                  WHEN v_checkpoint = 'date_route_module_preloaded' THEN
                    public.video_date_launch_latency_safe_int(v_payload->>'date_route_module_preload_ms', 0, 86400000)
                  ELSE COALESCE(
                    public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
                    public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000)
                  )
                END;

                v_outcome := CASE
                  WHEN v_payload->>'outcome' IN ('success', 'failure', 'blocked', 'no_op', 'timeout', 'recovered')
                    THEN v_payload->>'outcome'
                  WHEN v_checkpoint LIKE '%failure' THEN 'failure'
                  ELSE 'success'
                END;

                v_detail := jsonb_strip_nulls(jsonb_build_object(
                  'client_event_name', 'ready_gate_to_date_latency_checkpoint',
                  'checkpoint', v_checkpoint,
                  'platform', CASE
                    WHEN v_payload->>'platform' IN ('web', 'native') THEN v_payload->>'platform'
                    ELSE NULL
                  END,
                  'source_surface', public.video_date_launch_latency_safe_text(v_payload->>'source_surface'),
                  'source_action', public.video_date_launch_latency_safe_text(v_payload->>'source_action'),
                  'outcome', v_outcome,
                  'reason_code', public.video_date_launch_latency_safe_text(v_payload->>'reason_code'),
                  'latency_bucket', public.video_date_launch_latency_safe_text(v_payload->>'latency_bucket'),
                  'entry_attempt_id', public.video_date_launch_latency_safe_text(v_payload->>'entry_attempt_id'),
                  'video_date_trace_id', public.video_date_launch_latency_safe_text(v_payload->>'video_date_trace_id'),
                  'ready_actor_order', COALESCE(v_ready_actor_order, public.video_date_launch_latency_safe_text(v_payload->>'ready_actor_order')),
                  'attempt_count', public.video_date_launch_latency_safe_int(v_payload->>'attempt_count', 0, 100),
                  'duration_ms', public.video_date_launch_latency_safe_int(v_payload->>'duration_ms', 0, 86400000),
                  'ready_gate_open_to_ready_tap_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_gate_open_to_ready_tap_ms', 0, 86400000),
                  'ready_tap_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_both_ready_ms', 0, 86400000),
                  'ready_tap_to_prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_prepare_entry_ms', 0, 86400000),
                  'ready_tap_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_date_route_ms', 0, 86400000),
                  'ready_tap_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_daily_join_ms', 0, 86400000),
                  'ready_tap_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_remote_seen_ms', 0, 86400000),
                  'ready_tap_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'ready_tap_to_first_remote_frame_ms', 0, 86400000),
                  'mutual_swipe_to_room_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'mutual_swipe_to_room_ready_ms', 0, 86400000),
                  'human_wait_swipe_to_both_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'human_wait_swipe_to_both_ready_ms', 0, 86400000),
                  'system_latency_both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'system_latency_both_ready_to_first_remote_frame_ms', 0, 86400000),
                  'date_route_module_preload_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_module_preload_ms', 0, 86400000),
                  'both_ready_to_date_route_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_date_route_ms', 0, 86400000),
                  'both_ready_to_daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_token_ms', 0, 86400000),
                  'both_ready_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_daily_join_ms', 0, 86400000),
                  'both_ready_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_remote_seen_ms', 0, 86400000),
                  'both_ready_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_first_remote_frame_ms', 0, 86400000),
                  'both_ready_to_video_stage_shell_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_video_stage_shell_ms', 0, 86400000),
                  'both_ready_to_local_video_ready_ms', public.video_date_launch_latency_safe_int(v_payload->>'both_ready_to_local_video_ready_ms', 0, 86400000),
                  'date_route_bootstrap_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_bootstrap_ms', 0, 86400000),
                  'date_route_to_daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'date_route_to_daily_join_ms', 0, 86400000),
                  'daily_join_to_remote_seen_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_remote_seen_ms', 0, 86400000),
                  'daily_join_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_to_first_remote_frame_ms', 0, 86400000),
                  'remote_seen_to_first_remote_frame_ms', public.video_date_launch_latency_safe_int(v_payload->>'remote_seen_to_first_remote_frame_ms', 0, 86400000),
                  'first_remote_frame_to_readable_ms', public.video_date_launch_latency_safe_int(v_payload->>'first_remote_frame_to_readable_ms', 0, 86400000),
                  'daily_token_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_ms', 0, 86400000),
                  'daily_join_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_join_ms', 0, 86400000),
                  'room_warmup_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_warmup_ms', 0, 86400000),
                  'prepare_entry_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_entry_ms', 0, 86400000),
                  'provider_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'provider_verify_ms', 0, 86400000),
                  'permission_check_ms', public.video_date_launch_latency_safe_int(v_payload->>'permission_check_ms', 0, 86400000),
                  'cached_prepare_entry', public.video_date_launch_latency_safe_bool(v_payload->>'cached_prepare_entry'),
                  'provider_verify_skipped', public.video_date_launch_latency_safe_bool(v_payload->>'provider_verify_skipped'),
                  'permission_handoff_used', public.video_date_launch_latency_safe_bool(v_payload->>'permission_handoff_used'),
                  'eligible_pre_create_status', public.video_date_launch_latency_safe_text(v_payload->>'eligible_pre_create_status'),
                  'observed_at', now()
                ));

                INSERT INTO public.event_loop_observability_events (
                  operation,
                  outcome,
                  reason_code,
                  latency_ms,
                  event_id,
                  actor_id,
                  session_id,
                  detail
                ) VALUES (
                  'video_date_launch_latency_checkpoint',
                  v_outcome,
                  v_checkpoint,
                  v_latency_ms,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  v_detail
                );

                v_result := jsonb_build_object('ok', true, 'inserted', true);
                EXIT leafblk;
              EXCEPTION
                WHEN OTHERS THEN
                  v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
                  EXIT leafblk;      END;

          IF COALESCE((v_result->>'inserted')::boolean, false) AND v_actor IS NOT NULL THEN
            BEGIN
              v_extra := jsonb_strip_nulls(jsonb_build_object(
                'provider_verify_reason', public.video_date_launch_latency_safe_text(v_payload->>'provider_verify_reason'),
                'auth_ms', public.video_date_launch_latency_safe_int(v_payload->>'auth_ms', 0, 86400000),
                'prepare_rpc_ms', public.video_date_launch_latency_safe_int(v_payload->>'prepare_rpc_ms', 0, 86400000),
                'room_create_or_verify_ms', public.video_date_launch_latency_safe_int(v_payload->>'room_create_or_verify_ms', 0, 86400000),
                'token_ms', public.video_date_launch_latency_safe_int(v_payload->>'token_ms', 0, 86400000),
                'confirm_prepare_ms', public.video_date_launch_latency_safe_int(v_payload->>'confirm_prepare_ms', 0, 86400000),
                'edge_total_ms', public.video_date_launch_latency_safe_int(v_payload->>'edge_total_ms', 0, 86400000),
                'daily_room_create_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_room_create_ms', 0, 86400000),
                'daily_token_mint_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_token_mint_ms', 0, 86400000),
                'daily_reconnect_ms', public.video_date_launch_latency_safe_int(v_payload->>'daily_reconnect_ms', 0, 86400000),
                'extension_refresh_ms', public.video_date_launch_latency_safe_int(v_payload->>'extension_refresh_ms', 0, 86400000)
              ));

              IF v_extra <> '{}'::jsonb THEN
                UPDATE public.event_loop_observability_events
                SET detail = detail || v_extra
                WHERE id = (
                  SELECT id
                  FROM public.event_loop_observability_events
                  WHERE operation = 'video_date_launch_latency_checkpoint'
                    AND actor_id = v_actor
                    AND session_id = p_session_id
                    AND reason_code = v_checkpoint
                  ORDER BY created_at DESC
                  LIMIT 1
                );
              END IF;
            EXCEPTION
              WHEN OTHERS THEN
                v_result := v_result;
                EXIT dispatch;
            END;
          END IF;

          v_result := v_result;
          EXIT dispatch;  EXCEPTION
          WHEN OTHERS THEN
            v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
        END;
        EXIT dispatch;
      EXCEPTION
        WHEN OTHERS THEN
          v_result := jsonb_build_object('ok', false, 'error', 'insert_failed');
      END;
      EXIT dispatch;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        PERFORM public.video_date_lifecycle_observe_exception_v2(
          p_session_id,
          v_actor,
          'record_video_date_launch_latency_checkpoint.hot_path_shell',
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'rpc', 'record_video_date_launch_latency_checkpoint',
        'checkpoint', lower(btrim(COALESCE(p_checkpoint, ''))),
        'error', 'launch_latency_checkpoint_failed',
        'reason', 'launch_latency_checkpoint_failed',
        'code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
        'error_code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
        'retryable', true,
        'terminal', false,
        'hot_path_no_throw_shell', true,
        'active_entry_failsoft_shell', true,
        'last_resort_payload', true,
        'sqlstate', SQLSTATE,
        'sql_message', left(COALESCE(v_message, ''), 500)
      );
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'hot_path_no_throw_shell', true,
    'active_entry_failsoft_shell', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'record_video_date_launch_latency_checkpoint',
      'checkpoint', lower(btrim(COALESCE(p_checkpoint, ''))),
      'error', 'launch_latency_checkpoint_failed',
      'reason', 'launch_latency_checkpoint_failed',
      'code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'error_code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'retryable', true,
      'terminal', false,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'sqlstate', SQLSTATE,
      'sql_message', left(COALESCE(v_message, ''), 500)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_daily_webhook_terminal_truth_base(p_provider_event_id text, p_event_type text, p_room_name text DEFAULT NULL::text, p_provider_participant_id text DEFAULT NULL::text, p_provider_user_id text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT now(), p_payload jsonb DEFAULT '{}'::jsonb, p_signature_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_base jsonb;

  v_room_name text := NULLIF(left(btrim(COALESCE(p_room_name, '')), 180), '');

  v_event_kind text := replace(replace(lower(btrim(COALESCE(p_event_type, ''))), '_', '.'), '-', '.');

  v_session_id uuid;

  v_reconcile jsonb := NULL;

  v_provider_user_id text := NULLIF(left(btrim(COALESCE(p_provider_user_id, '')), 180), '');

  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());

  v_now timestamptz := clock_timestamp();

  v_session public.video_sessions%ROWTYPE;

  v_actor uuid;

  v_actor_role text;

  v_rows_changed integer := 0;

  v_reconnect_grace_cleared boolean := false;

  v_join_proves_return boolean := false;
  v_provider_event_id text := btrim(COALESCE(p_provider_event_id, ''));

  v_event_type text := lower(btrim(COALESCE(p_event_type, '')));

  v_provider_participant_id text := NULLIF(left(btrim(COALESCE(p_provider_participant_id, '')), 180), '');

  v_payload jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(p_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;

  v_ledger_id bigint;

  v_existing public.video_date_daily_webhook_events%ROWTYPE;

  v_webhooks_enabled boolean := false;

  v_result text := 'ignored_unsupported_event';

  v_state text := 'ignored';
BEGIN
  -- (fold of *_20260604193140_latest_presence_base + *_20260603215948_handoff_base)
  <<ledger>>
  BEGIN
    v_session_id := public.video_date_uuid_from_daily_room_name_v1(p_room_name);
    IF v_session_id IS NOT NULL THEN
      PERFORM public.video_date_restore_canonical_room_metadata_v1(
        v_session_id,
        'daily_webhook_room_name_restore'
      );
    END IF;

    IF v_provider_event_id = ''
       OR length(v_provider_event_id) > 500
       OR v_event_type = ''
       OR length(v_event_type) > 120 THEN
      v_base := jsonb_build_object('ok', false, 'error', 'invalid_webhook_event');
      EXIT ledger;
    END IF;

    IF public.video_date_jsonb_has_secret_key(v_payload) THEN
      v_base := jsonb_build_object('ok', false, 'error', 'secret_payload_rejected');
      EXIT ledger;
    END IF;

    INSERT INTO public.video_date_daily_webhook_events (
      provider_event_id,
      event_type,
      room_name,
      provider_participant_id,
      provider_user_id,
      occurred_at,
      signature_timestamp,
      payload
    )
    VALUES (
      v_provider_event_id,
      v_event_type,
      v_room_name,
      v_provider_participant_id,
      v_provider_user_id,
      v_occurred_at,
      p_signature_timestamp,
      v_payload
    )
    ON CONFLICT (provider_event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NULL THEN
      SELECT *
      INTO v_existing
      FROM public.video_date_daily_webhook_events
      WHERE provider_event_id = v_provider_event_id;

      v_base := jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'eventId', v_existing.id,
        'processingState', v_existing.processing_state,
        'processingResult', v_existing.processing_result,
        'sessionId', v_existing.session_id
      );
      EXIT ledger;
    END IF;

    IF v_room_name IS NULL THEN
      v_result := 'ignored_room_missing';
      UPDATE public.video_date_daily_webhook_events
      SET processing_state = v_state,
          processing_result = v_result,
          processed_at = now()
      WHERE id = v_ledger_id;

      v_base := jsonb_build_object('ok', true, 'duplicate', false, 'state', v_state, 'result', v_result);
      EXIT ledger;
    END IF;

    SELECT vs.*
    INTO v_session
    FROM public.video_sessions vs
    WHERE vs.id = (
      SELECT latest.id
      FROM public.video_sessions latest
      WHERE latest.daily_room_name = v_room_name
      ORDER BY latest.started_at DESC
      LIMIT 1
    )
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := 'ignored_session_not_found';
      UPDATE public.video_date_daily_webhook_events
      SET processing_state = v_state,
          processing_result = v_result,
          processed_at = now()
      WHERE id = v_ledger_id;

      v_base := jsonb_build_object('ok', true, 'duplicate', false, 'state', v_state, 'result', v_result);
      EXIT ledger;
    END IF;

    IF v_provider_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_actor := v_provider_user_id::uuid;
    END IF;

    IF v_actor IS NOT NULL AND v_actor = v_session.participant_1_id THEN
      v_actor_role := 'participant_1';
    ELSIF v_actor IS NOT NULL AND v_actor = v_session.participant_2_id THEN
      v_actor_role := 'participant_2';
    END IF;

    IF v_actor_role IS NOT NULL THEN
      v_webhooks_enabled := COALESCE(
        public.evaluate_client_feature_flag('video_date.daily_webhooks_v2', v_actor),
        false
      );
    END IF;

    v_event_kind := replace(replace(v_event_type, '_', '.'), '-', '.');

    IF v_session.ended_at IS NOT NULL OR v_session.state = 'ended' OR v_session.phase = 'ended' THEN
      v_result := 'ignored_terminal_session';
    ELSIF v_event_kind IN ('participant.joined', 'participant.join') THEN
      IF v_actor_role IS NULL THEN
        v_result := 'ignored_participant_not_matched';
      ELSIF NOT v_webhooks_enabled THEN
        v_result := 'ignored_feature_disabled';
      ELSIF v_actor_role = 'participant_1' THEN
        UPDATE public.video_sessions
        SET participant_1_joined_at = COALESCE(participant_1_joined_at, v_occurred_at),
            participant_1_away_at = NULL
        WHERE id = v_session.id
          AND (participant_1_joined_at IS NULL OR participant_1_away_at IS NOT NULL);
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        v_state := 'processed';
        v_result := 'participant_1_join_reconciled';
      ELSIF v_actor_role = 'participant_2' THEN
        UPDATE public.video_sessions
        SET participant_2_joined_at = COALESCE(participant_2_joined_at, v_occurred_at),
            participant_2_away_at = NULL
        WHERE id = v_session.id
          AND (participant_2_joined_at IS NULL OR participant_2_away_at IS NOT NULL);
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        v_state := 'processed';
        v_result := 'participant_2_join_reconciled';
      END IF;
    ELSIF v_event_kind IN ('participant.left', 'participant.leave') THEN
      IF v_actor_role IS NULL THEN
        v_result := 'ignored_participant_not_matched';
      ELSIF NOT v_webhooks_enabled THEN
        v_result := 'ignored_feature_disabled';
      ELSIF v_actor_role = 'participant_1' THEN
        UPDATE public.video_sessions
        SET participant_1_away_at = v_occurred_at
        WHERE id = v_session.id
          AND participant_1_away_at IS DISTINCT FROM v_occurred_at;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        v_state := 'processed';
        v_result := 'participant_1_left_reconciled';
      ELSIF v_actor_role = 'participant_2' THEN
        UPDATE public.video_sessions
        SET participant_2_away_at = v_occurred_at
        WHERE id = v_session.id
          AND participant_2_away_at IS DISTINCT FROM v_occurred_at;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        v_state := 'processed';
        v_result := 'participant_2_left_reconciled';
      END IF;
    END IF;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(v_session.id);
    END IF;

    PERFORM public.append_video_session_event_v2(
      v_session.id,
      'daily_webhook_reconciled',
      'internal',
      v_actor,
      jsonb_build_object(
        'providerEventId', v_provider_event_id,
        'eventType', v_event_type,
        'roomName', v_room_name,
        'providerParticipantId', v_provider_participant_id,
        'providerUserId', v_provider_user_id,
        'actorRole', v_actor_role,
        'result', v_result
      ),
      jsonb_build_object(
        'eventType', v_event_type,
        'actorRole', v_actor_role,
        'result', v_result
      ),
      false,
      gen_random_uuid()
    );

    UPDATE public.video_date_daily_webhook_events
    SET session_id = v_session.id,
        processing_state = v_state,
        processing_result = v_result,
        processed_at = now()
    WHERE id = v_ledger_id;

    v_base := jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'state', v_state,
      'result', v_result,
      'sessionId', v_session.id,
      'actorRole', v_actor_role,
      'rowsChanged', v_rows_changed
    );
    EXIT ledger;  END;

  -- (fold of record_vd_daily_webhook_v2_202606071031_base) latest-presence repair
  <<presence>>
  BEGIN

    IF COALESCE(v_base->>'state', '') <> 'processed'
       OR v_room_name IS NULL
       OR v_provider_user_id IS NULL
       OR v_event_kind NOT IN ('participant.joined', 'participant.join', 'participant.left', 'participant.leave') THEN
      v_base := v_base;
      EXIT presence;
    END IF;

    IF v_provider_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_actor := v_provider_user_id::uuid;
    END IF;

    SELECT vs.*
    INTO v_session
    FROM public.video_sessions vs
    WHERE vs.daily_room_name = v_room_name
    ORDER BY vs.started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_actor IS NULL OR v_session.ended_at IS NOT NULL THEN
      v_base := v_base;
      EXIT presence;
    END IF;

    IF v_actor = v_session.participant_1_id THEN
      v_actor_role := 'participant_1';
    ELSIF v_actor = v_session.participant_2_id THEN
      v_actor_role := 'participant_2';
    ELSE
      v_base := v_base;
      EXIT presence;
    END IF;

    IF v_event_kind IN ('participant.joined', 'participant.join') THEN
      IF v_actor_role = 'participant_1' THEN
        v_join_proves_return := v_session.participant_1_away_at IS NULL OR v_session.participant_1_away_at <= v_occurred_at;
        v_reconnect_grace_cleared := v_join_proves_return AND v_session.reconnect_grace_ends_at IS NOT NULL;
        UPDATE public.video_sessions
        SET
          participant_1_joined_at = GREATEST(COALESCE(participant_1_joined_at, v_occurred_at), v_occurred_at),
          participant_1_away_at = CASE WHEN v_join_proves_return THEN NULL ELSE participant_1_away_at END,
          reconnect_grace_ends_at = CASE WHEN v_join_proves_return THEN NULL ELSE reconnect_grace_ends_at END,
          state_updated_at = v_now
        WHERE id = v_session.id;
      ELSE
        v_join_proves_return := v_session.participant_2_away_at IS NULL OR v_session.participant_2_away_at <= v_occurred_at;
        v_reconnect_grace_cleared := v_join_proves_return AND v_session.reconnect_grace_ends_at IS NOT NULL;
        UPDATE public.video_sessions
        SET
          participant_2_joined_at = GREATEST(COALESCE(participant_2_joined_at, v_occurred_at), v_occurred_at),
          participant_2_away_at = CASE WHEN v_join_proves_return THEN NULL ELSE participant_2_away_at END,
          reconnect_grace_ends_at = CASE WHEN v_join_proves_return THEN NULL ELSE reconnect_grace_ends_at END,
          state_updated_at = v_now
        WHERE id = v_session.id;
      END IF;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
    ELSE
      IF v_actor_role = 'participant_1' THEN
        UPDATE public.video_sessions
        SET
          participant_1_away_at = v_occurred_at,
          state_updated_at = v_now
        WHERE id = v_session.id
          AND (participant_1_joined_at IS NULL OR v_occurred_at >= participant_1_joined_at)
          AND participant_1_away_at IS DISTINCT FROM v_occurred_at;
      ELSE
        UPDATE public.video_sessions
        SET
          participant_2_away_at = v_occurred_at,
          state_updated_at = v_now
        WHERE id = v_session.id
          AND (participant_2_joined_at IS NULL OR v_occurred_at >= participant_2_joined_at)
          AND participant_2_away_at IS DISTINCT FROM v_occurred_at;
      END IF;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
    END IF;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(v_session.id);
    END IF;

    IF v_reconnect_grace_cleared THEN
      PERFORM public.record_event_loop_observability(
        'daily_webhook_reconciler',
        'success',
        'reconnect_grace_cleared_by_provider_join',
        NULL,
        v_session.event_id,
        v_actor,
        v_session.id,
        jsonb_build_object(
          'event_type', p_event_type,
          'room_name', v_room_name,
          'provider_user_id', v_provider_user_id,
          'actor_role', v_actor_role,
          'latest_joined_at', v_occurred_at,
          'reconnect_grace_cleared', true
        )
      );
    END IF;

    v_base := v_base || jsonb_build_object(
      'latestPresenceRepaired', v_rows_changed > 0,
      'latest_joined_at', CASE WHEN v_event_kind IN ('participant.joined', 'participant.join') THEN v_occurred_at ELSE NULL END,
      'reconnect_grace_cleared', v_reconnect_grace_cleared
    );
    EXIT presence;  END;

  -- (fold of the dated webhook generations; see ledger/presence blocks)

  IF COALESCE(v_base->>'state', '') = 'processed'
     AND v_room_name IS NOT NULL
     AND v_event_kind IN ('participant.joined', 'participant.join', 'participant.left', 'participant.leave') THEN
    SELECT vs.id
    INTO v_session_id
    FROM public.video_sessions vs
    WHERE vs.daily_room_name = v_room_name
    ORDER BY vs.started_at DESC
    LIMIT 1;

    IF v_session_id IS NOT NULL THEN
      v_reconcile := public.video_date_reconcile_provider_absence_v1(
        v_session_id,
        'daily_webhook_' || v_event_kind
      );
    END IF;
  END IF;

  RETURN v_base || jsonb_strip_nulls(jsonb_build_object(
    'provider_absence_reconciliation', v_reconcile
  ));END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_video_date_safety_report_v2(p_session_id uuid, p_reason text, p_details text DEFAULT NULL::text, p_also_block boolean DEFAULT false, p_end_session boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();

  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');

  v_result jsonb;

  v_session public.video_sessions%ROWTYPE;

  v_after public.video_sessions%ROWTYPE;

  v_target uuid;

  v_reason text := lower(btrim(COALESCE(p_reason, '')));

  v_details text := NULLIF(left(btrim(COALESCE(p_details, '')), 4000), '');

  v_details_hash text;

  v_recent int;

  v_report_id uuid;

  v_block_result jsonb;

  v_transition jsonb := '{}'::jsonb;

  v_begin jsonb;

  v_command_id bigint;

  v_request jsonb;

  v_success boolean := true;

  v_delete_room_name text;

  v_was_ended boolean := false;

  v_ended boolean := false;

  v_survey_required boolean := false;
BEGIN
  -- (fold of *_20260522011000_error_base)
  <<report>>
  BEGIN
    IF v_actor IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_authenticated');
      EXIT report;
    END IF;

    IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_idempotency_key');
      EXIT report;
    END IF;

    IF v_reason NOT IN ('harassment', 'fake', 'inappropriate', 'spam', 'safety', 'underage', 'other') THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid_reason');
      EXIT report;
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
      EXIT report;
    END IF;

    IF v_actor IS DISTINCT FROM v_session.participant_1_id
       AND v_actor IS DISTINCT FROM v_session.participant_2_id THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_participant');
      EXIT report;
    END IF;

    v_target := CASE
      WHEN v_session.participant_1_id = v_actor THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END;
    v_was_ended := COALESCE(
      v_session.ended_at IS NOT NULL
        OR v_session.state::text = 'ended'
        OR v_session.phase = 'ended',
      false
    );
    v_details_hash := CASE WHEN v_details IS NULL THEN NULL ELSE md5(v_details) END;

    v_request := jsonb_build_object(
      'reason', v_reason,
      'has_details', v_details IS NOT NULL,
      'details_hash', v_details_hash,
      'also_block', COALESCE(p_also_block, false),
      'end_session', COALESCE(p_end_session, false),
      'reported_id', v_target
    );

    v_begin := public.video_session_command_begin_v2(
      p_session_id,
      v_actor,
      'safety_report',
      v_key,
      v_request,
      NULL
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
        'commandStatus', v_begin->>'status',
        'requestHash', v_begin->>'requestHash'
      );
      EXIT report;
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      v_result := COALESCE(v_begin->'result', '{}'::jsonb)
        || jsonb_build_object(
          'idempotent', true,
          'requestHash', v_begin->>'requestHash',
          'commandStatus', v_begin->>'status'
        );
      EXIT report;
    END IF;

    IF v_begin->>'status' = 'in_progress' THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'command_in_progress',
        'commandStatus', 'in_progress',
        'requestHash', v_begin->>'requestHash'
      );
      EXIT report;
    END IF;

    v_command_id := (v_begin->>'commandId')::bigint;

    SELECT count(*)::int
    INTO v_recent
    FROM public.user_reports
    WHERE reporter_id = v_actor
      AND created_at > now() - interval '1 hour';

    IF v_recent >= 20 THEN
      v_result := jsonb_build_object('success', false, 'error', 'rate_limited');
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      v_result := v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
      EXIT report;
    END IF;

    INSERT INTO public.user_reports (
      reporter_id,
      reported_id,
      reason,
      details,
      also_blocked
    )
    VALUES (
      v_actor,
      v_target,
      v_reason,
      v_details,
      COALESCE(p_also_block, false)
    )
    RETURNING id INTO v_report_id;

    PERFORM public.record_event_profile_impression_v2(
      v_session.event_id,
      v_actor,
      v_target,
      'reported',
      'video_date_safety_v2',
      p_session_id,
      jsonb_build_object('report_id', v_report_id)
    );

    PERFORM public.append_video_session_event_v2(
      p_session_id,
      'video_date_safety_report_recorded',
      'safety_review',
      v_actor,
      jsonb_build_object(
        'report_id', v_report_id,
        'reporter_id', v_actor,
        'reported_id', v_target,
        'reason', v_reason,
        'has_details', v_details IS NOT NULL,
        'details_hash', v_details_hash,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      jsonb_build_object(
        'report_recorded', true,
        'report_id', v_report_id,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      false,
      gen_random_uuid()
    );

    PERFORM public.append_video_session_event_v2(
      p_session_id,
      'video_date_safety_report_submitted',
      'actor_only',
      v_actor,
      jsonb_build_object(
        'report_id', v_report_id,
        'reported_id', v_target,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      jsonb_build_object(
        'report_recorded', true,
        'report_id', v_report_id,
        'also_block', COALESCE(p_also_block, false),
        'end_session', COALESCE(p_end_session, false)
      ),
      false,
      gen_random_uuid()
    );

    IF COALESCE(p_also_block, false) THEN
      PERFORM public.record_event_profile_impression_v2(
        v_session.event_id,
        v_actor,
        v_target,
        'blocked',
        'video_date_safety_v2',
        p_session_id,
        jsonb_build_object('report_id', v_report_id)
      );

      v_block_result := public.block_user_with_cleanup(
        v_target,
        'Reported during video date',
        NULL
      );
    ELSIF COALESCE(p_end_session, false) AND v_session.ended_at IS NULL THEN
      v_transition := public.video_date_transition(p_session_id, 'end', 'ended_from_client');
      IF COALESCE((v_transition->>'success')::boolean, false) IS FALSE THEN
        v_success := false;
      END IF;
    END IF;

    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_ended := COALESCE(v_after.ended_at IS NOT NULL OR v_after.state::text = 'ended' OR v_after.phase = 'ended', false);
    v_survey_required := COALESCE((v_transition->>'survey_required')::boolean, false);
    IF NOT v_survey_required
       AND COALESCE(p_end_session, false)
       AND NOT COALESCE(p_also_block, false)
       AND v_ended THEN
      v_survey_required := public.video_date_session_is_post_date_survey_eligible(
        v_after.ended_at,
        v_after.ended_reason,
        v_after.date_started_at,
        v_after.state::text,
        v_after.phase,
        v_after.participant_1_joined_at,
        v_after.participant_2_joined_at
      );

      IF v_survey_required THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_after.participant_1_id THEN v_after.participant_2_id
            ELSE v_after.participant_1_id
          END,
          last_active_at = now()
        WHERE event_id = v_after.event_id
          AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id);
      END IF;
    END IF;
    v_delete_room_name := COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_session.daily_room_name, ''));

    IF (COALESCE(p_end_session, false) OR COALESCE(p_also_block, false))
       AND v_ended
       AND NOT v_was_ended THEN
      PERFORM public.append_video_session_event_v2(
        p_session_id,
        'video_date_ended',
        'participants',
        v_actor,
        jsonb_build_object(
          'source', 'participant_end',
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        jsonb_build_object(
          'source', 'participant_end',
          'state', v_after.state::text,
          'phase', v_after.phase
        ),
        true,
        gen_random_uuid()
      );

      IF v_delete_room_name IS NOT NULL THEN
        PERFORM public.video_date_outbox_enqueue_v2(
          p_session_id,
          'daily.delete_video_date_room',
          jsonb_build_object(
            'roomName', v_delete_room_name,
            'sessionId', p_session_id::text,
            'source', 'submit_video_date_safety_report_v2'
          ),
          'phase3:safety_delete_room:' || p_session_id::text,
          now()
        );
      END IF;
    END IF;

    v_result := jsonb_build_object(
      'success', v_success,
      'safety_report_recorded', true,
      'report_id', v_report_id,
      'reported_id', v_target,
      'also_blocked', COALESCE(p_also_block, false),
      'ended', v_ended,
      'survey_required', v_survey_required,
      'state', v_after.state::text,
      'phase', v_after.phase,
      'ended_at', v_after.ended_at,
      'block', v_block_result
    );

    PERFORM public.video_session_command_finish_v2(
      v_command_id,
      v_actor,
      CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'idempotent', false,
      'requestHash', v_begin->>'requestHash',
      'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END
    );
    EXIT report;  END;

  IF COALESCE((v_result->>'success')::boolean, false) IS FALSE
     AND NOT (v_result ? 'error') THEN
    v_result := v_result || jsonb_build_object('error', 'safety_end_transition_rejected');

    IF v_actor IS NOT NULL AND v_key IS NOT NULL THEN
      UPDATE public.video_session_commands
      SET result_payload = COALESCE(result_payload, '{}'::jsonb)
        || jsonb_build_object('error', 'safety_end_transition_rejected')
      WHERE actor = v_actor
        AND idempotency_key = v_key
        AND session_id = p_session_id
        AND command_kind = 'safety_report'
        AND status = 'rejected'
        AND NOT (COALESCE(result_payload, '{}'::jsonb) ? 'error');
    END IF;
  END IF;

  RETURN v_result;END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_outbox_enqueue_v2(p_session_id uuid, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_dedupe_key text DEFAULT NULL::text, p_next_attempt_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- (fold of *_20260607103000_failsoft_base)
  DECLARE
    v_kind text := lower(btrim(COALESCE(p_kind, '')));
    v_payload jsonb := CASE
      WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) = 'object'
        THEN COALESCE(p_payload, '{}'::jsonb)
      ELSE '{}'::jsonb
    END;
    v_dedupe text := NULLIF(left(btrim(COALESCE(p_dedupe_key, '')), 160), '');
    v_existing public.video_date_provider_outbox%ROWTYPE;
    v_outbox_id bigint;
  BEGIN
    IF length(v_kind) < 2 OR length(v_kind) > 120 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_outbox_kind');
    END IF;

    IF v_dedupe IS NOT NULL THEN
      -- The partial unique index cannot protect NULL session_id rows because
      -- Postgres treats NULLs as distinct. Serialize every dedupe scope first.
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'video_date_outbox_v2:' ||
        COALESCE(p_session_id::text, 'global') || ':' ||
        v_kind || ':' ||
        v_dedupe,
        0
      ));

      SELECT *
      INTO v_existing
      FROM public.video_date_provider_outbox
      WHERE session_id IS NOT DISTINCT FROM p_session_id
        AND kind = v_kind
        AND dedupe_key = v_dedupe
        AND state IN ('pending', 'claimed', 'done')
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.video_date_provider_outbox
        SET
          next_attempt_at = LEAST(next_attempt_at, COALESCE(p_next_attempt_at, now())),
          updated_at = now()
        WHERE id = v_existing.id
        RETURNING id INTO v_outbox_id;

        RETURN jsonb_build_object(
          'ok', true,
          'deduped', true,
          'outboxId', v_outbox_id,
          'state', v_existing.state
        );
      END IF;
    END IF;

    INSERT INTO public.video_date_provider_outbox (
      session_id,
      kind,
      payload,
      dedupe_key,
      next_attempt_at,
      state
    )
    VALUES (
      p_session_id,
      v_kind,
      v_payload,
      v_dedupe,
      COALESCE(p_next_attempt_at, now()),
      'pending'
    )
    RETURNING id INTO v_outbox_id;

    RETURN jsonb_build_object('ok', true, 'deduped', false, 'outboxId', v_outbox_id);  END;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'outbox_enqueue_failed',
      'code', 'OUTBOX_ENQUEUE_FAILED',
      'kind', p_kind,
      'session_id', p_session_id,
      'dedupe_key', p_dedupe_key,
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', SQLSTATE IS DISTINCT FROM '42501',
      'auxiliary', true
    );END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_extend_date_v2(p_session_id uuid, p_credit_type text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
  v_add_seconds integer;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_request jsonb;
  v_canonical_hash text;
  v_hash text;
  v_command public.video_session_commands%ROWTYPE;
  v_session public.video_sessions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  v_add_seconds := CASE v_credit_type
    WHEN 'extra_time' THEN 120
    WHEN 'extended_vibe' THEN 300
    ELSE NULL
  END;

  IF v_add_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_credit_type');
  END IF;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_idempotency_key');
  END IF;

  v_request := jsonb_build_object(
    'action', 'extension',
    'credit_type', v_credit_type
  );
  v_canonical_hash := public.video_date_command_request_hash_v2(
    p_session_id,
    'extension',
    v_request
  );
  v_hash := COALESCE(NULLIF(btrim(p_request_hash), ''), v_canonical_hash);

  SELECT *
  INTO v_command
  FROM public.video_session_commands
  WHERE actor = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.session_id IS DISTINCT FROM p_session_id
       OR v_command.command_kind IS DISTINCT FROM 'extension'
       OR v_command.request_hash IS DISTINCT FROM v_hash
       OR v_command.request_payload IS DISTINCT FROM v_request THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'idempotency_conflict',
        'status', 'idempotency_conflict',
        'commandStatus', 'idempotency_conflict',
        'commandId', v_command.id,
        'existingSessionId', v_command.session_id,
        'existingCommandKind', v_command.command_kind,
        'existingRequestHash', v_command.request_hash
      );
    END IF;

    IF v_command.status IN ('committed', 'rejected') THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      RETURN COALESCE(v_command.result_payload, '{}'::jsonb) || jsonb_build_object(
        'commandStatus', CASE WHEN v_command.status = 'committed' THEN 'replay' ELSE 'replay_rejected' END,
        'commandId', v_command.id,
        'requestHash', v_command.request_hash,
        'date_extra_seconds', COALESCE(v_session.date_extra_seconds, (COALESCE(v_command.result_payload, '{}'::jsonb)->>'date_extra_seconds')::integer),
        'session_seq', COALESCE(v_session.session_seq, (COALESCE(v_command.result_payload, '{}'::jsonb)->>'session_seq')::bigint)
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'retryable', true,
      'commandStatus', 'in_progress',
      'commandId', v_command.id,
      'requestHash', v_command.request_hash
    );
  END IF;

  -- (fold of *_20260522011000_replay_base)
  DECLARE
    v_actor uuid := auth.uid();
    v_credit_type text := lower(btrim(COALESCE(p_credit_type, '')));
    v_add_seconds integer;
    v_key text;
    v_request jsonb;
    v_begin jsonb;
    v_command_id bigint;
    v_before public.video_sessions%ROWTYPE;
    v_after public.video_sessions%ROWTYPE;
    v_spend jsonb;
    v_success boolean := false;
    v_required_until timestamptz;
    v_event jsonb := '{}'::jsonb;
    v_result jsonb;
  BEGIN
    IF v_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    v_add_seconds := CASE v_credit_type
      WHEN 'extra_time' THEN 120
      WHEN 'extended_vibe' THEN 300
      ELSE NULL
    END;

    IF v_add_seconds IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_credit_type');
    END IF;

    v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');

    IF v_key IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'invalid_idempotency_key');
    END IF;

    SELECT *
    INTO v_before
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
    END IF;

    IF v_actor IS DISTINCT FROM v_before.participant_1_id
       AND v_actor IS DISTINCT FROM v_before.participant_2_id THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
    END IF;

    IF v_before.ended_at IS NOT NULL
       OR v_before.state::text = 'ended'
       OR v_before.phase = 'ended' THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_ended');
    END IF;

    IF v_before.date_started_at IS NULL
       OR (v_before.state::text IS DISTINCT FROM 'date' AND v_before.phase IS DISTINCT FROM 'date') THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_in_date_phase');
    END IF;

    v_required_until :=
      v_before.date_started_at
      + ((300 + COALESCE(v_before.date_extra_seconds, 0) + v_add_seconds + 120 + 600) * interval '1 second');

    IF v_before.daily_room_expires_at IS NULL OR v_before.daily_room_expires_at <= v_required_until THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'daily_room_expiring_before_extension',
        'room_refresh_required', true,
        'required_until', v_required_until,
        'daily_room_expires_at', v_before.daily_room_expires_at
      );
    END IF;

    v_request := jsonb_build_object(
      'action', 'extension',
      'credit_type', v_credit_type
    );

    v_begin := public.video_session_command_begin_v2(
      p_session_id,
      v_actor,
      'extension',
      v_key,
      v_request,
      p_request_hash
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'commandStatus', COALESCE(v_begin->>'status', 'rejected')
      );
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
        'commandStatus', v_begin->>'status',
        'commandId', (v_begin->>'commandId')::bigint,
        'requestHash', v_begin->>'requestHash',
        'date_extra_seconds', COALESCE(v_after.date_extra_seconds, (COALESCE(v_begin->'result', '{}'::jsonb)->>'date_extra_seconds')::integer),
        'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
      );
    END IF;

    IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'command_in_progress',
        'retryable', true,
        'commandStatus', v_begin->>'status',
        'commandId', (v_begin->>'commandId')::bigint,
        'requestHash', v_begin->>'requestHash'
      );
    END IF;

    v_command_id := (v_begin->>'commandId')::bigint;

    v_spend := public.spend_video_date_credit_extension(
      p_session_id,
      v_credit_type,
      v_key
    );
    v_success := COALESCE(
      CASE WHEN jsonb_typeof(v_spend->'success') = 'boolean' THEN (v_spend->>'success')::boolean ELSE NULL END,
      false
    );

    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF v_success AND COALESCE((v_spend->>'idempotent')::boolean, false) IS FALSE THEN
      v_event := public.append_video_session_event_v2(
        p_session_id,
        'date_extension_applied',
        'participants',
        v_actor,
        jsonb_build_object(
          'action', 'extension',
          'credit_type', v_credit_type,
          'added_seconds', COALESCE(NULLIF(v_spend->>'added_seconds', '')::integer, v_add_seconds),
          'date_extra_seconds', COALESCE(v_after.date_extra_seconds, NULLIF(v_spend->>'date_extra_seconds', '')::integer)
        ),
        jsonb_build_object(
          'credit_type', v_credit_type,
          'added_seconds', COALESCE(NULLIF(v_spend->>'added_seconds', '')::integer, v_add_seconds),
          'date_extra_seconds', COALESCE(v_after.date_extra_seconds, NULLIF(v_spend->>'date_extra_seconds', '')::integer)
        ),
        true,
        gen_random_uuid()
      );
    END IF;

    v_result := COALESCE(v_spend, '{}'::jsonb) || jsonb_build_object(
      'ok', v_success,
      'success', v_success,
      'backend_version', 'v2',
      'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash',
      'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq)
    );

    PERFORM public.video_session_command_finish_v2(
      v_command_id,
      v_actor,
      CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
      v_result
    );
    RETURN v_result;  END;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Mechanical entry-vocabulary updates to surviving functions
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.video_date_transition(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_delegate_action text;
  v_norm_action text;
  v_norm_reason text;
  v_now timestamptz := now();
  v_clock_now timestamptz;
  v_session public.video_sessions%ROWTYPE;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner uuid;
  v_is_p1 boolean;
  v_state_before text;
  v_rowcnt integer := 0;
  v_success boolean := false;
  -- prepare_entry
  v_actionability jsonb;
  v_protection jsonb := NULL;
  v_attempt_id text;
  v_already_entry boolean := false;
  v_gate_live boolean := false;
  v_active_lease boolean := false;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_lease_expires_at timestamptz;
  v_previous_lease_expires_at timestamptz;
  v_blocked boolean := false;
  -- reconnect / presence
  v_actor_joined_at timestamptz;
  v_actor_away_at timestamptz;
  v_partner_away_at timestamptz;
  v_actor_remote_seen_at timestamptz;
  v_surface_claim_at timestamptz;
  v_actor_active boolean := false;
  v_surface_active boolean := false;
  v_remote_seen_active boolean := false;
  v_recent_remote_seen boolean := false;
  v_recent_joined boolean := false;
  v_recent_entry boolean := false;
  v_warmup_state boolean := false;
  v_warmup_window interval := interval '20 seconds';
  -- end handling
  v_canonical_reason text;
  v_effective_reason text;
  v_reached_date_phase boolean := false;
  v_exactly_one_joined boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_end_reason text;
  v_joined_participant_id uuid;
  v_missing_participant_id uuid;
  v_joined_slot text;
  -- handshake decisions
  v_decision boolean;
  v_actor_decided_at timestamptz;
  v_partner_decided_at timestamptz;
  v_waiting_for_self boolean;
  v_waiting_for_partner boolean;
  -- pipeline
  v_result jsonb := NULL;
  v_skip_inner_posts boolean := false;
  v_skip_middle boolean := false;
  v_skip_actionability_mark boolean := false;
  v_should_open_survey boolean := false;
  v_server_now_ms bigint;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- PR-5 vocabulary flip: entry-vocabulary action names are canonical.
  -- Legacy handshake action names remain accepted as aliases.
  v_delegate_action := CASE v_action
    WHEN 'complete_handshake' THEN 'complete_entry'
    WHEN 'continue_handshake' THEN 'continue_entry'
    ELSE p_action
  END;
  v_norm_action := lower(btrim(COALESCE(v_delegate_action, '')));
  v_norm_reason := NULLIF(lower(btrim(COALESCE(p_reason, ''))), '');

  IF v_action = 'enter_handshake' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_date_transition',
      'action', v_action,
      'error', 'standalone_enter_handshake_removed',
      'reason', 'standalone_enter_handshake_removed',
      'message', 'Standalone enter_handshake is removed. Use prepare_entry via prepare_date_entry.',
      'code', 'ENTER_HANDSHAKE_REMOVED',
      'error_code', 'ENTER_HANDSHAKE_REMOVED',
      'retryable', false,
      'terminal', false,
      'removed_public_action', true,
      'supported_action', 'prepare_entry',
      'entry_command', 'prepare_date_entry',
      'prepare_entry_required', true,
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  BEGIN
    -- ── Ready Gate actionability precheck (formerly vdt_both_ready_owner) ──
    IF v_norm_action = 'prepare_entry' THEN
      v_actionability := public.video_date_ready_gate_actionability_v1(
        p_session_id,
        v_actor,
        'video_date_transition.prepare_entry',
        false,
        true,
        true,
        true
      );

      IF lower(COALESCE(v_actionability ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
        v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
          p_session_id,
          v_actor,
          'video_date_transition',
          v_actionability
            - 'sqlstate'
            - 'message'
            - 'detail'
            - 'hint'
            - 'context'
            || jsonb_build_object(
              'ok', false,
              'success', false,
              'action', 'prepare_entry',
              'code', COALESCE(v_actionability ->> 'code', v_actionability ->> 'error_code', 'READY_GATE_NOT_ACTIONABLE'),
              'error_code', COALESCE(v_actionability ->> 'error_code', v_actionability ->> 'code', 'READY_GATE_NOT_ACTIONABLE'),
              'error', COALESCE(v_actionability ->> 'error', 'ready_gate_not_actionable'),
              'reason', COALESCE(v_actionability ->> 'reason', 'ready_gate_not_actionable')
            )
        );
        v_skip_inner_posts := true;
        v_skip_middle := true;
        v_skip_actionability_mark := true;
      END IF;
    END IF;

    -- ── Prepare-lease protection precheck (formerly vdt_terminal_lifecycle) ──
    IF v_result IS NULL AND v_delegate_action = 'prepare_entry' THEN
      v_attempt_id := NULLIF(substring(COALESCE(p_reason, '') FROM '^entry_attempt:(.+)$'), '');
      v_protection := public.video_date_protect_both_ready_entry_v1(
        p_session_id,
        v_actor,
        v_attempt_id,
        'video_date_transition_prepare_entry'
      );

      IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) IS FALSE
         AND COALESCE(v_protection ->> 'code', '') IN ('SESSION_NOT_FOUND', 'SESSION_ENDED', 'ACCESS_DENIED', 'EVENT_INACTIVE') THEN
        v_result := v_protection;
        v_skip_inner_posts := true;
      END IF;
    END IF;

    IF v_result IS NULL THEN
      BEGIN
        -- ── Self-away suppression (formerly vdt_single_owner) ──
        IF v_norm_action = 'mark_reconnect_self_away'
           AND v_norm_reason IN (
             'web_visibilitychange',
             'web_freeze',
             'web_beforeunload',
             'web_pagehide',
             'app_background'
           ) THEN
          v_clock_now := clock_timestamp();

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id
          FOR UPDATE;

          IF FOUND
             AND v_actor IS NOT NULL
             AND v_session.ended_at IS NULL
             AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
             AND (
               v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
               OR v_session.phase IN ('entry', 'date')
               OR v_session.entry_started_at IS NOT NULL
               OR v_session.date_started_at IS NOT NULL
             ) THEN
            v_actor_joined_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_joined_at
              ELSE v_session.participant_2_joined_at
            END;
            v_actor_away_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_away_at
              ELSE v_session.participant_2_away_at
            END;
            v_actor_remote_seen_at := CASE
              WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_remote_seen_at
              ELSE v_session.participant_2_remote_seen_at
            END;
            v_actor_active := public.video_date_latest_presence_is_active(v_actor_joined_at, v_actor_away_at);
            v_remote_seen_active :=
              v_actor_remote_seen_at IS NOT NULL
              AND (v_actor_away_at IS NULL OR v_actor_remote_seen_at >= v_actor_away_at);

            SELECT max(GREATEST(COALESCE(updated_at, claimed_at), claimed_at))
            INTO v_surface_claim_at
            FROM public.video_date_surface_claims
            WHERE session_id = p_session_id
              AND profile_id = v_actor
              AND surface = 'video_date'
              AND released_at IS NULL
              AND expires_at >= v_clock_now - interval '2 seconds';

            v_surface_active := v_surface_claim_at IS NOT NULL;

            IF v_actor_active OR v_remote_seen_active OR v_surface_active THEN
              IF v_actor = v_session.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              END IF;
              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt > 0 THEN
                PERFORM public.bump_video_session_seq(p_session_id);
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'no_op',
                'mark_reconnect_self_away_suppressed_active_daily_presence',
                NULL,
                v_session.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_norm_action,
                  'p_reason', v_norm_reason,
                  'away_mark_suppressed', true,
                  'reconnect_grace_cleared', v_rowcnt > 0,
                  'actor_joined_at', v_actor_joined_at,
                  'actor_away_at', v_actor_away_at,
                  'actor_remote_seen_at', v_actor_remote_seen_at,
                  'surface_claim_at', v_surface_claim_at,
                  'active_by_joined_presence', v_actor_active,
                  'active_by_remote_seen', v_remote_seen_active,
                  'active_by_surface_claim', v_surface_active
                )
              );

              v_result := jsonb_build_object(
                'ok', true,
                'success', true,
                'state', v_session.state,
                'phase', v_session.phase,
                'ended', false,
                'self_marked_away', false,
                'away_mark_suppressed', true,
                'suppression_reason', 'active_daily_presence',
                'reconnect_grace_cleared', v_rowcnt > 0,
                'p_reason', v_norm_reason
              );
              v_skip_inner_posts := true;
            END IF;
          END IF;
        END IF;

        -- ── Partner-away suppression (formerly vdt_latest_presence) ──
        IF v_result IS NULL
           AND v_norm_action = 'mark_reconnect_partner_away'
           AND COALESCE(v_norm_reason, '') <> 'daily_transport_grace_expired' THEN
          v_clock_now := clock_timestamp();

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id
          FOR UPDATE;

          IF FOUND
             AND v_actor IS NOT NULL
             AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
             AND v_session.ended_at IS NULL THEN
            v_recent_remote_seen :=
              v_session.participant_1_remote_seen_at IS NOT NULL
              AND v_session.participant_2_remote_seen_at IS NOT NULL
              AND GREATEST(
                v_session.participant_1_remote_seen_at,
                v_session.participant_2_remote_seen_at
              ) >= v_clock_now - v_warmup_window;

            v_recent_joined :=
              v_session.participant_1_joined_at IS NOT NULL
              AND v_session.participant_2_joined_at IS NOT NULL
              AND GREATEST(
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at
              ) >= v_clock_now - v_warmup_window;

            v_recent_entry :=
              v_session.entry_started_at IS NOT NULL
              AND v_session.entry_started_at >= v_clock_now - v_warmup_window;

            v_warmup_state :=
              v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
              OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              OR v_session.entry_started_at IS NOT NULL
              OR v_session.date_started_at IS NOT NULL;

            IF v_warmup_state
               AND (v_recent_remote_seen OR v_recent_joined OR v_recent_entry) THEN
              BEGIN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'mark_reconnect_partner_away_suppressed_transport_grace_pending',
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_norm_action,
                    'p_reason', v_norm_reason,
                    'away_mark_suppressed', true,
                    'daily_transport_grace_required', true,
                    'warmup_window_seconds', extract(epoch from v_warmup_window)::integer,
                    'participant_1_joined_at', v_session.participant_1_joined_at,
                    'participant_2_joined_at', v_session.participant_2_joined_at,
                    'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                    'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                    'entry_started_at', v_session.entry_started_at
                  )
                );
              EXCEPTION
                WHEN OTHERS THEN
                  NULL;
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'success', true,
                'state', v_session.state,
                'phase', v_session.phase,
                'ended', false,
                'partner_marked_away', false,
                'away_mark_suppressed', true,
                'suppression_reason', 'daily_transport_grace_required',
                'daily_transport_grace_required', true,
                'p_reason', v_norm_reason,
                'participant_1_joined_at', v_session.participant_1_joined_at,
                'participant_2_joined_at', v_session.participant_2_joined_at,
                'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                'entry_started_at', v_session.entry_started_at
              );
              v_skip_inner_posts := true;
            END IF;
          END IF;
        END IF;

        -- ── Deep dispatch (the effective legacy machine) ──
        IF v_result IS NULL THEN
          <<deep>>
          LOOP
            -- complete_entry delegates to the deadline finalizer
            -- (formerly vdt_survey_continuity).
            IF v_delegate_action = 'complete_entry' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

              v_result := public.finalize_video_date_entry_deadline(
                p_session_id,
                v_actor,
                'rpc_complete_entry',
                p_reason
              );
              EXIT deep;
            END IF;

            -- Late vibe/pass after the 60s handshake deadline goes to the
            -- finalizer (formerly vdt_survey_continuity).
            IF v_delegate_action IN ('vibe', 'pass') AND v_actor IS NOT NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              IF FOUND
                 AND v_session.ended_at IS NULL
                 AND v_session.state = 'entry'::public.video_date_state
                 AND v_session.date_started_at IS NULL
                 AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
                 AND v_session.entry_started_at IS NOT NULL
                 AND v_session.entry_started_at + interval '60 seconds' <= now() THEN
                v_result := public.finalize_video_date_entry_deadline(
                  p_session_id,
                  v_actor,
                  'late_' || v_delegate_action || '_after_entry_deadline',
                  p_reason
                );
                EXIT deep;
              END IF;
            END IF;

            -- prepare_entry: lease grant/refresh, event-inactive block, then
            -- preflight-only checks (formerly vdt_prepare_payload,
            -- vdt_deadline and vdt_peer_missing_end). Room/token minting
            -- stays in the daily-room Edge Function.
            IF v_delegate_action = 'prepare_entry' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id
              FOR UPDATE;

              IF NOT FOUND THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'session_not_found',
                  NULL,
                  NULL,
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;
              v_state_before := v_session.state::text;
              v_is_p1 := (v_p1 = v_actor);

              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Access denied',
                  'code', 'ACCESS_DENIED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;

              -- Lease grant/refresh on a virgin both_ready gate.
              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
                OR v_session.daily_room_name IS NOT NULL
                OR v_session.daily_room_url IS NOT NULL
                OR v_session.participant_1_joined_at IS NOT NULL
                OR v_session.participant_2_joined_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              );

              IF NOT v_already_entry AND v_session.ended_at IS NULL THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_ev);

                IF v_inactive_reason IS NULL THEN
                  v_active_lease := (
                    v_session.prepare_entry_expires_at IS NOT NULL
                    AND v_session.prepare_entry_expires_at > v_now
                  );
                  v_gate_live := (
                    v_session.ready_gate_status = 'both_ready'
                    AND v_session.ready_gate_expires_at IS NOT NULL
                    AND v_session.ready_gate_expires_at > v_now
                  );

                  IF v_session.state = 'ready_gate'::public.video_date_state
                     AND v_session.ready_gate_status = 'both_ready'
                     AND (v_gate_live OR v_active_lease)
                     AND v_session.date_started_at IS NULL
                     AND v_session.entry_started_at IS NULL
                     AND v_session.daily_room_name IS NULL
                     AND v_session.daily_room_url IS NULL
                     AND v_session.participant_1_joined_at IS NULL
                     AND v_session.participant_2_joined_at IS NULL THEN
                    v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
                    v_lease_expires_at := GREATEST(
                      COALESCE(v_session.prepare_entry_expires_at, v_now),
                      v_now + interval '90 seconds'
                    );

                    UPDATE public.video_sessions
                    SET
                      prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now),
                      prepare_entry_expires_at = v_lease_expires_at,
                      prepare_entry_attempt_id = COALESCE(NULLIF(prepare_entry_attempt_id, ''), v_attempt_id),
                      prepare_entry_actor_id = COALESCE(prepare_entry_actor_id, v_actor),
                      ready_gate_expires_at = GREATEST(
                        COALESCE(ready_gate_expires_at, v_now),
                        v_lease_expires_at
                      ),
                      state_updated_at = v_now
                    WHERE id = p_session_id
                      AND ended_at IS NULL
                      AND state = 'ready_gate'::public.video_date_state
                      AND ready_gate_status = 'both_ready'
                      AND date_started_at IS NULL
                      AND entry_started_at IS NULL
                      AND daily_room_name IS NULL
                      AND daily_room_url IS NULL
                      AND participant_1_joined_at IS NULL
                      AND participant_2_joined_at IS NULL
                    RETURNING * INTO v_session;

                    IF FOUND THEN
                      PERFORM public.record_event_loop_observability(
                        'video_date_transition',
                        'success',
                        CASE
                          WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_lease_started'
                          ELSE 'prepare_entry_lease_refreshed'
                        END,
                        NULL,
                        v_session.event_id,
                        v_actor,
                        p_session_id,
                        jsonb_build_object(
                          'action', v_delegate_action,
                          'p_reason', p_reason,
                          'entry_attempt_id', v_attempt_id,
                          'prepare_entry_started_at', v_session.prepare_entry_started_at,
                          'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
                          'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
                          'ready_gate_expires_at', v_session.ready_gate_expires_at,
                          'routeable', false
                        )
                      );
                    END IF;
                  END IF;
                END IF;
              END IF;

              -- The chain re-read the row between generations; keep the row
              -- image current after the conditional lease write.
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              -- Block stale both_ready -> Daily handoff after event
              -- inactivity, while preserving already-prepared entries.
              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
                OR v_session.daily_room_name IS NOT NULL
                OR v_session.daily_room_url IS NOT NULL
                OR v_session.participant_1_joined_at IS NOT NULL
                OR v_session.participant_2_joined_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR COALESCE(v_session.phase, '') IN ('entry', 'date')
              );

              IF NOT v_already_entry THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_ev);

                IF v_inactive_reason IS NOT NULL THEN
                  v_cleanup := public.terminalize_event_ready_gates(v_ev, v_inactive_reason);

                  SELECT *
                  INTO v_session
                  FROM public.video_sessions
                  WHERE id = p_session_id;

                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'blocked',
                    'prepare_entry_event_inactive',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', v_delegate_action,
                      'p_reason', p_reason,
                      'inactive_reason', v_inactive_reason,
                      'cleanup', v_cleanup
                    )
                  );

                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'Event is no longer active',
                    'code', 'READY_GATE_NOT_READY',
                    'error_code', 'EVENT_NOT_ACTIVE',
                    'reason', 'event_not_active',
                    'inactive_reason', v_inactive_reason,
                    'state', COALESCE(v_session.state::text, 'ended'),
                    'phase', COALESCE(v_session.phase, 'ended'),
                    'event_id', v_session.event_id,
                    'participant_1_id', v_session.participant_1_id,
                    'participant_2_id', v_session.participant_2_id,
                    'entry_started_at', v_session.entry_started_at,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'terminal', v_session.ended_at IS NOT NULL
                  );
                  EXIT deep;
                END IF;
              END IF;

              -- Preflight-only checks; no state mutation on success.
              v_actor_away_at := CASE WHEN v_is_p1 THEN v_session.participant_1_away_at ELSE v_session.participant_2_away_at END;

              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', 'ended',
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', COALESCE(v_session.phase, 'ended'),
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              SELECT EXISTS (
                SELECT 1
                FROM public.blocked_users bu
                WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
                   OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
              ) INTO v_blocked;

              IF v_blocked THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'This call is no longer available.',
                  'code', 'BLOCKED_PAIR',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_actor_away_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at IS NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Reconnect sync required before prepare entry',
                  'code', 'RECONNECT_SYNC_REQUIRED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_already_entry := (
                v_session.entry_started_at IS NOT NULL
                OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR v_session.date_started_at IS NOT NULL
              );

              v_gate_live := (
                COALESCE(v_session.ready_gate_status, '') = 'both_ready'
                AND v_session.ready_gate_expires_at IS NOT NULL
                AND v_session.ready_gate_expires_at > v_now
              );

              IF NOT v_already_entry AND NOT v_gate_live THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'prepare_entry_ready_gate_not_ready',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'p_reason', p_reason,
                    'preflight_only', true
                  )
                );
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Both participants must be ready before starting the video date',
                  'code', 'READY_GATE_NOT_READY',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_already_entry THEN 'prepare_entry_preflight_already_active' ELSE 'prepare_entry_preflight_ok' END,
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'phase_after', v_session.phase,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'registration_status', 'deferred_until_confirm_prepare_entry',
                  'preflight_only', true,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'code', 'OK',
                'preflight_only', true,
                'state', v_session.state::text,
                'phase', v_session.phase,
                'event_id', v_ev,
                'participant_1_id', v_p1,
                'participant_2_id', v_p2,
                'entry_started_at', v_session.entry_started_at,
                'ready_gate_status', v_session.ready_gate_status,
                'ready_gate_expires_at', v_session.ready_gate_expires_at
              );
              EXIT deep;
            END IF;

            -- end: partial-join peer timeout (formerly vdt_event_inactive),
            -- then pre-date-aware cleanup (formerly vdt_pre_date_end_cleanup).
            IF v_delegate_action = 'end' THEN
              v_canonical_reason := CASE
                WHEN lower(btrim(COALESCE(p_reason, ''))) IN ('partial_join_peer_timeout', 'peer_missing_timeout')
                  THEN 'partial_join_peer_timeout'
                ELSE NULL
              END;
              v_effective_reason := p_reason;

              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id
              FOR UPDATE;

              IF NOT FOUND THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'session_not_found',
                  NULL,
                  NULL,
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;

              IF v_canonical_reason = 'partial_join_peer_timeout' THEN
                v_is_p1 := v_session.participant_1_id = v_actor;
                IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'blocked',
                    'access_denied',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                  );
                  v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
                  EXIT deep;
                END IF;

                IF v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'state', 'ended',
                    'already_ended', true,
                    'reason', v_session.ended_reason,
                    'survey_eligible', v_session.date_started_at IS NOT NULL
                  );
                  EXIT deep;
                END IF;

                v_reached_date_phase := (
                  v_session.date_started_at IS NOT NULL
                  OR v_session.state = 'date'::public.video_date_state
                  OR v_session.phase = 'date'
                );
                v_exactly_one_joined := (
                  (v_session.participant_1_joined_at IS NULL)
                  <> (v_session.participant_2_joined_at IS NULL)
                );

                IF v_reached_date_phase OR NOT v_exactly_one_joined THEN
                  v_effective_reason := 'ended_from_client';
                ELSE
                  SELECT EXISTS (
                    SELECT 1
                    FROM public.events ev
                    WHERE ev.id = v_session.event_id
                      AND ev.status = 'live'
                      AND ev.archived_at IS NULL
                  ) INTO v_event_live;

                  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;
                  v_joined_participant_id := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_1_id
                    ELSE v_session.participant_2_id
                  END;
                  v_missing_participant_id := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_2_id
                    ELSE v_session.participant_1_id
                  END;
                  v_joined_slot := CASE
                    WHEN v_session.participant_1_joined_at IS NOT NULL THEN 'participant_1'
                    ELSE 'participant_2'
                  END;

                  UPDATE public.video_sessions
                  SET
                    state = 'ended',
                    phase = 'ended',
                    ended_at = v_now,
                    ended_reason = 'partial_join_peer_timeout',
                    entry_grace_expires_at = NULL,
                    reconnect_grace_ends_at = NULL,
                    participant_1_away_at = NULL,
                    participant_2_away_at = NULL,
                    duration_seconds = COALESCE(
                      duration_seconds,
                      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(entry_started_at, started_at))))::int)
                    ),
                    state_updated_at = v_now
                  WHERE id = p_session_id
                    AND ended_at IS NULL
                    AND date_started_at IS NULL
                    AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL));

                  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
                  IF v_rowcnt = 0 THEN
                    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                    v_result := jsonb_build_object(
                      'success', true,
                      'state', COALESCE(v_session.state::text, 'ended'),
                      'already_ended', v_session.ended_at IS NOT NULL,
                      'reason', v_session.ended_reason,
                      'survey_eligible', v_session.date_started_at IS NOT NULL
                    );
                    EXIT deep;
                  END IF;

                  UPDATE public.event_registrations
                  SET
                    queue_status = v_resume_status,
                    current_room_id = NULL,
                    current_partner_id = NULL,
                    last_active_at = v_now
                  WHERE event_id = v_session.event_id
                    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                    AND current_room_id = p_session_id;

                  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'partial_join_peer_manual_end',
                    NULL,
                    v_session.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', v_delegate_action,
                      'p_reason', p_reason,
                      'ended_reason', 'partial_join_peer_timeout',
                      'transition', 'entry_to_ended',
                      'watchdog_source', 'client_peer_missing_exit',
                      'joined_participant_id', v_joined_participant_id,
                      'missing_participant_id', v_missing_participant_id,
                      'joined_slot', v_joined_slot,
                      'registration_status', v_resume_status,
                      'survey_eligible', false,
                      'joined_evidence', jsonb_build_object(
                        'participant_1_joined', v_session.participant_1_joined_at IS NOT NULL,
                        'participant_2_joined', v_session.participant_2_joined_at IS NOT NULL,
                        'participant_1_joined_at', v_session.participant_1_joined_at,
                        'participant_2_joined_at', v_session.participant_2_joined_at
                      )
                    )
                  );

                  v_result := jsonb_build_object(
                    'success', true,
                    'state', 'ended',
                    'reason', 'partial_join_peer_timeout',
                    'survey_eligible', false,
                    'registration_status', v_resume_status
                  );
                  EXIT deep;
                END IF;
              END IF;

              -- Pre-date-aware end cleanup. A date-phase row stays
              -- survey-eligible through date_started_at; pre-date rows do not.
              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                v_state_before := v_session.state::text;

                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'reconnect_grace_auto_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', v_effective_reason,
                    'survey_eligible', v_session.date_started_at IS NOT NULL
                  )
                );

                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'reason', 'reconnect_grace_expired',
                  'survey_eligible', v_session.date_started_at IS NOT NULL
                );
                EXIT deep;
              END IF;

              v_is_p1 := (v_p1 = v_actor);
              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'access_denied',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'state_before', v_session.state::text,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', v_effective_reason
                  )
                );
                v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'already_ended', true,
                  'reason', v_session.ended_reason,
                  'survey_eligible', v_session.date_started_at IS NOT NULL
                );
                EXIT deep;
              END IF;

              v_reached_date_phase := (
                v_session.date_started_at IS NOT NULL
                OR v_session.state = 'date'::public.video_date_state
                OR v_session.phase = 'date'
              );

              SELECT EXISTS (
                SELECT 1
                FROM public.events ev
                WHERE ev.id = v_ev
                  AND ev.status = 'live'
                  AND ev.archived_at IS NULL
              ) INTO v_event_live;

              v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

              IF v_reached_date_phase THEN
                v_end_reason := COALESCE(v_effective_reason, v_session.ended_reason, 'ended_by_participant');
              ELSE
                v_end_reason := CASE
                  WHEN COALESCE(v_effective_reason, '') IN (
                    'ready_gate_forfeit',
                    'ready_gate_expired',
                    'queued_ttl_expired',
                    'entry_not_mutual',
                    'entry_grace_expired',
                    'entry_timeout',
                    'blocked_pair',
                    'reconnect_grace_expired'
                  ) THEN v_effective_reason
                  ELSE 'pre_date_manual_end'
                END;
              END IF;

              v_state_before := v_session.state::text;

              UPDATE public.video_sessions
              SET
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = v_end_reason,
                reconnect_grace_ends_at = NULL,
                participant_1_away_at = NULL,
                participant_2_away_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL;

              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt = 0 THEN
                v_result := jsonb_build_object('success', true, 'state', 'ended', 'already_ended', true);
                EXIT deep;
              END IF;

              IF v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              ELSIF v_reached_date_phase THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'in_survey',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              ELSE
                -- Pre-date termination is not survey-eligible. Clear only
                -- registrations still pointing at this session so a newer
                -- ready gate/date cannot be overwritten by stale cleanup.
                UPDATE public.event_registrations
                SET
                  queue_status = v_resume_status,
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;
              END IF;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_reached_date_phase THEN 'date_end_survey' ELSE 'pre_date_end_cleanup' END,
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'participant_1_decided_at', v_session.participant_1_decided_at,
                  'participant_2_decided_at', v_session.participant_2_decided_at,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', v_effective_reason,
                  'ended_reason', v_end_reason,
                  'survey_eligible', v_reached_date_phase,
                  'registration_resume_status',
                    CASE
                      WHEN v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN 'idle'
                      WHEN v_reached_date_phase THEN 'in_survey'
                      ELSE v_resume_status
                    END
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'ended',
                'reason', v_end_reason,
                'survey_eligible', v_reached_date_phase,
                'registration_status',
                  CASE
                    WHEN v_reached_date_phase AND COALESCE(v_effective_reason, '') = 'reconnect_grace_expired' THEN 'idle'
                    WHEN v_reached_date_phase THEN 'in_survey'
                    ELSE v_resume_status
                  END
              );
              EXIT deep;
            END IF;

            -- mark_reconnect_self_away (formerly vdt_provider_atomic_entry).
            IF v_delegate_action = 'mark_reconnect_self_away' THEN
              IF v_actor IS NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'unauthorized',
                  NULL,
                  NULL,
                  NULL,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
                EXIT deep;
              END IF;

              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id
              FOR UPDATE;

              IF NOT FOUND THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'session_not_found',
                  NULL,
                  NULL,
                  v_actor,
                  p_session_id,
                  jsonb_build_object('action', v_delegate_action, 'p_reason', p_reason)
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
                EXIT deep;
              END IF;

              v_ev := v_session.event_id;
              v_p1 := v_session.participant_1_id;
              v_p2 := v_session.participant_2_id;
              v_state_before := v_session.state::text;
              v_is_p1 := (v_p1 = v_actor);

              IF NOT v_is_p1 AND v_p2 != v_actor THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Access denied',
                  'code', 'ACCESS_DENIED',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;
              v_partner_away_at := CASE WHEN v_is_p1 THEN v_session.participant_2_away_at ELSE v_session.participant_1_away_at END;

              IF v_session.ended_at IS NULL
                 AND v_session.reconnect_grace_ends_at IS NOT NULL
                 AND v_session.reconnect_grace_ends_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = 'reconnect_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2)
                  AND current_room_id = p_session_id;

                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', 'ended',
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'Session has ended',
                  'code', 'SESSION_ENDED',
                  'state', 'ended',
                  'phase', COALESCE(v_session.phase, 'ended'),
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              SELECT EXISTS (
                SELECT 1
                FROM public.blocked_users bu
                WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
                   OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
              ) INTO v_blocked;

              IF v_blocked THEN
                v_result := jsonb_build_object(
                  'success', false,
                  'error', 'This call is no longer available.',
                  'code', 'BLOCKED_PAIR',
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'event_id', v_ev,
                  'participant_1_id', v_p1,
                  'participant_2_id', v_p2,
                  'entry_started_at', v_session.entry_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at
                );
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN COALESCE(participant_1_away_at, v_now) ELSE participant_1_away_at END,
                participant_2_away_at = CASE WHEN NOT v_is_p1 THEN COALESCE(participant_2_away_at, v_now) ELSE participant_2_away_at END,
                reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND (state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                  OR phase IN ('entry', 'date'));

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'mark_reconnect_self_away',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'phase_after', v_session.phase,
                  'reason', p_reason,
                  'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'code', 'OK',
                'state', v_session.state::text,
                'phase', v_session.phase,
                'event_id', v_ev,
                'participant_1_id', v_p1,
                'participant_2_id', v_p2,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'partner_marked_away', v_partner_away_at IS NOT NULL
              );
              EXIT deep;
            END IF;

            -- Core legacy machine: sync_reconnect, mark_reconnect_partner_away,
            -- mark_reconnect_return, vibe/pass, unknown actions
            -- (formerly vdt_core_legacy_01).
            IF v_actor IS NULL THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'unauthorized',
                NULL,
                NULL,
                NULL,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
              EXIT deep;
            END IF;

            SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
            IF NOT FOUND THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'session_not_found',
                NULL,
                NULL,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
              EXIT deep;
            END IF;

            v_ev := v_session.event_id;
            v_p1 := v_session.participant_1_id;
            v_p2 := v_session.participant_2_id;

            IF v_session.ended_at IS NULL
               AND v_session.reconnect_grace_ends_at IS NOT NULL
               AND v_session.reconnect_grace_ends_at <= v_now THEN
              v_state_before := v_session.state::text;

              UPDATE public.video_sessions
              SET
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = 'reconnect_grace_expired',
                reconnect_grace_ends_at = NULL,
                participant_1_away_at = NULL,
                participant_2_away_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id;

              UPDATE public.event_registrations
              SET
                queue_status = 'idle',
                current_room_id = NULL,
                current_partner_id = NULL,
                last_active_at = v_now
              WHERE event_id = v_ev
                AND profile_id IN (v_p1, v_p2);

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'reconnect_grace_auto_ended',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'ended',
                'reason', 'reconnect_grace_expired'
              );
              EXIT deep;
            END IF;

            v_is_p1 := (v_p1 = v_actor);
            IF NOT v_is_p1 AND v_p2 != v_actor THEN
              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'blocked',
                'access_denied',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'state_before', v_session.state::text,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );
              v_result := jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
              EXIT deep;
            END IF;

            SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
            v_ev := v_session.event_id;
            v_p1 := v_session.participant_1_id;
            v_p2 := v_session.participant_2_id;

            IF v_delegate_action = 'sync_reconnect' THEN
              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at,
                'ended', v_session.ended_at IS NOT NULL,
                'ended_reason', v_session.ended_reason,
                'state', v_session.state::text,
                'phase', v_session.phase,
                'partner_marked_away',
                  CASE
                    WHEN v_is_p1 THEN v_session.participant_2_away_at IS NOT NULL
                    ELSE v_session.participant_1_away_at IS NOT NULL
                  END
              );
              EXIT deep;
            END IF;

            IF v_delegate_action = 'mark_reconnect_partner_away' THEN
              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;
              IF v_session.state NOT IN ('entry'::public.video_date_state, 'date'::public.video_date_state) THEN
                v_result := jsonb_build_object('success', false, 'error', 'Not in reconnect-eligible phase', 'code', 'INVALID_PHASE');
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN participant_1_away_at ELSE v_now END,
                participant_2_away_at = CASE WHEN v_is_p1 THEN v_now ELSE participant_2_away_at END,
                reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
                state_updated_at = v_now
              WHERE id = p_session_id;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at
              );
              EXIT deep;
            END IF;

            IF v_delegate_action = 'mark_reconnect_return' THEN
              IF v_session.ended_at IS NOT NULL THEN
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;

              UPDATE public.video_sessions
              SET
                participant_1_away_at = CASE WHEN v_is_p1 THEN NULL ELSE participant_1_away_at END,
                participant_2_away_at = CASE WHEN v_is_p1 THEN participant_2_away_at ELSE NULL END,
                state_updated_at = v_now
              WHERE id = p_session_id;

              UPDATE public.video_sessions
              SET
                reconnect_grace_ends_at = CASE
                  WHEN participant_1_away_at IS NULL AND participant_2_away_at IS NULL THEN NULL
                  ELSE reconnect_grace_ends_at
                END,
                state_updated_at = v_now
              WHERE id = p_session_id;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

              v_result := jsonb_build_object(
                'success', true,
                'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
                'participant_1_away_at', v_session.participant_1_away_at,
                'participant_2_away_at', v_session.participant_2_away_at
              );
              EXIT deep;
            END IF;

            IF v_delegate_action IN ('vibe', 'pass') THEN
              v_decision := (v_delegate_action = 'vibe');
              v_state_before := v_session.state::text;
              v_actor_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_1_decided_at ELSE v_session.participant_2_decided_at END;
              v_partner_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_2_decided_at ELSE v_session.participant_1_decided_at END;
              v_waiting_for_self := v_actor_decided_at IS NULL;
              v_waiting_for_partner := v_partner_decided_at IS NULL;

              IF v_session.ended_at IS NOT NULL THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'blocked',
                  'session_already_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );
                v_result := jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
                EXIT deep;
              END IF;

              IF v_session.entry_grace_expires_at IS NOT NULL
                 AND v_now >= v_session.entry_grace_expires_at THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = COALESCE(ended_at, v_now),
                  ended_reason = 'entry_grace_expired',
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.entry_started_at, v_session.started_at))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'grace_expired_coerced_to_end',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );

                v_result := jsonb_build_object(
                  'success', false,
                  'code', 'GRACE_EXPIRED',
                  'state', 'ended',
                  'reason', 'entry_grace_expired',
                  'waiting_for_self', v_waiting_for_self,
                  'waiting_for_partner', v_waiting_for_partner,
                  'local_decision_persisted', NOT v_waiting_for_self,
                  'partner_decision_persisted', NOT v_waiting_for_partner
                );
                EXIT deep;
              END IF;

              IF v_is_p1 THEN
                UPDATE public.video_sessions
                SET
                  participant_1_liked = COALESCE(participant_1_liked, v_decision),
                  participant_1_decided_at = COALESCE(participant_1_decided_at, v_now),
                  state_updated_at = v_now
                WHERE id = p_session_id AND ended_at IS NULL;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_liked = COALESCE(participant_2_liked, v_decision),
                  participant_2_decided_at = COALESCE(participant_2_decided_at, v_now),
                  state_updated_at = v_now
                WHERE id = p_session_id AND ended_at IS NULL;
              END IF;

              SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
              v_actor_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_1_decided_at ELSE v_session.participant_2_decided_at END;
              v_partner_decided_at := CASE WHEN v_is_p1 THEN v_session.participant_2_decided_at ELSE v_session.participant_1_decided_at END;
              v_waiting_for_self := v_actor_decided_at IS NULL;
              v_waiting_for_partner := v_partner_decided_at IS NULL;

              IF v_session.participant_1_decided_at IS NOT NULL
                 AND v_session.participant_2_decided_at IS NOT NULL
                 AND v_session.participant_1_liked IS TRUE
                 AND v_session.participant_2_liked IS TRUE THEN
                UPDATE public.video_sessions
                SET
                  state = 'date',
                  phase = 'date',
                  date_started_at = COALESCE(date_started_at, v_now),
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL;

                UPDATE public.event_registrations
                SET
                  queue_status = 'in_date',
                  current_room_id = p_session_id,
                  current_partner_id = CASE
                    WHEN profile_id = v_p1 THEN v_p2
                    ELSE v_p1
                  END,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'vibe_completed_mutual_advanced_to_date',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );

                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'date',
                  'waiting_for_self', false,
                  'waiting_for_partner', false,
                  'local_decision_persisted', true,
                  'partner_decision_persisted', true
                );
                EXIT deep;
              END IF;

              IF v_session.participant_1_decided_at IS NOT NULL
                 AND v_session.participant_2_decided_at IS NOT NULL THEN
                UPDATE public.video_sessions
                SET
                  state = 'ended',
                  phase = 'ended',
                  ended_at = COALESCE(ended_at, v_now),
                  ended_reason = COALESCE(p_reason, 'entry_not_mutual'),
                  reconnect_grace_ends_at = NULL,
                  participant_1_away_at = NULL,
                  participant_2_away_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.entry_started_at, v_session.started_at))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_ev
                  AND profile_id IN (v_p1, v_p2);

                SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'vibe_completed_partner_passed_session_ended',
                  NULL,
                  v_ev,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_delegate_action,
                    'participant_1_liked', v_session.participant_1_liked,
                    'participant_2_liked', v_session.participant_2_liked,
                    'participant_1_decided_at', v_session.participant_1_decided_at,
                    'participant_2_decided_at', v_session.participant_2_decided_at,
                    'state_before', v_state_before,
                    'state_after', v_session.state::text,
                    'grace_expires_at', v_session.entry_grace_expires_at,
                    'p_reason', p_reason
                  )
                );

                v_result := jsonb_build_object(
                  'success', true,
                  'state', 'ended',
                  'reason', v_session.ended_reason,
                  'waiting_for_self', false,
                  'waiting_for_partner', false,
                  'local_decision_persisted', true,
                  'partner_decision_persisted', true
                );
                EXIT deep;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                'vibe_recorded_awaiting_partner',
                NULL,
                v_ev,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'participant_1_liked', v_session.participant_1_liked,
                  'participant_2_liked', v_session.participant_2_liked,
                  'participant_1_decided_at', v_session.participant_1_decided_at,
                  'participant_2_decided_at', v_session.participant_2_decided_at,
                  'state_before', v_state_before,
                  'state_after', v_session.state::text,
                  'grace_expires_at', v_session.entry_grace_expires_at,
                  'p_reason', p_reason
                )
              );

              v_result := jsonb_build_object(
                'success', true,
                'state', 'entry',
                'waiting_for_self', v_waiting_for_self,
                'waiting_for_partner', v_waiting_for_partner,
                'local_decision_persisted', NOT v_waiting_for_self,
                'partner_decision_persisted', NOT v_waiting_for_partner
              );
              EXIT deep;
            END IF;

            v_result := jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
            EXIT deep;
          END LOOP;
        END IF;

        -- ── Inner result posts (formerly vdt_remote_seen / vdt_failsoft_base);
        -- suppression results bypass this tier exactly as in the chain. ──
        IF NOT v_skip_inner_posts THEN
          IF v_delegate_action = 'prepare_entry' THEN
            v_success := CASE
              WHEN jsonb_typeof(v_result -> 'success') = 'boolean' THEN (v_result ->> 'success')::boolean
              ELSE false
            END;

            IF v_success AND v_actor IS NOT NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id;

              IF FOUND
                 AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor) THEN
                v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
                  'event_id', v_session.event_id,
                  'participant_1_id', v_session.participant_1_id,
                  'participant_2_id', v_session.participant_2_id,
                  'state', v_session.state::text,
                  'phase', v_session.phase,
                  'ended_at', v_session.ended_at,
                  'ended_reason', v_session.ended_reason,
                  'entry_started_at', v_session.entry_started_at,
                  'date_started_at', v_session.date_started_at,
                  'ready_gate_status', v_session.ready_gate_status,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'daily_room_name', v_session.daily_room_name,
                  'daily_room_url', v_session.daily_room_url,
                  'daily_room_verified_at', v_session.daily_room_verified_at,
                  'daily_room_expires_at', v_session.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason
                );
              END IF;
            END IF;
          END IF;

          IF COALESCE(v_result ->> 'success', 'false') = 'true'
             AND v_result ->> 'state' = 'date' THEN
            SELECT *
            INTO v_session
            FROM public.video_sessions
            WHERE id = p_session_id;

            IF FOUND
               AND NOT public.video_date_session_has_confirmed_encounter(
                 v_session.date_started_at,
                 v_session.state::text,
                 v_session.phase,
                 v_session.participant_1_joined_at,
                 v_session.participant_2_joined_at,
                 v_session.participant_1_remote_seen_at,
                 v_session.participant_2_remote_seen_at
               ) THEN
              v_result := public.end_unconfirmed_video_date_start(
                p_session_id,
                v_actor,
                'transition_' || COALESCE(NULLIF(v_delegate_action, ''), 'unknown'),
                p_reason
              );
            END IF;
          ELSIF COALESCE(v_result ->> 'success', 'false') = 'true'
                AND v_result ->> 'state' = 'ended' THEN
            SELECT *
            INTO v_session
            FROM public.video_sessions
            WHERE id = p_session_id;

            IF FOUND THEN
              v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
                v_session.ended_at,
                v_session.ended_reason,
                v_session.date_started_at,
                v_session.state::text,
                v_session.phase,
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at,
                v_session.participant_1_remote_seen_at,
                v_session.participant_2_remote_seen_at
              );

              IF v_should_open_survey THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'in_survey',
                  current_room_id = p_session_id,
                  current_partner_id = CASE
                    WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
                    ELSE v_session.participant_1_id
                  END,
                  last_active_at = now()
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);
              ELSE
                SELECT EXISTS (
                  SELECT 1
                  FROM public.events ev
                  WHERE ev.id = v_session.event_id
                    AND ev.status = 'live'
                    AND ev.archived_at IS NULL
                ) INTO v_event_live;
                v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

                UPDATE public.event_registrations
                SET
                  queue_status = v_resume_status,
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = now()
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = p_session_id;
              END IF;

              PERFORM public.record_event_loop_observability(
                'video_date_transition',
                'success',
                CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
                NULL,
                v_session.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', v_delegate_action,
                  'reason', p_reason,
                  'ended_reason', v_session.ended_reason,
                  'date_started_at', v_session.date_started_at,
                  'participant_1_joined_at', v_session.participant_1_joined_at,
                  'participant_2_joined_at', v_session.participant_2_joined_at,
                  'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
                  'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
                  'survey_required', v_should_open_survey,
                  'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END
                )
              );
            END IF;

            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey);
          END IF;

          -- mark_reconnect_return grace clearing
          -- (formerly vdt_lifecycle_presence post-step).
          IF v_norm_action = 'mark_reconnect_return'
             AND COALESCE((v_result ->> 'ok')::boolean, true) THEN
            v_clock_now := clock_timestamp();

            SELECT *
            INTO v_session
            FROM public.video_sessions
            WHERE id = p_session_id
            FOR UPDATE;

            IF FOUND
               AND v_actor IS NOT NULL
               AND v_session.ended_at IS NULL
               AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
              IF v_actor = v_session.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_clock_now
                WHERE id = p_session_id
                  AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
              END IF;
              GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
              IF v_rowcnt > 0 THEN
                PERFORM public.bump_video_session_seq(p_session_id);
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'success',
                  'reconnect_grace_cleared_by_return',
                  NULL,
                  v_session.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', v_norm_action,
                    'p_reason', v_norm_reason,
                    'reconnect_grace_cleared', true
                  )
                );
              END IF;
              v_result := v_result || jsonb_build_object('reconnect_grace_cleared', v_rowcnt > 0);
            END IF;
          END IF;
        END IF;

      EXCEPTION
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;

          -- Raw diagnostics go to server-side observability, never into
          -- authenticated client payloads (formerly vdt_routeable_entry,
          -- which leaked sqlstate/message/detail/hint).
          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_date_transition.single_body_core',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;

          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'video_date_transition_failed',
            'reason', 'video_date_transition_failed',
            'code', 'VIDEO_DATE_TRANSITION_FAILED',
            'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
            'retryable', SQLSTATE IS DISTINCT FROM '42501',
            'retry_after_ms', 1500,
            'retry_after_seconds', 2,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
          v_skip_inner_posts := true;
      END;

      -- ── Prepare-lease merge (formerly vdt_terminal_lifecycle post-step) ──
      IF v_delegate_action = 'prepare_entry'
         AND COALESCE(NULLIF(v_result ->> 'success', '')::boolean, false)
         AND COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
        v_result := v_result || jsonb_build_object(
          'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
          'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
          'prepare_entry_attempt_id', v_protection ->> 'prepare_entry_attempt_id',
          'daily_room_name', COALESCE(v_result ->> 'daily_room_name', v_protection ->> 'daily_room_name'),
          'daily_room_url', COALESCE(v_result ->> 'daily_room_url', v_protection ->> 'daily_room_url'),
          'ready_gate_expires_at', COALESCE(v_result ->> 'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at')
        );
      END IF;
    END IF;

    -- ── Lifecycle enrichment + sanitization pipeline (formerly
    -- vdt_definitive_owner -> vdt_last_resort -> vdt_partial_ready_gate). ──
    IF NOT v_skip_middle THEN
      v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
      v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
      v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
      v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_date_transition',
        v_result
      );
    END IF;

    IF NOT v_skip_actionability_mark THEN
      v_result := v_result || jsonb_build_object('ready_gate_actionability_checked', v_norm_action = 'prepare_entry');
    END IF;

    -- ── Route payload + shell markers (formerly vdt_active_entry_failsoft
    -- and the hot-path / flattened shells). ──
    v_result := public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'both_ready_route_owner_checked', v_norm_action = 'prepare_entry'
      ),
      'video_date_transition.both_ready_owner'
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true,
      'standalone_enter_handshake_removed_shell', true,
      'flattened_public_shell', true,
      'single_body_rpc', true
    );

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_date_transition.single_body',
          'video_date_transition_failed',
          'VIDEO_DATE_TRANSITION_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'standalone_enter_handshake_removed_shell', true,
          'flattened_public_shell', true,
          'single_body_rpc', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'video_date_transition',
            'action', v_action,
            'reason_detail', left(btrim(COALESCE(p_reason, '')), 180),
            'error', 'video_date_transition_failed',
            'reason', 'video_date_transition_failed',
            'code', 'VIDEO_DATE_TRANSITION_FAILED',
            'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
            'retryable', true,
            'terminal', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'standalone_enter_handshake_removed_shell', true,
            'flattened_public_shell', true,
            'single_body_rpc', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_video_session_deadline_v2(p_deadline_id bigint, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_deadline public.video_session_deadlines%ROWTYPE;
  v_before record;
  v_after record;
  v_result jsonb := '{}'::jsonb;
  v_success boolean := false;
  v_seconds_remaining integer;
  v_state_changed boolean := false;
BEGIN
  IF p_deadline_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_deadline_finalize');
  END IF;

  SELECT *
  INTO v_deadline
  FROM public.video_session_deadlines
  WHERE id = p_deadline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deadline_not_found');
  END IF;

  IF v_deadline.state = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'done', 'alreadyDone', true);
  END IF;

  IF v_deadline.state IS DISTINCT FROM 'claimed'
     OR v_deadline.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lease_mismatch',
      'state', v_deadline.state,
      'claimedBy', v_deadline.claimed_by
    );
  END IF;

  IF v_deadline.claim_expires_at IS NULL OR v_deadline.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    entry_started_at
  INTO v_before
  FROM public.video_sessions
  WHERE id = v_deadline.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'session_not_found',
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'session_not_found',
      'state', 'failed'
    );
  END IF;

  IF v_deadline.kind = 'noop' THEN
    v_result := jsonb_build_object('success', true, 'state', COALESCE(v_before.state, 'unknown'));
  ELSIF v_deadline.kind IN ('entry_auto_promote', 'entry_timeout',
                            'handshake_auto_promote', 'handshake_timeout') THEN -- legacy kinds accepted defensively
    v_result := public.finalize_video_date_entry_deadline(
      v_deadline.session_id,
      NULL,
      'deadline-finalizer-v2',
      v_deadline.kind
    );
  ELSE
    UPDATE public.video_session_deadlines
    SET
      state = 'failed',
      last_error = 'unsupported_deadline_kind:' || v_deadline.kind,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'unsupported_deadline_kind',
      'kind', v_deadline.kind,
      'state', 'failed'
    );
  END IF;

  v_success := COALESCE(
    CASE WHEN v_result ? 'success' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN v_result ? 'ok' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF NOT v_success THEN
    RETURN public.complete_video_session_deadline_v2(
      p_deadline_id,
      v_worker,
      false,
      COALESCE(v_result->>'code', v_result->>'error', 'deadline_transition_failed'),
      NULL,
      false
    );
  END IF;

  v_seconds_remaining := CASE
    WHEN v_result ? 'seconds_remaining' THEN NULLIF(v_result->>'seconds_remaining', '')::integer
    ELSE NULL
  END;

  IF COALESCE(v_result->>'state', '') = 'entry'
     AND COALESCE(v_seconds_remaining, 0) > 0 THEN
    UPDATE public.video_session_deadlines
    SET
      state = 'pending',
      due_at = now() + (v_seconds_remaining * interval '1 second'),
      last_error = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claimed_by = NULL,
      updated_at = now()
    WHERE id = p_deadline_id;

    RETURN jsonb_build_object(
      'ok', true,
      'state', 'pending',
      'reason', 'deadline_not_due',
      'retryAfterSeconds', v_seconds_remaining,
      'result', v_result
    );
  END IF;

  UPDATE public.video_session_deadlines
  SET
    state = 'done',
    last_error = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claimed_by = NULL,
    updated_at = now()
  WHERE id = p_deadline_id;

  SELECT
    state::text AS state,
    phase,
    ended_at,
    ended_reason,
    date_started_at,
    entry_started_at
  INTO v_after
  FROM public.video_sessions
  WHERE id = v_deadline.session_id;

  v_state_changed := (
    v_before.state IS DISTINCT FROM v_after.state
    OR v_before.phase IS DISTINCT FROM v_after.phase
    OR v_before.ended_at IS DISTINCT FROM v_after.ended_at
    OR v_before.ended_reason IS DISTINCT FROM v_after.ended_reason
    OR v_before.date_started_at IS DISTINCT FROM v_after.date_started_at
    OR v_before.entry_started_at IS DISTINCT FROM v_after.entry_started_at
  );

  IF v_state_changed THEN
    PERFORM public.append_video_session_event_v2(
      v_deadline.session_id,
      'deadline_finalized',
      'participants',
      NULL,
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateBefore', v_before.state,
        'stateAfter', v_after.state,
        'phaseBefore', v_before.phase,
        'phaseAfter', v_after.phase,
        'endedReason', v_after.ended_reason
      ),
      true,
      gen_random_uuid()
    );
  ELSE
    PERFORM public.append_video_session_event_v2(
      v_deadline.session_id,
      'deadline_finalized',
      'internal',
      NULL,
      jsonb_build_object(
        'deadlineId', v_deadline.id,
        'deadlineKind', v_deadline.kind,
        'stateChanged', false,
        'state', v_after.state,
        'phase', v_after.phase,
        'result', v_result
      ),
      jsonb_build_object(
        'deadlineKind', v_deadline.kind,
        'stateChanged', false
      ),
      false,
      gen_random_uuid()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'done',
    'deadlineKind', v_deadline.kind,
    'stateChanged', v_state_changed,
    'result', v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(p_session_id uuid, p_surface text, p_client_instance_id text, p_takeover boolean DEFAULT false, p_ttl_seconds integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := now();
  v_surface text := lower(btrim(COALESCE(p_surface, '')));
  v_client_instance_id text := left(btrim(COALESCE(p_client_instance_id, '')), 120);
  v_ttl_seconds integer := GREATEST(5, LEAST(COALESCE(p_ttl_seconds, 12), 60));
  v_session public.video_sessions%ROWTYPE;
  v_existing public.video_date_surface_claims%ROWTYPE;
  v_surface_allowed boolean := false;
  v_result jsonb;
  v_result_code text;
  v_ok boolean;
  v_blocked boolean;
  v_retryable boolean;
  v_term record;
  v_updated integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Core claim machine (formerly the 20260604093000 failsoft base). ──
    BEGIN
      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
      ELSIF v_surface NOT IN ('ready_gate', 'video_date', 'post_date_survey') THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_SURFACE', 'error', 'invalid_surface');
      ELSIF length(v_client_instance_id) < 8 THEN
        v_result := jsonb_build_object('success', false, 'code', 'INVALID_CLIENT_INSTANCE', 'error', 'invalid_client_instance');
      ELSE
        SELECT * INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF v_session.id IS NULL THEN
          v_result := jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
        ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
          AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
          v_result := jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
        ELSE
          v_surface_allowed := CASE v_surface
            WHEN 'ready_gate' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND v_session.state = 'ready_gate'::public.video_date_state
            WHEN 'video_date' THEN
              public.video_date_session_is_active_surface(v_session.ended_at, v_session.state::text, v_session.phase)
              AND (
                v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                OR v_session.entry_started_at IS NOT NULL
                OR v_session.date_started_at IS NOT NULL
              )
            WHEN 'post_date_survey' THEN
              public.video_date_session_is_post_date_survey_eligible(
                v_session.ended_at,
                v_session.ended_reason,
                v_session.date_started_at,
                v_session.state::text,
                v_session.phase,
                v_session.participant_1_joined_at,
                v_session.participant_2_joined_at
              )
            ELSE false
          END;

          IF NOT v_surface_allowed THEN
            v_result := jsonb_build_object(
              'success', false,
              'code', 'SURFACE_NOT_CLAIMABLE',
              'error', 'surface_not_claimable',
              'state', v_session.state,
              'phase', v_session.phase,
              'ended_reason', v_session.ended_reason
            );
          ELSE
            UPDATE public.video_date_surface_claims
            SET released_at = COALESCE(released_at, v_now), updated_at = v_now
            WHERE profile_id = v_actor
              AND released_at IS NULL
              AND expires_at <= v_now;

            SELECT * INTO v_existing
            FROM public.video_date_surface_claims
            WHERE profile_id = v_actor
            FOR UPDATE;

            IF v_existing.profile_id IS NOT NULL
               AND v_existing.released_at IS NULL
               AND v_existing.expires_at > v_now
               AND (
                 v_existing.session_id IS DISTINCT FROM p_session_id
                 OR v_existing.client_instance_id IS DISTINCT FROM v_client_instance_id
               )
               AND NOT p_takeover THEN
              v_result := jsonb_build_object(
                'success', false,
                'code', 'SURFACE_CLAIM_CONFLICT',
                'error', 'surface_claim_conflict',
                'conflict_session_id', v_existing.session_id,
                'conflict_surface', v_existing.surface,
                'expires_at', v_existing.expires_at
              );
            ELSE
              INSERT INTO public.video_date_surface_claims (
                profile_id,
                session_id,
                surface,
                client_instance_id,
                claimed_at,
                expires_at,
                released_at,
                updated_at
              )
              VALUES (
                v_actor,
                p_session_id,
                v_surface,
                v_client_instance_id,
                v_now,
                v_now + make_interval(secs => v_ttl_seconds),
                NULL,
                v_now
              )
              ON CONFLICT (profile_id)
              DO UPDATE SET
                session_id = EXCLUDED.session_id,
                surface = EXCLUDED.surface,
                client_instance_id = EXCLUDED.client_instance_id,
                claimed_at = EXCLUDED.claimed_at,
                expires_at = EXCLUDED.expires_at,
                released_at = NULL,
                updated_at = EXCLUDED.updated_at;

              v_result := jsonb_build_object(
                'success', true,
                'session_id', p_session_id,
                'surface', v_surface,
                'expires_at', v_now + make_interval(secs => v_ttl_seconds),
                'takeover', p_takeover
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        -- Raw diagnostics go to server-side observability, never into
        -- authenticated client payloads (formerly the outer/single_owner
        -- fail-soft shells, which leaked sqlstate/message/detail/hint).
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'claim_video_date_surface.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'surface_claim_failed',
          'code', 'SURFACE_CLAIM_FAILED',
          'error_code', 'SURFACE_CLAIM_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Surface-claim event ledger (formerly the 20260607155414 lifecycle
    -- base). Best effort; never blocks the claim result. ──
    v_result_code := public.video_date_client_stuck_safe_text(
      COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error', v_result->>'reason'),
      120
    );
    v_ok := CASE lower(COALESCE(v_result->>'ok', v_result->>'success', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;
    v_blocked := CASE lower(COALESCE(v_result->>'blocked', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE CASE
        WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN true
        ELSE NULL
      END
    END;
    v_retryable := CASE lower(COALESCE(v_result->>'retryable', ''))
      WHEN 'true' THEN true
      WHEN 'false' THEN false
      ELSE NULL
    END;

    BEGIN
      INSERT INTO public.video_date_surface_claim_events (
        session_id,
        actor_id,
        surface,
        client_instance_id,
        action,
        takeover,
        ttl_seconds,
        ok,
        blocked,
        retryable,
        result_code,
        detail
      ) VALUES (
        p_session_id,
        v_actor,
        public.video_date_client_stuck_safe_text(p_surface, 80),
        public.video_date_client_stuck_safe_text(p_client_instance_id, 160),
        'claim',
        COALESCE(p_takeover, false),
        CASE
          WHEN p_ttl_seconds IS NULL THEN NULL
          ELSE LEAST(3600, GREATEST(1, p_ttl_seconds))
        END,
        v_ok,
        v_blocked,
        v_retryable,
        v_result_code,
        jsonb_strip_nulls(jsonb_build_object(
          'result', v_result,
          'source', 'claim_video_date_surface',
          'ok_source', CASE
            WHEN v_result ? 'ok' THEN 'ok'
            WHEN v_result ? 'success' THEN 'success'
            ELSE NULL
          END,
          'blocked_source', CASE
            WHEN v_result ? 'blocked' THEN 'blocked'
            WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN 'code'
            ELSE NULL
          END
        ))
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    -- ── Lifecycle enrichment + sanitization (formerly the 20260608080938
    -- last-resort and vd_claim_surface_terminal_truth bases). ──
    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'claim_video_date_surface',
      v_result
    );

    -- ── Terminal-truth audit stamping (formerly vd_claim_surface
    -- 20260609130139 hot base). ──
    SELECT
      vs.id,
      vs.event_id,
      vs.terminal_generation,
      vs.state_updated_at,
      vs.ended_at,
      vs.ended_reason,
      vs.terminal_audit_at,
      vs.terminal_audit_reason
    INTO v_term
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    IF FOUND THEN
      UPDATE public.video_date_surface_claim_events e
      SET
        session_terminal_generation = v_term.terminal_generation,
        session_state_updated_at = v_term.state_updated_at,
        session_ended_at = v_term.ended_at,
        session_ended_reason = v_term.ended_reason,
        detail = COALESCE(e.detail, '{}'::jsonb)
          || jsonb_build_object(
            'session_terminal_generation', v_term.terminal_generation,
            'session_state_updated_at', v_term.state_updated_at,
            'session_ended_at', v_term.ended_at,
            'session_ended_reason', v_term.ended_reason,
            'terminal_audit_at', v_term.terminal_audit_at,
            'terminal_audit_reason', v_term.terminal_audit_reason
          )
      WHERE e.id IN (
        SELECT recent.id
        FROM public.video_date_surface_claim_events recent
        WHERE recent.session_id = p_session_id
          AND recent.surface = COALESCE(NULLIF(p_surface, ''), recent.surface)
          AND (
            p_client_instance_id IS NULL
            OR recent.client_instance_id = p_client_instance_id
          )
        ORDER BY recent.created_at DESC, recent.id DESC
        LIMIT 3
      );

      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO public.video_date_surface_claim_events (
          session_id,
          surface,
          actor_id,
          client_instance_id,
          action,
          takeover,
          ttl_seconds,
          ok,
          blocked,
          retryable,
          result_code,
          detail,
          session_terminal_generation,
          session_state_updated_at,
          session_ended_at,
          session_ended_reason
        ) VALUES (
          p_session_id,
          COALESCE(NULLIF(p_surface, ''), 'video_date'),
          v_actor,
          NULLIF(p_client_instance_id, ''),
          'claim_terminal_audit',
          COALESCE(p_takeover, false),
          p_ttl_seconds,
          lower(COALESCE(v_result->>'ok', v_result->>'success', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'blocked', 'false')) IN ('true', 't', '1', 'yes'),
          lower(COALESCE(v_result->>'retryable', 'false')) IN ('true', 't', '1', 'yes'),
          COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error'),
          COALESCE(v_result, '{}'::jsonb)
            || jsonb_build_object(
              'session_terminal_generation', v_term.terminal_generation,
              'session_state_updated_at', v_term.state_updated_at,
              'session_ended_at', v_term.ended_at,
              'session_ended_reason', v_term.ended_reason,
              'terminal_audit_at', v_term.terminal_audit_at,
              'terminal_audit_reason', v_term.terminal_audit_reason
            ),
          v_term.terminal_generation,
          v_term.state_updated_at,
          v_term.ended_at,
          v_term.ended_reason
        );
      END IF;

      v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
        'session_terminal_generation', v_term.terminal_generation,
        'session_state_updated_at', v_term.state_updated_at,
        'session_ended_at', v_term.ended_at,
        'session_ended_reason', v_term.ended_reason
      );
    END IF;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'claim_video_date_surface.single_body',
          'surface_claim_wrapper_failed',
          'SURFACE_CLAIM_WRAPPER_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'claim_video_date_surface',
            'surface', left(btrim(COALESCE(p_surface, '')), 80),
            'client_instance_id', NULLIF(left(btrim(COALESCE(p_client_instance_id, '')), 180), ''),
            'error', 'surface_claim_failed',
            'reason', 'surface_claim_failed',
            'code', 'SURFACE_CLAIM_FAILED',
            'error_code', 'SURFACE_CLAIM_FAILED',
            'retryable', true,
            'terminal', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_vde_event_inactive_base_v1(p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_gate_live boolean := false;
  v_already_entry boolean := false;
  v_blocked boolean := false;
  v_registration_count integer := 0;
  v_update_count integer := 0;
  v_queue_status text;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily room metadata is required',
      'code', 'DB_ROOM_PERSIST_FAILED'
    );
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', COALESCE(v_session.phase, 'ended'),
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_session.participant_1_id AND bu.blocked_id = v_session.participant_2_id)
       OR (bu.blocker_id = v_session.participant_2_id AND bu.blocked_id = v_session.participant_1_id)
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This call is no longer available.',
      'code', 'BLOCKED_PAIR',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_already_entry := (
    v_session.entry_started_at IS NOT NULL
    OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
    OR v_session.date_started_at IS NOT NULL
  );

  v_gate_live := (
    COALESCE(v_session.ready_gate_status, '') = 'both_ready'
    AND v_session.ready_gate_expires_at IS NOT NULL
    AND v_session.ready_gate_expires_at > v_now
  );

  IF NOT v_already_entry AND NOT v_gate_live THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Both participants must be ready before starting the video date',
      'code', 'READY_GATE_NOT_READY',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT count(*) INTO v_registration_count
  FROM (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    FOR UPDATE
  ) locked_registrations;

  IF v_registration_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_missing',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'registration_count', v_registration_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_queue_status := CASE
    WHEN v_session.date_started_at IS NOT NULL
      OR v_session.state = 'date'::public.video_date_state
      OR v_session.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_queue_status,
    current_room_id = v_session.id,
    current_partner_id = CASE
      WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_update_failed',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'updated_count', v_update_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'entry_started_at', v_session.entry_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  UPDATE public.video_sessions
  SET
    daily_room_name = p_room_name,
    daily_room_url = p_room_url,
    state = CASE
      WHEN date_started_at IS NOT NULL OR state = 'date'::public.video_date_state THEN state
      ELSE 'entry'::public.video_date_state
    END,
    phase = CASE
      WHEN date_started_at IS NOT NULL OR phase = 'date' THEN phase
      ELSE 'entry'
    END,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
  RETURNING * INTO v_session;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'confirm_prepare_entry_prepared',
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'entry_attempt_id', p_entry_attempt_id,
      'state_after', v_session.state::text,
      'phase_after', v_session.phase,
      'room_metadata_persisted', true,
      'registration_status', v_queue_status,
      'entry_timer', 'deferred_until_both_daily_joined'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'state', v_session.state::text,
    'phase', v_session.phase,
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'entry_started_at', v_session.entry_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'daily_room_name', v_session.daily_room_name,
    'daily_room_url', v_session.daily_room_url,
    'entry_attempt_id', p_entry_attempt_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_unconfirmed_video_date_start(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'unconfirmed_remote_video'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_event_live boolean := false;
  v_resume_status text := 'idle';
BEGIN
  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'state', 'ended',
      'reason', 'partial_join_peer_timeout',
      'survey_required', false,
      'error', 'session_not_found'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;
  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

  IF v_session.ended_at IS NULL THEN
    UPDATE public.video_sessions
    SET
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'partial_join_peer_timeout',
      date_started_at = NULL,
      entry_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(date_started_at, entry_started_at, started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_resume_status,
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    AND (
      current_room_id = p_session_id
      OR current_room_id IS NULL
    );

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'unconfirmed_remote_video_terminalized',
    NULL,
    v_session.event_id,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'source', p_source,
      'reason', p_reason,
      'ended_reason', v_session.ended_reason,
      'date_started_at_cleared', true,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'survey_required', false,
      'resume_status', v_resume_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', 'partial_join_peer_timeout',
    'ended_reason', 'partial_join_peer_timeout',
    'survey_required', false,
    'unconfirmed_remote_video', true,
    'resume_status', v_resume_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_one_active_video_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_left text;
  v_right text;
  v_lock_left bigint;
  v_lock_right bigint;
BEGIN
  IF NEW.participant_1_id IS NULL OR NEW.participant_2_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_at IS NOT NULL
     OR NEW.state = 'ended'::public.video_date_state
     OR NEW.phase = 'ended' THEN
    RETURN NEW;
  END IF;

  v_left := LEAST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_right := GREATEST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_lock_left := hashtextextended(v_left, 0);
  v_lock_right := hashtextextended(v_right, 0);

  PERFORM pg_advisory_xact_lock(v_lock_left);
  IF v_lock_right IS DISTINCT FROM v_lock_left THEN
    PERFORM pg_advisory_xact_lock(v_lock_right);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.id IS DISTINCT FROM NEW.id
      AND (
        vs.participant_1_id IN (NEW.participant_1_id, NEW.participant_2_id)
        OR vs.participant_2_id IN (NEW.participant_1_id, NEW.participant_2_id)
      )
      AND public.video_session_blocks_global_active_conflict(
        vs.event_id,
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.entry_started_at,
        vs.date_started_at,
        vs.ended_at,
        vs.ready_gate_expires_at,
        vs.snooze_expires_at,
        vs.prepare_entry_expires_at,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at
      )
  ) THEN
    RAISE EXCEPTION 'participant_has_active_session_conflict'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enrich_video_date_transition_observability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_action text;
  v_grace_status text;
  v_actor_text text;
BEGIN
  IF NEW.operation = 'video_date_transition' THEN
    v_action := COALESCE(NEW.detail->>'action', '');

    IF v_action = 'complete_entry' THEN
      v_actor_text := COALESCE(NEW.actor_id::text, 'system');

      BEGIN
        v_grace_status := CASE NEW.reason_code
          WHEN 'entry_grace_started' THEN 'grace_started'
          WHEN 'entry_grace_active' THEN 'grace_active'
          WHEN 'entry_grace_expired_no_mutual' THEN 'grace_expired'
          WHEN 'entry_completed_mutual' THEN 'not_needed_mutual'
          WHEN 'entry_completed_no_mutual' THEN 'not_needed_no_mutual'
          WHEN 'session_already_ended' THEN 'already_ended'
          ELSE 'unknown'
        END;

        NEW.detail := COALESCE(NEW.detail, '{}'::jsonb) || jsonb_build_object(
          'actor_id', v_actor_text,
          'participant_1_liked', COALESCE(NEW.detail->'participant_1_liked', 'null'::jsonb),
          'participant_2_liked', COALESCE(NEW.detail->'participant_2_liked', 'null'::jsonb),
          'complete_entry_grace_status', COALESCE(v_grace_status, 'unknown'),
          'entry_grace_started', COALESCE(v_grace_status, 'unknown') = 'grace_started',
          'entry_grace_active', COALESCE(v_grace_status, 'unknown') = 'grace_active',
          'entry_grace_expired', COALESCE(v_grace_status, 'unknown') = 'grace_expired'
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Fallback guarantee: always stamp core complete_entry detail keys.
          NEW.detail := COALESCE(NEW.detail, '{}'::jsonb) || jsonb_build_object(
            'actor_id', v_actor_text,
            'complete_entry_grace_status', 'unknown'
          );
      END;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_deck_candidate_eligibility(p_event_id uuid, p_viewer_id uuid, p_target_id uuid, p_check_active boolean DEFAULT true, p_check_existing_swipe boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_active record;
  v_viewer public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_viewer_reg record;
  v_target_reg record;
BEGIN
  IF p_event_id IS NULL OR p_viewer_id IS NULL OR p_target_id IS NULL OR p_viewer_id = p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_candidate');
  END IF;

  IF p_check_active THEN
    SELECT *
    INTO v_active
    FROM public.get_event_lobby_active_state(p_event_id, now());

    IF NOT COALESCE(v_active.is_active, false) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'event_not_active',
        'inactive_reason', COALESCE(v_active.reason, 'event_not_active')
      );
    END IF;
  END IF;

  SELECT * INTO v_viewer
  FROM public.profiles
  WHERE id = p_viewer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'viewer_not_found');
  END IF;

  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_found');
  END IF;

  SELECT er.admission_status, er.queue_status
  INTO v_viewer_reg
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_viewer_id;

  IF NOT FOUND OR COALESCE(v_viewer_reg.admission_status, '') <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT er.admission_status, er.queue_status
  INTO v_target_reg
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_target_id;

  IF NOT FOUND OR COALESCE(v_target_reg.admission_status, '') <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_registered');
  END IF;

  IF public.is_profile_hidden(p_viewer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'viewer_paused');
  END IF;

  IF public.is_blocked(p_viewer_id, p_target_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE ur.reporter_id = p_viewer_id
      AND ur.reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reported');
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_viewer_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_unavailable');
  END IF;

  IF COALESCE(v_target_reg.queue_status, 'idle') NOT IN ('browsing', 'idle') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_unavailable');
  END IF;

  IF NOT public.preference_allows_gender(v_viewer.interested_in, v_target.gender)
     OR NOT public.preference_allows_gender(v_target.interested_in, v_viewer.gender) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'gender_incompatible');
  END IF;

  IF v_target.age IS NOT NULL
     AND (
       (v_viewer.preferred_age_min IS NOT NULL AND v_target.age < v_viewer.preferred_age_min)
       OR (v_viewer.preferred_age_max IS NOT NULL AND v_target.age > v_viewer.preferred_age_max)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'age_incompatible');
  END IF;

  IF v_viewer.age IS NOT NULL
     AND (
       (v_target.preferred_age_min IS NOT NULL AND v_viewer.age < v_target.preferred_age_min)
       OR (v_target.preferred_age_max IS NOT NULL AND v_viewer.age > v_target.preferred_age_max)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'age_incompatible');
  END IF;

  IF p_check_existing_swipe
     AND EXISTS (
       SELECT 1
       FROM public.event_swipes es
       WHERE es.event_id = p_event_id
         AND es.actor_id = p_viewer_id
         AND es.target_id = p_target_id
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_swiped');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE (m.profile_id_1 = p_viewer_id AND m.profile_id_2 = p_target_id)
       OR (m.profile_id_2 = p_viewer_id AND m.profile_id_1 = p_target_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_connected');
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_viewer_id, p_target_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pair_already_met_this_event');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND ((vs.participant_1_id = p_viewer_id AND vs.participant_2_id = p_target_id)
        OR (vs.participant_2_id = p_viewer_id AND vs.participant_1_id = p_target_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pair_already_in_session');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND (vs.participant_1_id = p_viewer_id OR vs.participant_2_id = p_viewer_id)
      AND public.event_lobby_video_session_blocks_new_match(
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.entry_started_at,
        vs.date_started_at,
        vs.ended_at
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'participant_has_active_session_conflict');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND (vs.participant_1_id = p_target_id OR vs.participant_2_id = p_target_id)
      AND public.event_lobby_video_session_blocks_new_match(
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.entry_started_at,
        vs.date_started_at,
        vs.ended_at
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_active_session_conflict');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'eligible');
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_partial_joins_bounded(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_partial int := 0;
  v_rowcnt int := 0;
  v_timeout_anchor timestamptz;
  v_joined_participant_id uuid;
  v_missing_participant_id uuid;
  v_joined_slot text;
BEGIN
  FOR r IN
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      started_at,
      entry_started_at,
      ended_reason,
      participant_1_joined_at,
      participant_2_joined_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'entry'::public.video_date_state
      AND date_started_at IS NULL
      AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL))
      AND GREATEST(
        COALESCE(participant_1_joined_at, '-infinity'::timestamptz),
        COALESCE(participant_2_joined_at, '-infinity'::timestamptz),
        COALESCE(entry_started_at, '-infinity'::timestamptz),
        COALESCE(started_at, '-infinity'::timestamptz)
      ) + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY GREATEST(
      COALESCE(participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(entry_started_at, '-infinity'::timestamptz),
      COALESCE(started_at, '-infinity'::timestamptz)
    ), id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_timeout_anchor := GREATEST(
      COALESCE(r.participant_1_joined_at, '-infinity'::timestamptz),
      COALESCE(r.participant_2_joined_at, '-infinity'::timestamptz),
      COALESCE(r.entry_started_at, '-infinity'::timestamptz),
      COALESCE(r.started_at, '-infinity'::timestamptz)
    );
    v_joined_participant_id :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN r.participant_1_id
        ELSE r.participant_2_id
      END;
    v_missing_participant_id :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN r.participant_2_id
        ELSE r.participant_1_id
      END;
    v_joined_slot :=
      CASE
        WHEN r.participant_1_joined_at IS NOT NULL THEN 'participant_1'
        ELSE 'participant_2'
      END;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'partial_join_peer_timeout',
      entry_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(entry_started_at, started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'entry'::public.video_date_state
      AND date_started_at IS NULL
      AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL));

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      'partial_join_peer_timeout',
      NULL,
      r.event_id,
      v_joined_participant_id,
      r.id,
      jsonb_build_object(
        'action', 'partial_join_peer_timeout',
        'transition', 'entry_to_ended',
        'timeout_source', 'expire_stale_video_date_phases_bounded',
        'watchdog_source', 'server_cleanup',
        'event_id', r.event_id,
        'session_id', r.id,
        'actor_user_id', v_joined_participant_id,
        'joined_participant_id', v_joined_participant_id,
        'missing_participant_id', v_missing_participant_id,
        'joined_slot', v_joined_slot,
        'prior_state', 'entry',
        'prior_reason', r.ended_reason,
        'next_state', 'ended',
        'next_reason', 'partial_join_peer_timeout',
        'timeout_anchor', v_timeout_anchor,
        'timeout_seconds', 90,
        'elapsed_seconds', GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_timeout_anchor)))::int),
        'joined_evidence', jsonb_build_object(
          'participant_1_joined', r.participant_1_joined_at IS NOT NULL,
          'participant_2_joined', r.participant_2_joined_at IS NOT NULL,
          'participant_1_joined_at', r.participant_1_joined_at,
          'participant_2_joined_at', r.participant_2_joined_at
        )
      )
    );

    v_partial := v_partial + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'partial_join_peer_timeout', v_partial,
    'limit', v_limit,
    'total', v_partial
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_session_context(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration jsonb := NULL;
  v_current_session jsonb := NULL;
  v_open_sessions jsonb := '[]'::jsonb;
  v_recent_ended_sessions jsonb := '[]'::jsonb;
  v_feedback_session_ids jsonb := '[]'::jsonb;
  v_active_session jsonb := NULL;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'active_session', NULL,
      'registration', NULL,
      'current_session', NULL,
      'open_sessions', '[]'::jsonb,
      'recent_ended_sessions', '[]'::jsonb,
      'feedback_session_ids', '[]'::jsonb,
      'reason', 'missing_user'
    );
  END IF;

  SELECT to_jsonb(r)
  INTO v_registration
  FROM (
    SELECT
      er.event_id,
      er.current_room_id,
      er.queue_status,
      er.current_partner_id
    FROM public.event_registrations er
    WHERE er.profile_id = v_user_id
      AND er.queue_status IN ('in_handshake', 'in_date', 'in_survey', 'in_ready_gate')
      AND er.current_room_id IS NOT NULL
      AND (p_event_id IS NULL OR er.event_id = p_event_id)
    ORDER BY
      CASE er.queue_status
        WHEN 'in_handshake' THEN 0
        WHEN 'in_date' THEN 1
        WHEN 'in_ready_gate' THEN 2
        WHEN 'in_survey' THEN 3
        ELSE 4
      END,
      er.registered_at DESC NULLS LAST
    LIMIT 1
  ) r;

  IF v_registration IS NOT NULL THEN
    SELECT to_jsonb(vs)
    INTO v_current_session
    FROM (
      SELECT
        id,
        event_id,
        participant_1_id,
        participant_2_id,
        ended_at,
        ended_reason,
        state,
        phase,
        entry_started_at,
        date_started_at,
        date_extra_seconds,
        ready_gate_status,
        ready_gate_expires_at,
        reconnect_grace_ends_at,
        started_at,
        state_updated_at,
        participant_1_joined_at,
        participant_2_joined_at,
        daily_room_name,
        daily_room_url
      FROM public.video_sessions
      WHERE id = (v_registration->>'current_room_id')::uuid
        AND (
          participant_1_id = v_user_id
          OR participant_2_id = v_user_id
        )
      LIMIT 1
    ) vs;

    IF v_current_session IS NOT NULL AND v_current_session->>'ended_at' IS NULL THEN
      v_active_session := jsonb_build_object(
        'kind',
          CASE
            WHEN v_registration->>'queue_status' = 'in_ready_gate' THEN 'ready_gate'
            ELSE 'video'
          END,
        'session_id', v_current_session->>'id',
        'event_id', v_registration->>'event_id',
        'queue_status', v_registration->>'queue_status'
      );
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_open_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      state,
      phase,
      entry_started_at,
      date_started_at,
      date_extra_seconds,
      ready_gate_status,
      ready_gate_expires_at,
      reconnect_grace_ends_at,
      started_at,
      state_updated_at,
      participant_1_joined_at,
      participant_2_joined_at,
      daily_room_name,
      daily_room_url
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY entry_started_at DESC NULLS LAST, ready_gate_expires_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(to_jsonb(vs)), '[]'::jsonb)
  INTO v_recent_ended_sessions
  FROM (
    SELECT
      id,
      event_id,
      participant_1_id,
      participant_2_id,
      ended_at,
      ended_reason,
      date_started_at,
      participant_1_joined_at,
      participant_2_joined_at,
      state,
      phase
    FROM public.video_sessions
    WHERE (participant_1_id = v_user_id OR participant_2_id = v_user_id)
      AND ended_at IS NOT NULL
      AND (p_event_id IS NULL OR event_id = p_event_id)
    ORDER BY ended_at DESC NULLS LAST
    LIMIT 10
  ) vs;

  SELECT COALESCE(jsonb_agg(df.session_id), '[]'::jsonb)
  INTO v_feedback_session_ids
  FROM public.date_feedback df
  WHERE df.user_id = v_user_id
    AND df.session_id IN (
      SELECT ended_vs.id
      FROM public.video_sessions ended_vs
      WHERE (ended_vs.participant_1_id = v_user_id OR ended_vs.participant_2_id = v_user_id)
        AND ended_vs.ended_at IS NOT NULL
        AND (p_event_id IS NULL OR ended_vs.event_id = p_event_id)
      ORDER BY ended_vs.ended_at DESC NULLS LAST
      LIMIT 10
    );

  IF v_active_session IS NULL AND jsonb_array_length(v_open_sessions) > 0 THEN
    v_current_session := v_open_sessions->0;
    v_active_session := jsonb_build_object(
      'kind',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'entry_started_at', '') = ''
          THEN 'ready_gate'
          ELSE 'video'
        END,
      'session_id', v_current_session->>'id',
      'event_id', v_current_session->>'event_id',
      'queue_status',
        CASE
          WHEN v_current_session->>'ready_gate_status' IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed', 'queued')
            AND COALESCE(v_current_session->>'entry_started_at', '') = ''
          THEN 'in_ready_gate'
          ELSE COALESCE(NULLIF(v_current_session->>'phase', ''), NULLIF(v_current_session->>'state', ''), 'in_handshake')
        END
    );
  END IF;

  RETURN jsonb_build_object(
    'active_session', v_active_session,
    'registration', v_registration,
    'current_session', v_current_session,
    'open_sessions', v_open_sessions,
    'recent_ended_sessions', v_recent_ended_sessions,
    'feedback_session_ids', v_feedback_session_ids,
    'reason', CASE WHEN v_active_session IS NULL THEN 'no_active_session_shadow_context' ELSE 'active_session_shadow_context' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_deck(p_event_id uuid, p_user_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(profile_id uuid, name text, age integer, gender text, avatar_url text, photos text[], about_me text, job text, location text, height_cm integer, tagline text, looking_for text, queue_status text, has_met_before boolean, is_already_connected boolean, has_super_vibed boolean, shared_vibe_count integer, primary_photo_path text, photo_verified boolean, premium_badge text, availability_state text, media_version text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_active record;
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RAISE EXCEPTION 'event_not_active'
      USING ERRCODE = 'P0001',
            DETAIL = COALESCE(v_active.reason, 'event_not_active');
  END IF;

  RETURN QUERY
  WITH deck AS (
    SELECT base.*
    FROM public.get_event_deck_20260501180000_active_base(
      p_event_id,
      p_user_id,
      p_limit
    ) AS base
    WHERE COALESCE(base.queue_status, 'idle') IN ('browsing', 'idle')
      AND NOT public.video_date_pair_has_terminal_encounter(p_event_id, p_user_id, base.profile_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions vs
        WHERE vs.event_id = p_event_id
          AND (
            vs.participant_1_id = base.profile_id
            OR vs.participant_2_id = base.profile_id
          )
          AND public.event_lobby_video_session_blocks_new_match(
            vs.ready_gate_status,
            vs.state::text,
            vs.phase,
            vs.entry_started_at,
            vs.date_started_at,
            vs.ended_at
          )
      )
  )
  SELECT
    deck.profile_id,
    deck.name,
    deck.age,
    deck.gender,
    deck.avatar_url,
    deck.photos,
    deck.about_me,
    deck.job,
    deck.location,
    deck.height_cm,
    deck.tagline,
    deck.looking_for,
    deck.queue_status,
    deck.has_met_before,
    deck.is_already_connected,
    deck.has_super_vibed,
    deck.shared_vibe_count,
    COALESCE(
      (
        SELECT NULLIF(btrim(photo), '')
        FROM unnest(COALESCE(deck.photos, ARRAY[]::text[])) AS photo
        WHERE NULLIF(btrim(photo), '') IS NOT NULL
        LIMIT 1
      ),
      NULLIF(btrim(deck.avatar_url), '')
    ) AS primary_photo_path,
    COALESCE(p.photo_verified, false) AS photo_verified,
    caps.value->>'badgeType' AS premium_badge,
    'available'::text AS availability_state,
    p.updated_at::text AS media_version
  FROM deck
  JOIN public.profiles p ON p.id = deck.profile_id
  CROSS JOIN LATERAL (
    SELECT public._get_user_tier_capabilities_unchecked(deck.profile_id) AS value
  ) caps;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_video_date_session_timeline(p_session_id uuid)
 RETURNS TABLE(timeline_seq bigint, occurred_at timestamp with time zone, source text, operation text, outcome text, reason_code text, event_id uuid, actor_id uuid, session_id uuid, detail jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH session_row AS (
    SELECT *
    FROM public.video_sessions
    WHERE id = p_session_id
  ),
  timeline_rows AS (
    SELECT
      eo.created_at AS occurred_at,
      'event_loop_observability_events'::text AS source,
      eo.operation,
      eo.outcome,
      eo.reason_code,
      eo.event_id,
      eo.actor_id,
      eo.session_id,
      eo.detail,
      10 AS sort_order
    FROM public.event_loop_observability_events eo
    WHERE eo.session_id = p_session_id
      AND eo.operation IN (
        'handle_swipe',
        'ready_gate_transition',
        'video_date_transition',
        'repair_stale_video_date_prepare_entries',
        'expire_stale_video_sessions',
        'video_date_client_stuck_state',
        'video_date_launch_latency_checkpoint',
        'post_date_half_verdict_saved',
        'post_date_half_verdict_pending',
        'post_date_pending_verdict_completed',
        'post_date_pending_verdict_stale',
        'post_date_pending_verdict_reminder_sent',
        'post_date_pending_verdict_reminder_failed',
        'post_date_half_verdict_timeout',
        'create_date_room_attempt',
        'create_date_room_reused_existing_db_room',
        'create_date_room_provider_already_exists',
        'create_date_room_provider_created',
        'create_date_room_provider_recovered_or_recreated',
        'create_date_room_token_issued',
        'create_date_room_blocked_session_ended',
        'create_date_room_blocked_access_denied',
        'create_date_room_provider_error'
      )

    UNION ALL

    SELECT
      sr.started_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      'session_started',
      sr.event_id,
      NULL::uuid,
      sr.id,
      jsonb_build_object(
        'state', sr.state::text,
        'phase', sr.phase,
        'ready_gate_status', sr.ready_gate_status
      ),
      20
    FROM session_row sr

    UNION ALL

    SELECT
      milestone.occurred_at,
      'video_sessions',
      'video_session_milestone',
      'success',
      milestone.reason_code,
      sr.event_id,
      milestone.actor_id,
      sr.id,
      milestone.detail,
      milestone.sort_order
    FROM session_row sr
    CROSS JOIN LATERAL (
      VALUES
        (
          sr.ready_participant_1_at,
          'participant_1_ready'::text,
          sr.participant_1_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          30
        ),
        (
          sr.ready_participant_2_at,
          'participant_2_ready'::text,
          sr.participant_2_id,
          jsonb_build_object('ready_gate_status', sr.ready_gate_status),
          31
        ),
        (
          sr.entry_started_at,
          'entry_started'::text,
          NULL::uuid,
          jsonb_build_object('state', sr.state::text, 'phase', sr.phase),
          40
        ),
        (
          sr.participant_1_joined_at,
          'participant_1_daily_joined'::text,
          sr.participant_1_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          50
        ),
        (
          sr.participant_2_joined_at,
          'participant_2_daily_joined'::text,
          sr.participant_2_id,
          jsonb_build_object('daily_room_name', sr.daily_room_name),
          51
        ),
        (
          sr.date_started_at,
          'date_started'::text,
          NULL::uuid,
          jsonb_build_object('date_extra_seconds', sr.date_extra_seconds),
          60
        ),
        (
          sr.ended_at,
          COALESCE(sr.ended_reason, 'session_ended'),
          NULL::uuid,
          jsonb_build_object(
            'state', sr.state::text,
            'phase', sr.phase,
            'ended_reason', sr.ended_reason,
            'duration_seconds', sr.duration_seconds
          ),
          70
        )
    ) AS milestone(occurred_at, reason_code, actor_id, detail, sort_order)
    WHERE milestone.occurred_at IS NOT NULL
  )
  SELECT
    row_number() OVER (ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC) AS timeline_seq,
    tr.occurred_at,
    tr.source,
    tr.operation,
    tr.outcome,
    tr.reason_code,
    tr.event_id,
    tr.actor_id,
    tr.session_id,
    tr.detail
  FROM timeline_rows tr
  WHERE tr.occurred_at IS NOT NULL
  ORDER BY tr.occurred_at ASC, tr.sort_order ASC, tr.operation ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_video_date_snapshot_core(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_computed_deadline_at timestamptz;
  v_deadline_at timestamptz;
  v_allowed text[] := ARRAY[]::text[];
  v_confirmed_encounter boolean := false;
  v_survey_required boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.entry_started_at IS NOT NULL
      OR v_session.entry_started_at IS NOT NULL
      OR v_session.state::text IN ('entry', 'entry') THEN 'entry'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN NULLIF(v_session.phase, '') IN ('ready_gate', 'entry', 'entry', 'date', 'verdict', 'ended')
      THEN CASE WHEN v_session.phase = 'entry' THEN 'entry' ELSE v_session.phase END
    ELSE COALESCE(v_session.state::text, 'ready_gate')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.entry_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'entry' AND kind IN ('entry_auto_promote', 'entry_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_computed_deadline_at := CASE
    WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
    WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.entry_started_at, v_session.state_updated_at) + interval '60 seconds'
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
    WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
    ELSE NULL
  END;

  v_deadline_at := CASE
    WHEN v_phase = 'date' AND v_deadline_row_at IS NOT NULL AND v_computed_deadline_at IS NOT NULL
      THEN GREATEST(v_deadline_row_at, v_computed_deadline_at)
    WHEN v_deadline_row_at IS NOT NULL THEN v_deadline_row_at
    ELSE v_computed_deadline_at
  END;

  v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );
  v_survey_required := CASE
    WHEN v_phase = 'verdict' THEN v_confirmed_encounter
    ELSE public.video_date_session_is_post_date_survey_eligible_v2(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    )
  END;

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict']::text[] ELSE ARRAY[]::text[] END
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'entry' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict', 'report_block']::text[] ELSE ARRAY['report_block']::text[] END
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'eventId', v_session.event_id,
    'seq', COALESCE(v_session.session_seq, 0),
    'serverNow', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    'phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'allowedActions', to_jsonb(v_allowed),
    'surveyRequired', v_survey_required,
    'survey_required', v_survey_required,
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_1_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_2_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_2_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_away_at) * 1000)::bigint END
      )
    ),
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'endedReason', v_session.ended_reason,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health(p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_windows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  WITH windows(window_id, window_label, window_interval) AS (
    VALUES
      ('24h'::text, '24h'::text, interval '24 hours'),
      ('7d'::text, '7d'::text, interval '7 days')
  ),
  session_window AS (
    SELECT
      w.window_id,
      w.window_interval,
      vs.*
    FROM windows w
    JOIN public.video_sessions vs
      ON (
        vs.started_at >= now() - w.window_interval
        OR vs.state_updated_at >= now() - w.window_interval
        OR vs.ended_at >= now() - w.window_interval
        OR vs.ended_at IS NULL
      )
    WHERE p_event_id IS NULL OR vs.event_id = p_event_id
  ),
  session_rollup AS (
    SELECT
      sw.window_id,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
          AND COALESCE(sw.ready_gate_expires_at, sw.started_at + interval '3 minutes') < now()
      )::integer AS stuck_ready_gate_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND (
            COALESCE(sw.phase, '') IN ('entry', 'entry', 'warmup')
            OR sw.state::text IN ('entry', 'entry')
          )
          AND COALESCE(sw.state_updated_at, sw.entry_started_at, sw.started_at) < now() - interval '2 minutes'
      )::integer AS stuck_entry_count,
      count(*) FILTER (
        WHERE sw.ended_at IS NULL
          AND sw.phase = 'date'
          AND sw.date_started_at IS NOT NULL
          AND sw.date_started_at
              + ((COALESCE(sw.duration_seconds, 300)
                  + COALESCE(sw.date_extra_seconds, 0)
                  + 60) * interval '1 second') < now()
      )::integer AS overdue_date_count,
      COALESCE(sum(
        CASE
          WHEN sw.date_started_at IS NOT NULL
           AND sw.ended_at IS NOT NULL
           AND sw.ended_at >= now() - sw.window_interval
           AND public.video_date_session_is_post_date_survey_eligible(
             sw.ended_at,
             sw.ended_reason,
             sw.date_started_at,
             sw.state::text,
             sw.phase,
             sw.participant_1_joined_at,
             sw.participant_2_joined_at
           )
          THEN
            (CASE WHEN NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df
              WHERE df.session_id = sw.id
                AND df.user_id = sw.participant_1_id
            ) THEN 1 ELSE 0 END)
            +
            (CASE WHEN NOT EXISTS (
              SELECT 1
              FROM public.date_feedback df
              WHERE df.session_id = sw.id
                AND df.user_id = sw.participant_2_id
            ) THEN 1 ELSE 0 END)
          ELSE 0
        END
      ), 0)::integer AS pending_survey_recovery_count
    FROM session_window sw
    GROUP BY sw.window_id
  ),
  event_rollup AS (
    SELECT
      w.window_id,
      COALESCE(e.prepare_entry_failure_count, 0)::integer AS prepare_entry_failure_count,
      COALESCE(e.daily_join_failure_count, 0)::integer AS daily_join_failure_count,
      COALESCE(e.client_stuck_observed_count, 0)::integer AS client_stuck_observed_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (
          WHERE eo.operation = 'video_date_launch_latency_checkpoint'
            AND (
              eo.reason_code IN ('prepare_entry_failure', 'prepare_date_entry_failure')
              OR eo.detail->>'checkpoint' IN ('prepare_entry_failure', 'prepare_date_entry_failure')
            )
        )::integer AS prepare_entry_failure_count,
        count(*) FILTER (
          WHERE eo.operation = 'video_date_launch_latency_checkpoint'
            AND (
              eo.reason_code IN ('daily_join_failure', 'daily_call_join_failure')
              OR eo.detail->>'checkpoint' IN ('daily_join_failure', 'daily_call_join_failure')
            )
        )::integer AS daily_join_failure_count,
        count(*) FILTER (
          WHERE eo.operation = 'video_date_client_stuck_state'
        )::integer AS client_stuck_observed_count
      FROM public.event_loop_observability_events eo
      WHERE eo.created_at >= now() - w.window_interval
        AND eo.operation IN (
          'video_date_launch_latency_checkpoint',
          'video_date_client_stuck_state'
        )
        AND (p_event_id IS NULL OR eo.event_id = p_event_id)
    ) e ON true
  ),
  safety_rollup AS (
    SELECT
      w.window_id,
      COALESCE(r.report_count, 0)::integer AS report_count,
      COALESCE(r.pending_report_count, 0)::integer AS pending_report_count,
      COALESCE(r.report_with_block_count, 0)::integer AS report_with_block_count,
      COALESCE(b.block_count, 0)::integer AS block_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS report_count,
        count(*) FILTER (WHERE ur.status = 'pending')::integer AS pending_report_count,
        count(*) FILTER (WHERE COALESCE(ur.also_blocked, false))::integer AS report_with_block_count
      FROM public.user_reports ur
      WHERE ur.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                (vs.participant_1_id = ur.reporter_id AND vs.participant_2_id = ur.reported_id)
                OR (vs.participant_2_id = ur.reporter_id AND vs.participant_1_id = ur.reported_id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.event_registrations er_reporter
            JOIN public.event_registrations er_reported
              ON er_reported.event_id = er_reporter.event_id
             AND er_reported.profile_id = ur.reported_id
            WHERE er_reporter.event_id = p_event_id
              AND er_reporter.profile_id = ur.reporter_id
          )
        )
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS block_count
      FROM public.blocked_users bu
      WHERE bu.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                (vs.participant_1_id = bu.blocker_id AND vs.participant_2_id = bu.blocked_id)
                OR (vs.participant_2_id = bu.blocker_id AND vs.participant_1_id = bu.blocked_id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.event_registrations er_blocker
            JOIN public.event_registrations er_blocked
              ON er_blocked.event_id = er_blocker.event_id
             AND er_blocked.profile_id = bu.blocked_id
            WHERE er_blocker.event_id = p_event_id
              AND er_blocker.profile_id = bu.blocker_id
          )
        )
    ) b ON true
  ),
  webhook_rollup AS (
    SELECT
      w.window_id,
      COALESCE(sum(d.error_rows), 0)::integer AS webhook_dlq_count,
      COALESCE(sum(d.unresolved_rows), 0)::integer AS unresolved_webhook_dlq_count,
      COALESCE(sum(d.retryable_rows), 0)::integer AS retryable_webhook_dlq_count,
      COALESCE(
        jsonb_object_agg(d.error_class, d.error_rows ORDER BY d.error_rows DESC)
          FILTER (WHERE d.error_class IS NOT NULL),
        '{}'::jsonb
      ) AS webhook_dlq_error_classes
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        min(id) AS id,
        error_class,
        count(*)::integer AS error_rows,
        count(*) FILTER (WHERE state IN ('pending', 'retrying'))::integer AS unresolved_rows,
        count(*) FILTER (WHERE retryable)::integer AS retryable_rows
      FROM public.video_date_webhook_dlq dlq
      WHERE dlq.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND vs.daily_room_name IS NOT NULL
              AND vs.daily_room_name = dlq.room_name
          )
        )
      GROUP BY error_class
    ) d ON true
    GROUP BY w.window_id
  ),
  orphan_rollup AS (
    SELECT
      w.window_id,
      COALESCE(o.orphan_room_cleanup_rows, 0)::integer AS orphan_room_cleanup_rows,
      COALESCE(o.orphan_room_cleanup_failed_count, 0)::integer AS orphan_room_cleanup_failed_count,
      COALESCE(o.orphan_room_destructive_candidate_count, 0)::integer AS orphan_room_destructive_candidate_count,
      COALESCE(o.orphan_room_safety_interlock_skip_count, 0)::integer AS orphan_room_safety_interlock_skip_count
    FROM windows w
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS orphan_room_cleanup_rows,
        count(*) FILTER (WHERE oa.action = 'delete_failed')::integer AS orphan_room_cleanup_failed_count,
        count(*) FILTER (WHERE oa.action IN ('delete_candidate', 'deleted', 'dry_run_delete'))::integer AS orphan_room_destructive_candidate_count,
        count(*) FILTER (WHERE oa.action = 'skipped_safety_review')::integer AS orphan_room_safety_interlock_skip_count
      FROM public.video_date_orphan_room_cleanup_audit oa
      WHERE oa.created_at >= now() - w.window_interval
        AND (
          p_event_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.video_sessions vs
            WHERE vs.event_id = p_event_id
              AND (
                vs.id = oa.session_id
                OR (
                  oa.session_id IS NULL
                  AND vs.daily_room_name IS NOT NULL
                  AND vs.daily_room_name = oa.room_name
                )
              )
          )
        )
    ) o ON true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'window_id', w.window_id,
      'window_label', w.window_label,
      'event_id', p_event_id,
      'status', CASE
        WHEN COALESCE(sr.stuck_ready_gate_count, 0)
           + COALESCE(sr.stuck_entry_count, 0)
           + COALESCE(sr.overdue_date_count, 0)
           + COALESCE(wh.unresolved_webhook_dlq_count, 0)
           + COALESCE(orh.orphan_room_cleanup_failed_count, 0) > 0 THEN 'critical'
        WHEN COALESCE(sr.pending_survey_recovery_count, 0)
           + COALESCE(er.prepare_entry_failure_count, 0)
           + COALESCE(er.daily_join_failure_count, 0)
           + COALESCE(er.client_stuck_observed_count, 0)
           + COALESCE(sa.pending_report_count, 0) > 0 THEN 'warning'
        ELSE 'healthy'
      END,
      'stuck_ready_gate_count', COALESCE(sr.stuck_ready_gate_count, 0),
      'stuck_entry_count', COALESCE(sr.stuck_entry_count, 0),
      'stuck_entry_count', COALESCE(sr.stuck_entry_count, 0),
      'overdue_date_count', COALESCE(sr.overdue_date_count, 0),
      'pending_survey_recovery_count', COALESCE(sr.pending_survey_recovery_count, 0),
      'prepare_entry_failure_count', COALESCE(er.prepare_entry_failure_count, 0),
      'daily_join_failure_count', COALESCE(er.daily_join_failure_count, 0),
      'client_stuck_observed_count', COALESCE(er.client_stuck_observed_count, 0),
      'report_count', COALESCE(sa.report_count, 0),
      'pending_report_count', COALESCE(sa.pending_report_count, 0),
      'report_with_block_count', COALESCE(sa.report_with_block_count, 0),
      'block_count', COALESCE(sa.block_count, 0),
      'webhook_dlq_count', COALESCE(wh.webhook_dlq_count, 0),
      'unresolved_webhook_dlq_count', COALESCE(wh.unresolved_webhook_dlq_count, 0),
      'retryable_webhook_dlq_count', COALESCE(wh.retryable_webhook_dlq_count, 0),
      'webhook_dlq_error_classes', COALESCE(wh.webhook_dlq_error_classes, '{}'::jsonb),
      'orphan_room_cleanup_rows', COALESCE(orh.orphan_room_cleanup_rows, 0),
      'orphan_room_cleanup_failed_count', COALESCE(orh.orphan_room_cleanup_failed_count, 0),
      'orphan_room_destructive_candidate_count', COALESCE(orh.orphan_room_destructive_candidate_count, 0),
      'orphan_room_safety_interlock_skip_count', COALESCE(orh.orphan_room_safety_interlock_skip_count, 0)
    )
    ORDER BY CASE w.window_id WHEN '24h' THEN 1 ELSE 2 END
  )
  INTO v_windows
  FROM windows w
  LEFT JOIN session_rollup sr ON sr.window_id = w.window_id
  LEFT JOIN event_rollup er ON er.window_id = w.window_id
  LEFT JOIN safety_rollup sa ON sa.window_id = w.window_id
  LEFT JOIN webhook_rollup wh ON wh.window_id = w.window_id
  LEFT JOIN orphan_rollup orh ON orh.window_id = w.window_id;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'event_id', p_event_id,
    'privacy_contract', jsonb_build_object(
      'scope', 'service_role_only',
      'payload_shape', 'counts_enum_reasons_and_operational_ids_only',
      'excludes', jsonb_build_array(
        'daily_tokens',
        'provider_secrets',
        'auth_headers',
        'profile_text',
        'profile_names',
        'emails',
        'phone_numbers',
        'media_urls',
        'freeform_report_details'
      )
    ),
    'windows', COALESCE(v_windows, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_swipe_20260506090000_stale_room_base(p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active record;
  v_inactive_reason text;
  v_existing_swipe_type text;
  v_existing_swipe_created_at timestamptz;
  v_mutual boolean := false;
  v_session_id uuid;
  v_existing_status text;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_now timestamptz := now();
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('success', false, 'result', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN jsonb_build_object('success', false, 'result', 'invalid_request', 'error', 'invalid_request');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'not_registered', 'error', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, v_now);

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'event_not_active',
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'message', 'This event is no longer active.',
      'notification_suppressed', true,
      'dedupe_reason', 'event_not_active'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_target_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'target_not_found', 'error', 'target_not_found');
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_actor_id, p_target_id) THEN
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'pair_already_met_this_event',
      NULL,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'target_id', p_target_id,
        'swipe_type', p_swipe_type,
        'terminal_encounter_pair', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'pair_already_met_this_event',
      'result', 'pair_already_met_this_event',
      'error', 'pair_already_met_this_event',
      'message', 'You already met this person in this event. Keep browsing for new people.',
      'notification_suppressed', true,
      'dedupe_reason', 'terminal_encounter_pair'
    );
  END IF;

  IF public.is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'result', 'blocked', 'error', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports
    WHERE reporter_id = p_actor_id
      AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'reported', 'error', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'account_paused',
      'result', 'account_paused',
      'error', 'account_paused',
      'message', 'Resume your account before swiping in this event.',
      'notification_suppressed', true
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_actor_id OR z.participant_2_id = p_actor_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'pre_swipe_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'ready_gate_conflict_guard', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_target_id OR z.participant_2_id = p_target_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_active_session_conflict'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_idempotency:' || p_event_id::text || ':' ||
        p_actor_id::text || ':' || p_target_id::text,
      0
    )
  );

  SELECT es.swipe_type, es.created_at
  INTO v_existing_swipe_type, v_existing_swipe_created_at
  FROM public.event_swipes es
  WHERE es.event_id = p_event_id
    AND es.actor_id = p_actor_id
    AND es.target_id = p_target_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_swipe_type IS DISTINCT FROM p_swipe_type THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'swipe_already_recorded',
        'result', 'swipe_already_recorded',
        'error', 'swipe_already_recorded',
        'message', 'You already swiped on this person.',
        'existing_swipe_type', v_existing_swipe_type,
        'requested_swipe_type', p_swipe_type,
        'duplicate', true,
        'idempotent', true,
        'replay', true,
        'notification_suppressed', true,
        'dedupe_reason', 'swipe_type_conflict'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes peer
      WHERE peer.event_id = p_event_id
        AND peer.actor_id = p_target_id
        AND peer.target_id = p_actor_id
        AND peer.swipe_type IN ('vibe', 'super_vibe')
        AND v_existing_swipe_type IN ('vibe', 'super_vibe')
    ) INTO v_mutual;

    IF v_mutual THEN
      SELECT vs.id, vs.ready_gate_status
      INTO v_session_id, v_existing_status
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND vs.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND vs.participant_2_id = GREATEST(p_actor_id, p_target_id)
        AND vs.ended_at IS NULL
      ORDER BY vs.started_at DESC
      LIMIT 1;

      IF v_session_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'outcome', 'already_matched',
          'result', 'already_matched',
          'match_id', v_session_id,
          'video_session_id', v_session_id,
          'event_id', p_event_id,
          'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
          'ready_gate_status', v_existing_status,
          'existing_swipe_type', v_existing_swipe_type,
          'requested_swipe_type', p_swipe_type,
          'duplicate', true,
          'idempotent', true,
          'replay', true,
          'notification_suppressed', true,
          'dedupe_reason', 'existing_match'
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_swiped',
      'result', 'already_swiped',
      'existing_swipe_type', v_existing_swipe_type,
      'requested_swipe_type', p_swipe_type,
      'duplicate', true,
      'idempotent', true,
      'replay', true,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_swipe',
      'swipe_recorded_at', v_existing_swipe_created_at
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'outcome', 'pass_recorded', 'result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'handle_swipe_super_vibe_cap:' || p_event_id::text || ':' || p_actor_id::text,
        0
      )
    );

    SELECT COUNT(*)
    INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'limit_reached', 'result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > v_now - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object(
        'success', true,
        'outcome', 'already_super_vibed_recently',
        'result', 'already_super_vibed_recently'
      );
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_mutual_pair:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_target_id
      AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF NOT v_mutual THEN
    IF p_swipe_type = 'super_vibe' THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'super_vibe_sent', 'result', 'super_vibe_sent');
    END IF;

    RETURN jsonb_build_object('success', true, 'outcome', 'vibe_recorded', 'result', 'vibe_recorded');
  END IF;

  v_t0 := clock_timestamp();

  UPDATE public.event_registrations
  SET
    queue_status = 'browsing',
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = p_actor_id
    AND admission_status = 'confirmed'
    AND (queue_status IS NULL OR queue_status IN ('browsing', 'idle'));

  INSERT INTO public.video_sessions (
    event_id,
    participant_1_id,
    participant_2_id,
    ready_gate_status,
    ready_gate_expires_at
  )
  VALUES (
    p_event_id,
    LEAST(p_actor_id, p_target_id),
    GREATEST(p_actor_id, p_target_id),
    'ready',
    v_now + interval '30 seconds'
  )
  ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    SELECT id, ready_gate_status
    INTO v_session_id, v_existing_status
    FROM public.video_sessions
    WHERE event_id = p_event_id
      AND participant_1_id = LEAST(p_actor_id, p_target_id)
      AND participant_2_id = GREATEST(p_actor_id, p_target_id)
      AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'pair_already_met_this_event',
        'result', 'pair_already_met_this_event',
        'error', 'pair_already_met_this_event',
        'message', 'You already met this person in this event. Keep browsing for new people.',
        'notification_suppressed', true,
        'dedupe_reason', 'same_event_pair_not_reopenable'
      );
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = CASE
        WHEN v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN 'in_ready_gate'
        ELSE queue_status
      END,
      current_room_id = v_session_id,
      current_partner_id = CASE
        WHEN profile_id = p_actor_id THEN p_target_id
        ELSE p_actor_id
      END,
      last_active_at = v_now
    WHERE event_id = p_event_id
      AND profile_id IN (p_actor_id, p_target_id)
      AND (queue_status IS NULL OR queue_status NOT IN ('in_handshake', 'in_date', 'in_survey'));

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'no_op',
      'already_matched',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'ready_gate_status', v_existing_status
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_matched',
      'result', 'already_matched',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id,
      'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
      'ready_gate_status', v_existing_status,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_match'
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_session_id,
    current_partner_id = CASE
      WHEN profile_id = p_actor_id THEN p_target_id
      ELSE p_actor_id
    END,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id IN (p_actor_id, p_target_id);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'handle_swipe',
    'success',
    'match_immediate',
    v_ms,
    p_event_id,
    p_actor_id,
    v_session_id,
    jsonb_build_object(
      'swipe_type', p_swipe_type,
      'mutual', true,
      'immediate', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'match',
    'result', 'match',
    'match_id', v_session_id,
    'video_session_id', v_session_id,
    'event_id', p_event_id,
    'immediate', true,
    'ready_gate_status', 'ready'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_swipe_20260507190000_tier_authority_base(p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active record;
  v_now timestamptz := now();
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, v_now);

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_target_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_actor_id, p_target_id)
     OR public.is_blocked(p_actor_id, p_target_id)
     OR public.is_profile_hidden(p_actor_id)
     OR NOT public.is_profile_discoverable(p_target_id, p_actor_id)
     OR EXISTS (
       SELECT 1
       FROM public.user_reports
       WHERE reporter_id = p_actor_id
         AND reported_id = p_target_id
     ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE NOT (
        z.event_id = p_event_id
        AND z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_actor_id OR z.participant_2_id = p_actor_id)
      AND public.video_session_blocks_global_active_conflict(
        z.event_id,
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at,
        z.ready_gate_expires_at,
        z.snooze_expires_at,
        z.prepare_entry_expires_at,
        z.participant_1_joined_at,
        z.participant_2_joined_at
      )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'pre_swipe_global_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'stale_ready_gate_room_blockers_ignored', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE NOT (
        z.event_id = p_event_id
        AND z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_target_id OR z.participant_2_id = p_target_id)
      AND public.video_session_blocks_global_active_conflict(
        z.event_id,
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.entry_started_at,
        z.date_started_at,
        z.ended_at,
        z.ready_gate_expires_at,
        z.snooze_expires_at,
        z.prepare_entry_expires_at,
        z.participant_1_joined_at,
        z.participant_2_joined_at
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_active_session_conflict'
    );
  END IF;

  RETURN public.handle_swipe_20260506090000_stale_room_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_row public.video_sessions%ROWTYPE;
  v_event_id uuid;
  v_eligibility jsonb := '{}'::jsonb;
  v_provider jsonb := '{}'::jsonb;
  v_provider_session_id text := NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), '');
  v_owner_state text := COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, 'joined')), 80), ''), 'joined');
  v_payload jsonb;
  v_result jsonb;
  v_enriched jsonb;
  v_promotion jsonb := '{}'::jsonb;
  v_reason_code text;
  v_observed boolean := false;
  -- heartbeat worker state (formerly the 20260607155414 lifecycle base)
  v_now timestamptz;
  v_status text;
  v_routeable boolean := false;
  v_started_entry boolean := false;
  v_reconnect_grace_cleared boolean := false;
  v_latest_provider_event_type text;
  v_latest_provider_event_at timestamptz;
  v_latest_provider_session_id text;
  v_provider_backed_current boolean := false;
  v_provider_presence jsonb := '{}'::jsonb;
  v_join_stamp_accepted boolean := false;
  v_presence_event_recorded boolean := false;
  v_noop_observability_recorded boolean := false;
  v_presence_throttle interval;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    -- ── Lifecycle eligibility precheck (formerly the hot base). ──
    v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
      v_payload := v_eligibility || jsonb_build_object(
        'rpc', 'mark_video_date_daily_alive',
        'provider_presence_required', true,
        'provider_backed_current', false,
        'provider_presence_missing', true,
        'join_stamp_accepted', false,
        'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
        'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
        'provider_session_id', v_provider_session_id,
        'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
        'owner_state', v_owner_state,
        'lifecycle_eligibility_checked', true
      );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    SELECT vs.event_id INTO v_event_id
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    -- ── Current-provider-session proof precheck (formerly the hot base):
    -- proof-missing calls are structured ok:true no-ops, never stamps. ──
    v_provider := public.video_date_current_provider_session_proof_v1(
      p_session_id,
      v_actor,
      v_provider_session_id,
      v_owner_state,
      'mark_video_date_daily_alive'
    );

    IF COALESCE((v_provider->>'ok')::boolean, false) IS NOT TRUE THEN
      v_reason_code := COALESCE(v_provider->>'code', 'DAILY_JOIN_PROVIDER_PROOF_MISSING');

      BEGIN
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          CASE
            WHEN COALESCE((v_provider->>'provider_presence_terminal')::boolean, false)
              THEN 'daily_alive_provider_session_left'
            ELSE 'daily_alive_provider_join_pending'
          END,
          NULL,
          v_event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', v_provider_session_id,
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', v_owner_state,
            'provider_proof', v_provider,
            'join_stamp_accepted', false,
            'lifecycle_eligibility_checked', true,
            'retryable', COALESCE((v_provider->>'retryable')::boolean, true),
            'rejection_code', v_reason_code
          )
        );
        v_observed := true;
      EXCEPTION
        WHEN OTHERS THEN
          v_observed := false;
      END;

      v_payload := v_provider
        || jsonb_build_object(
          'ok', true,
          'success', true,
          'rpc', 'mark_video_date_daily_alive',
          'error', lower(v_reason_code),
          'code', v_reason_code,
          'error_code', v_reason_code,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true,
          'join_stamp_accepted', false,
          'waiting_for_stable_copresence', true,
          'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
          'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
          'provider_session_id', v_provider_session_id,
          'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
          'owner_state', v_owner_state,
          'lifecycle_eligibility_checked', true,
          'provider_join_webhook_required', true,
          'provider_proof_observed', v_observed
        );

      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        v_payload
      ) || jsonb_build_object('hot_path_no_throw_shell', true);
    END IF;

    -- ── Heartbeat worker (formerly the 20260607155414 lifecycle base). ──
    BEGIN
      v_now := clock_timestamp();

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object(
          'ok', false,
          'error', 'unauthorized',
          'retryable', false
        );
      ELSE
        SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
        IF NOT FOUND THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'not_found',
            'retryable', false
          );
        ELSIF v_actor IS DISTINCT FROM v_row.participant_1_id
          AND v_actor IS DISTINCT FROM v_row.participant_2_id THEN
          v_result := jsonb_build_object(
            'ok', false,
            'error', 'forbidden',
            'retryable', false
          );
        ELSIF v_row.ended_at IS NOT NULL THEN
          UPDATE public.video_date_surface_claims
          SET released_at = COALESCE(released_at, v_now),
              updated_at = v_now
          WHERE profile_id = v_actor
            AND session_id = p_session_id
            AND surface = 'video_date'
            AND released_at IS NULL;

          v_result := jsonb_build_object(
            'ok', false,
            'error', 'session_ended',
            'retryable', false,
            'terminal', true,
            'queue_status', 'in_survey',
            'ended_at', v_row.ended_at,
            'ended_reason', v_row.ended_reason,
            'surface_claim_released', true
          );
        ELSE
          v_routeable :=
            v_row.ready_gate_status = 'both_ready'
            AND (
              v_row.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
              OR v_row.phase IN ('entry', 'date')
              OR v_row.entry_started_at IS NOT NULL
              OR v_row.date_started_at IS NOT NULL
            );

          IF NOT v_routeable THEN
            v_result := jsonb_build_object(
              'ok', false,
              'error', 'not_routeable',
              'retryable', true,
              'retry_after_ms', 750,
              'ready_gate_status', v_row.ready_gate_status,
              'state', v_row.state,
              'phase', v_row.phase
            );
          ELSE
            SELECT
              vde.event_type,
              vde.occurred_at,
              public.video_date_daily_provider_session_id_from_event_v1(
                vde.provider_participant_id,
                vde.payload
              )
            INTO
              v_latest_provider_event_type,
              v_latest_provider_event_at,
              v_latest_provider_session_id
            FROM public.video_date_daily_webhook_events vde
            WHERE vde.session_id = p_session_id
              AND vde.provider_user_id = v_actor::text
              AND vde.event_type IN ('participant.joined', 'participant.left')
            ORDER BY vde.occurred_at DESC NULLS LAST, vde.created_at DESC
            LIMIT 1;

            v_provider_backed_current :=
              v_owner_state = 'joined'
              AND v_provider_session_id IS NOT NULL
              AND (
                v_latest_provider_event_type IS NULL
                OR (
                  v_latest_provider_event_type = 'participant.joined'
                  AND v_latest_provider_session_id = v_provider_session_id
                )
                OR (
                  v_latest_provider_event_type = 'participant.left'
                  AND v_latest_provider_session_id IS NOT NULL
                  AND v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id
                )
              );

            v_presence_throttle := CASE
              WHEN v_provider_backed_current THEN interval '6 seconds'
              ELSE interval '30 seconds'
            END;

            IF NOT EXISTS (
              SELECT 1
              FROM public.video_date_presence_events vpe
              WHERE vpe.session_id = p_session_id
                AND vpe.actor_id = v_actor
                AND vpe.event_type = 'client_daily_alive'
                AND vpe.provider_session_id IS NOT DISTINCT FROM v_provider_session_id
                AND vpe.owner_state IS NOT DISTINCT FROM v_owner_state
                AND vpe.occurred_at >= v_now - v_presence_throttle
              LIMIT 1
            ) THEN
              INSERT INTO public.video_date_presence_events (
                session_id,
                actor_id,
                source,
                event_type,
                owner_id,
                call_instance_id,
                provider_session_id,
                entry_attempt_id,
                owner_state,
                occurred_at,
                details
              ) VALUES (
                p_session_id,
                v_actor,
                'mark_video_date_daily_alive',
                'client_daily_alive',
                NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                v_provider_session_id,
                NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                v_owner_state,
                v_now,
                jsonb_build_object(
                  'rpc', 'mark_video_date_daily_alive',
                  'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                  'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                  'provider_session_id', v_provider_session_id,
                  'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                  'owner_state', v_owner_state,
                  'provider_presence_required', true,
                  'provider_backed_current', v_provider_backed_current,
                  'join_stamp_accepted', v_provider_backed_current,
                  'latest_provider_event_type', v_latest_provider_event_type,
                  'latest_provider_event_at', v_latest_provider_event_at,
                  'latest_provider_session_id', v_latest_provider_session_id,
                  'provider_participant_id_source', 'provider_participant_id_or_payload',
                  'throttle_window_seconds', EXTRACT(EPOCH FROM v_presence_throttle)::integer
                )
              );
              v_presence_event_recorded := true;
            END IF;

            IF NOT v_provider_backed_current THEN
              IF NOT EXISTS (
                SELECT 1
                FROM public.event_loop_observability_events el
                WHERE el.operation = 'video_date_transition'
                  AND el.session_id = p_session_id
                  AND el.actor_id = v_actor
                  AND el.reason_code = 'daily_alive_without_current_provider_presence'
                  AND el.created_at >= v_now - interval '30 seconds'
                LIMIT 1
              ) THEN
                PERFORM public.record_event_loop_observability(
                  'video_date_transition',
                  'no_op',
                  'daily_alive_without_current_provider_presence',
                  NULL,
                  v_row.event_id,
                  v_actor,
                  p_session_id,
                  jsonb_build_object(
                    'action', 'mark_video_date_daily_alive',
                    'owner_state', v_owner_state,
                    'provider_session_id', v_provider_session_id,
                    'provider_presence_required', true,
                    'latest_provider_event_type', v_latest_provider_event_type,
                    'latest_provider_event_at', v_latest_provider_event_at,
                    'latest_provider_session_id', v_latest_provider_session_id,
                    'provider_participant_id_source', 'provider_participant_id_or_payload',
                    'throttled', true
                  )
                );
                v_noop_observability_recorded := true;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_handshake'
              END;

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', false,
                'waiting_for_stable_copresence', true,
                'retry_after_ms', 3000,
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence_required', true,
                'provider_backed_current', false,
                'presence_event_recorded', v_presence_event_recorded,
                'noop_observability_recorded', v_noop_observability_recorded,
                'latest_provider_event_type', v_latest_provider_event_type,
                'latest_provider_event_at', v_latest_provider_event_at,
                'latest_provider_session_id', v_latest_provider_session_id,
                'provider_presence_missing', true,
                'provider_presence_terminal', v_latest_provider_event_type = 'participant.left',
                'join_stamp_accepted', false,
                'stable_copresence_required', true
              );
            ELSE
              v_reconnect_grace_cleared := v_row.reconnect_grace_ends_at IS NOT NULL;

              IF v_actor = v_row.participant_1_id THEN
                UPDATE public.video_sessions
                SET
                  participant_1_joined_at = COALESCE(participant_1_joined_at, v_now),
                  participant_1_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_1_joined_at IS NULL
                      OR participant_1_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              ELSE
                UPDATE public.video_sessions
                SET
                  participant_2_joined_at = COALESCE(participant_2_joined_at, v_now),
                  participant_2_away_at = NULL,
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = CASE
                    WHEN participant_2_joined_at IS NULL
                      OR participant_2_away_at IS NOT NULL
                      OR reconnect_grace_ends_at IS NOT NULL
                    THEN v_now
                    ELSE state_updated_at
                  END
                WHERE id = p_session_id;
              END IF;
              v_join_stamp_accepted := true;

              SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

              v_stable := public.video_date_stable_copresence_v1(p_session_id);
              v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
              v_participant_1_active := COALESCE((v_stable->>'participant_1_active')::boolean, false);
              v_participant_2_active := COALESCE((v_stable->>'participant_2_active')::boolean, false);
              v_provider_presence := CASE
                WHEN v_actor = v_row.participant_1_id THEN v_stable->'participant_1_provider_presence'
                ELSE v_stable->'participant_2_provider_presence'
              END;

              IF v_row.date_started_at IS NULL
                 AND v_row.entry_started_at IS NULL
                 AND v_stable_copresence THEN
                UPDATE public.video_sessions
                SET
                  entry_started_at = v_now,
                  state = 'entry'::public.video_date_state,
                  phase = 'entry',
                  reconnect_grace_ends_at = NULL,
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND date_started_at IS NULL
                  AND entry_started_at IS NULL
                RETURNING * INTO v_row;

                IF FOUND THEN
                  v_started_entry := true;
                  PERFORM public.record_event_loop_observability(
                    'video_date_transition',
                    'success',
                    'entry_started_after_stable_daily_alive',
                    NULL,
                    v_row.event_id,
                    v_actor,
                    p_session_id,
                    jsonb_build_object(
                      'action', 'mark_video_date_daily_alive',
                      'stable_copresence', v_stable,
                      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                      'provider_session_id', v_provider_session_id,
                      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                      'provider_presence_required', true,
                      'stable_copresence_required', true
                    )
                  );
                ELSE
                  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
                END IF;
              END IF;

              v_status := CASE
                WHEN v_row.date_started_at IS NOT NULL
                  OR v_row.state = 'date'::public.video_date_state
                  OR v_row.phase = 'date'
                  THEN 'in_date'
                ELSE 'in_handshake'
              END;

              UPDATE public.event_registrations
              SET
                queue_status = v_status,
                current_room_id = p_session_id,
                current_partner_id = CASE
                  WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                  ELSE v_row.participant_1_id
                END,
                last_active_at = v_now
              WHERE event_id = v_row.event_id
                AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
                AND (
                  queue_status IS DISTINCT FROM v_status
                  OR current_room_id IS DISTINCT FROM p_session_id
                  OR current_partner_id IS DISTINCT FROM CASE
                    WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
                    ELSE v_row.participant_1_id
                  END
                  OR last_active_at < v_now - interval '15 seconds'
                  OR last_active_at IS NULL
                );

              v_result := jsonb_build_object(
                'ok', true,
                'queue_status', v_status,
                'entry_started', v_started_entry,
                'entry_started_at', v_row.entry_started_at,
                'waiting_for_stable_copresence', COALESCE((v_stable->>'waiting_for_stable_copresence')::boolean, false),
                'stable_copresence', v_stable,
                'retry_after_ms', COALESCE((v_stable->>'retry_after_ms')::integer, 0),
                'latest_joined_at', CASE
                  WHEN v_actor = v_row.participant_1_id THEN v_row.participant_1_joined_at
                  ELSE v_row.participant_2_joined_at
                END,
                'latest_owner_heartbeat_at', v_stable->>'latest_owner_heartbeat_at',
                'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
                'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
                'provider_session_id', v_provider_session_id,
                'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
                'owner_state', v_owner_state,
                'provider_presence', v_provider_presence,
                'provider_presence_required', true,
                'provider_backed_current', v_provider_backed_current,
                'presence_event_recorded', v_presence_event_recorded,
                'join_stamp_accepted', v_join_stamp_accepted,
                'reconnect_grace_cleared', v_reconnect_grace_cleared AND v_join_stamp_accepted,
                'participant_1_joined_at', v_row.participant_1_joined_at,
                'participant_1_away_at', v_row.participant_1_away_at,
                'participant_1_active', v_participant_1_active,
                'participant_2_joined_at', v_row.participant_2_joined_at,
                'participant_2_away_at', v_row.participant_2_away_at,
                'participant_2_active', v_participant_2_active,
                'stable_copresence_required', true
              );
            END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;

        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            'mark_video_date_daily_alive.single_body_core',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
        v_result := jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'daily_alive_stamp_failed',
          'code', 'DAILY_ALIVE_STAMP_FAILED',
          'error_code', 'DAILY_ALIVE_STAMP_FAILED',
          'retryable', true,
          'retry_after_ms', 1500,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    END;

    -- ── Promotion + enrichment pipeline (formerly the definitive,
    -- last-resort, remote_seen and strict/hot wrapper bases). ──
    v_enriched := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);

    IF COALESCE((v_enriched->>'retryable')::boolean, true)
       OR COALESCE((v_enriched->>'ok')::boolean, false) THEN
      v_promotion := public.video_date_promote_provider_overlap_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'provider_backed_alive',
        true
      );
    END IF;

    v_result := v_enriched || jsonb_build_object(
      'provider_overlap_promotion', v_promotion,
      'provider_overlap_promoted_to_date', COALESCE((v_promotion->>'provider_overlap_promoted_to_date')::boolean, false),
      'promotion_reason', COALESCE(v_promotion->>'reason', v_enriched->>'promotion_reason')
    );

    v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
    v_result := public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
    v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
      p_session_id,
      v_actor,
      'mark_video_date_daily_alive',
      v_result
    );

    v_result := v_result || jsonb_build_object(
      'strict_provider_join_proof_checked', true,
      'provider_join_webhook_required', true,
      'provider_proof', v_provider,
      'lifecycle_eligibility_checked', true
    );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'mark_video_date_daily_alive.single_body',
          'daily_alive_stamp_failed',
          'DAILY_ALIVE_STAMP_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- Last resort stays sanitized retryable JSON: no raw sqlstate /
          -- sql_message in authenticated client payloads.
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
            'error', 'daily_alive_failed',
            'reason', 'daily_alive_failed',
            'code', 'DAILY_ALIVE_FAILED',
            'error_code', 'DAILY_ALIVE_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'outer_last_resort_payload', true,
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_ready_gate_suppression_v2(p_session_id uuid, p_suppressed_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT
    id,
    event_id,
    participant_1_id,
    participant_2_id,
    ended_at,
    state,
    phase,
    ready_gate_status,
    entry_started_at,
    date_started_at
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  IF v_session.entry_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.state::text IN ('entry', 'date')
     OR v_session.phase IN ('entry', 'date')
     OR (v_session.state::text IS DISTINCT FROM 'ready_gate' AND COALESCE(v_session.phase, '') IS DISTINCT FROM 'ready_gate')
     OR COALESCE(v_session.ready_gate_status, '') NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready_gate');
  END IF;

  v_until := COALESCE(p_suppressed_until, now() + interval '45 seconds');
  IF v_until <= now() THEN
    v_until := now() + interval '45 seconds';
  END IF;
  v_until := LEAST(v_until, now() + interval '5 minutes');

  UPDATE public.event_registrations
  SET
    ready_gate_suppressed_until = CASE
      WHEN ready_gate_suppressed_session_id = p_session_id THEN GREATEST(
        COALESCE(ready_gate_suppressed_until, '-infinity'::timestamptz),
        v_until
      )
      ELSE v_until
    END,
    ready_gate_suppressed_session_id = p_session_id,
    current_room_id = CASE
      WHEN current_room_id = p_session_id AND queue_status = 'in_ready_gate' THEN NULL
      ELSE current_room_id
    END,
    queue_status = CASE
      WHEN current_room_id = p_session_id AND queue_status = 'in_ready_gate' THEN 'browsing'
      ELSE queue_status
    END,
    updated_at = now()
  WHERE event_id = v_session.event_id
    AND profile_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'suppressed_until', v_until
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
-- ready_gate_transition.single_body_core (rebuild PR 4). mark_ready bridges to
-- video_session_mark_ready_v2; the inner machine owns sync/snooze/forfeit.
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_restored public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_cleanup jsonb;
  v_status text;
  v_terminal boolean := false;
  v_inactive_reason text;
  v_date_capable boolean := false;
  v_core_decided boolean := false;
  v_is_p1 boolean := false;
  v_success boolean := false;
  v_status_after text;
  v_outcome text;
  v_reason_code text;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_p1_ready_gate boolean := false;
  v_p2_ready_gate boolean := false;
  v_missing_participant_registration text := NULL;
  v_repair_count integer := 0;
  v_row_count integer := 0;
  v_server_now_ms bigint;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── mark_ready bridge: every spelling routes to the idempotent v2 command;
  -- the machine below never sees mark_ready. ──
  IF v_action = 'mark_ready' THEN
    RETURN public.video_session_mark_ready_v2(
      p_session_id,
      p_session_id::text || ':phase3:mark_ready:legacy_ready_gate_transition',
      NULL
    ) || jsonb_build_object('legacy_ready_gate_transition_bridge', true);
  END IF;

  -- ── sync fast path A: startup-snapshot-backed, live participant-owned
  -- gates only; both_ready is expiry-exempt. ──
  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
       AND (
         v_session.ready_gate_expires_at IS NULL
         OR v_session.ready_gate_expires_at > now()
         OR v_session.ready_gate_status = 'both_ready'
       )
       AND (
         v_session.ready_gate_status <> 'snoozed'
         OR v_session.snooze_expires_at IS NULL
         OR v_session.snooze_expires_at > now()
       ) THEN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

      IF NULLIF(COALESCE(v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'), '') IS NULL THEN
        v_status := COALESCE(
          v_snapshot->>'ready_gate_status',
          v_snapshot->>'status',
          'unknown'
        );

        RETURN COALESCE(v_snapshot, '{}'::jsonb) || jsonb_build_object(
          'success', COALESCE((v_snapshot->>'ok')::boolean, false),
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'startup_snapshot', v_snapshot
        );
      END IF;
    END IF;
  END IF;

  -- ── Inner machine. Statement timeouts / lock contention inside it produce
  -- the pinned retryable READY_GATE_TRANSITION_TIMEOUT payload. ──
  BEGIN
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    -- ── sync fast path B: queued-inclusive direct-row snapshot when the
    -- event is still active (former start_snapshot base). ──
    IF p_action = 'sync' AND v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
         AND v_session.ended_at IS NULL
         AND v_session.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
         AND (
           v_session.ready_gate_expires_at IS NULL
           OR v_session.ready_gate_expires_at > now()
           OR v_session.ready_gate_status = 'both_ready'
         )
         AND (
           v_session.ready_gate_status <> 'snoozed'
           OR v_session.snooze_expires_at IS NULL
           OR v_session.snooze_expires_at > now()
         ) THEN
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NULL THEN
          RETURN jsonb_build_object(
            'ok', true,
            'success', true,
            'status', v_session.ready_gate_status,
            'ready_gate_status', v_session.ready_gate_status,
            'result_status', v_session.ready_gate_status,
            'result_ready_gate_status', v_session.ready_gate_status,
            'state', v_session.state,
            'phase', v_session.phase,
            'event_id', v_session.event_id,
            'participant_1_id', v_session.participant_1_id,
            'participant_2_id', v_session.participant_2_id,
            'ready_participant_1_at', v_session.ready_participant_1_at,
            'ready_participant_2_at', v_session.ready_participant_2_at,
            'ready_gate_expires_at', v_session.ready_gate_expires_at,
            'snoozed_by', v_session.snoozed_by,
            'snooze_expires_at', v_session.snooze_expires_at,
            'daily_room_name', v_session.daily_room_name,
            'daily_room_url', v_session.daily_room_url,
            'session_seq', v_session.session_seq,
            'terminal', false,
            'snapshot', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        END IF;
      END IF;

      v_inactive_reason := NULL;
    END IF;

    -- ── Pre-ready room-metadata repair (former rgt_preserve_warmup pre-pass):
    -- a pre-both_ready gate must not carry Daily room metadata into a
    -- transition-sensitive action. ──
    IF v_actor IS NOT NULL AND p_action IN ('mark_ready', 'snooze') THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
         AND v_session.ended_at IS NULL
         AND v_session.state = 'ready_gate'::public.video_date_state
         AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
         AND v_session.entry_started_at IS NULL
         AND v_session.date_started_at IS NULL
         AND v_session.participant_1_joined_at IS NULL
         AND v_session.participant_2_joined_at IS NULL
         AND (
           v_session.daily_room_name IS NOT NULL
           OR v_session.daily_room_url IS NOT NULL
           OR v_session.daily_room_verified_at IS NOT NULL
           OR v_session.daily_room_expires_at IS NOT NULL
           OR v_session.daily_room_provider_verify_reason IS NOT NULL
         ) THEN
        UPDATE public.video_sessions
        SET
          daily_room_name = NULL,
          daily_room_url = NULL,
          daily_room_verified_at = NULL,
          daily_room_expires_at = NULL,
          daily_room_provider_verify_reason = NULL,
          state_updated_at = now()
        WHERE id = p_session_id
          AND ended_at IS NULL
          AND state = 'ready_gate'::public.video_date_state
          AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
          AND entry_started_at IS NULL
          AND date_started_at IS NULL
          AND participant_1_joined_at IS NULL
          AND participant_2_joined_at IS NULL
          AND (
            daily_room_name IS NOT NULL
            OR daily_room_url IS NOT NULL
            OR daily_room_verified_at IS NOT NULL
            OR daily_room_expires_at IS NOT NULL
            OR daily_room_provider_verify_reason IS NOT NULL
          )
        RETURNING * INTO v_session;

        GET DIAGNOSTICS v_repair_count = ROW_COUNT;

        IF v_repair_count > 0 THEN
          PERFORM public.record_event_loop_observability(
            'ready_gate_transition',
            'success',
            'pre_ready_room_metadata_repaired',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', p_action,
              'p_reason', p_reason,
              'repaired_daily_room_metadata', true
            )
          );
        END IF;
      END IF;
    END IF;

    -- ── Event-inactive ownership under the locked session row (former
    -- rgt_pre_ready_room_meta). Natural live-window expiry has no event-row
    -- trigger, so participant sync/snooze actions detect it here. ──
    IF p_action IN ('sync', 'mark_ready', 'snooze') AND v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NOT NULL THEN
          v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          v_date_capable := (
            v_session.entry_started_at IS NOT NULL
            OR v_session.date_started_at IS NOT NULL
            OR v_session.daily_room_name IS NOT NULL
            OR v_session.daily_room_url IS NOT NULL
            OR v_session.participant_1_joined_at IS NOT NULL
            OR v_session.participant_2_joined_at IS NOT NULL
            OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
            OR COALESCE(v_session.phase, '') IN ('entry', 'date')
          );

          IF v_session.ended_at IS NOT NULL OR v_session.ready_gate_status = 'expired' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'reason', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'inactive_reason', v_inactive_reason,
              'error_code', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'terminal', true,
              'event_id', v_session.event_id
            );
          ELSIF p_action = 'sync' OR v_date_capable THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'date_capable', v_date_capable,
              'terminal', false,
              'event_id', v_session.event_id,
              'cleanup', v_cleanup
            );
          ELSE
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'blocked',
              'READY_GATE_EVENT_ENDED',
              NULL,
              v_session.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'inactive_reason', v_inactive_reason,
                'cleanup', v_cleanup
              )
            );

            v_result := jsonb_build_object(
              'success', false,
              'error', 'event_not_active',
              'code', 'EVENT_NOT_ACTIVE',
              'error_code', 'EVENT_NOT_ACTIVE',
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'terminal', false,
              'event_id', v_session.event_id
            );
          END IF;

          v_core_decided := true;
        END IF;
      END IF;
    END IF;

    -- ── Core machine (former event_inactive base) for sync/snooze/forfeit/
    -- unknown actions when the event is active. ──
    IF NOT v_core_decided THEN
      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'error', 'unauthorized');
      ELSE
        PERFORM public.expire_stale_video_sessions();

        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
        ELSE
          v_is_p1 := (v_session.participant_1_id = v_actor);
          IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
            v_result := jsonb_build_object('success', false, 'error', 'access_denied');
          ELSIF p_action = 'sync' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'terminal', v_session.ended_at IS NOT NULL
                OR v_session.ready_gate_status IN ('forfeited', 'expired')
            );
          ELSE
            -- Expiry is re-checked under the locked row for transition-
            -- sensitive actions. This closes the race where cleanup ran just
            -- before the gate elapsed, but the user action reached the RPC
            -- immediately afterward. (mark_ready never reaches this machine;
            -- the literal guard is kept for the pinned contract shape.)
            IF p_action IN ('mark_ready', 'snooze')
               AND v_session.ended_at IS NULL
               AND v_session.state = 'ready_gate'::public.video_date_state
               AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
               AND v_session.ready_gate_expires_at IS NOT NULL
               AND v_session.ready_gate_expires_at <= v_now THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'expired',
                state = 'ended',
                phase = 'ended',
                ended_at = v_now,
                ended_reason = 'ready_gate_expired',
                snoozed_by = NULL,
                snooze_expires_at = NULL,
                duration_seconds = COALESCE(
                  duration_seconds,
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND state = 'ready_gate'::public.video_date_state
                AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
                AND ready_gate_expires_at IS NOT NULL
                AND ready_gate_expires_at <= v_now
                AND date_started_at IS NULL
                AND entry_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count > 0 THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'expired',
                  'ready_gate_status', 'expired',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', 'ready_gate_expired',
                  'error_code', 'ready_gate_expired',
                  'terminal', true
                );
              ELSE
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'stale_transition',
                    'error_code', 'stale_transition',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'guarded_update_zero_rows',
                    'terminal', false
                  );
                END IF;
              END IF;
            ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
              v_result := jsonb_build_object(
                'success', true,
                'status', v_session.ready_gate_status,
                'ready_gate_status', v_session.ready_gate_status,
                'ready_gate_expires_at', v_session.ready_gate_expires_at,
                'terminal', true
              );
            ELSIF p_action = 'snooze' THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'snoozed',
                snoozed_by = v_actor,
                snooze_expires_at = v_now + interval '2 minutes',
                ready_gate_expires_at = v_now + interval '2 minutes',
                state = 'ready_gate',
                phase = 'ready_gate',
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND state = 'ready_gate'::public.video_date_state
                AND entry_started_at IS NULL
                AND date_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'conflict',
                    'error_code', 'guarded_update_zero_rows',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'session_no_longer_ready_gate_mutable',
                    'terminal', false
                  );
                END IF;
              ELSE
                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'snoozed',
                  'ready_gate_status', 'snoozed',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'snoozed_by', v_session.snoozed_by,
                  'snooze_expires_at', v_session.snooze_expires_at,
                  'terminal', false
                );
              END IF;
            ELSIF p_action = 'forfeit' THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'forfeited',
                ready_gate_expires_at = v_now,
                snoozed_by = NULL,
                snooze_expires_at = NULL,
                state = 'ended',
                phase = 'ended',
                ended_at = COALESCE(ended_at, v_now),
                ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ready_gate_status NOT IN ('forfeited', 'expired', 'both_ready')
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSE
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL
                  );
                END IF;
              ELSE
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'forfeited',
                  'ready_gate_status', 'forfeited',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', COALESCE(p_reason, 'ready_gate_forfeit'),
                  'terminal', true
                );
              END IF;
            ELSE
              v_result := jsonb_build_object('success', false, 'error', 'unknown_action');
            END IF;
          END IF;
        END IF;
      END IF;

      -- ── Core observability: every machine call records a before/after
      -- comparison row. ──
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_success := COALESCE(v_result @> '{"success": true}'::jsonb, false);
      v_status_after := COALESCE(v_after.ready_gate_status, v_result->>'ready_gate_status', v_result->>'status');

      v_reason_code := CASE
        WHEN NOT v_success THEN COALESCE(v_result->>'error_code', v_result->>'error', v_result->>'code', 'unknown_error')
        WHEN p_action = 'sync' AND v_status_after = 'expired' THEN 'sync_expired'
        WHEN p_action = 'sync' THEN 'sync'
        WHEN p_action IN ('mark_ready', 'snooze') AND COALESCE(v_result->>'reason', '') = 'ready_gate_expired' THEN 'ready_gate_expired'
        WHEN p_action = 'snooze' THEN 'snooze'
        WHEN p_action = 'forfeit' THEN 'forfeit'
        ELSE COALESCE(p_action, 'unknown_action')
      END;

      v_outcome := CASE
        WHEN v_success THEN 'success'
        WHEN v_reason_code IN ('unauthorized', 'session_not_found', 'access_denied', 'unknown_action') THEN 'blocked'
        ELSE 'error'
      END;

      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        v_outcome,
        v_reason_code,
        NULL,
        COALESCE(v_after.event_id, v_before.event_id),
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
          'success', v_success,
          'result_status', v_result->>'status',
          'result_error', v_result->>'error',
          'result_error_code', v_result->>'error_code',
          'result_reason', v_result->>'reason',
          'status_before', v_before.ready_gate_status,
          'status_after', v_status_after,
          'state_before', v_before.state::text,
          'state_after', v_after.state::text,
          'phase_before', v_before.phase,
          'phase_after', v_after.phase,
          'ready_gate_expires_at_before', v_before.ready_gate_expires_at,
          'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
          'ready_participant_1_at_before', v_before.ready_participant_1_at,
          'ready_participant_1_at_after', v_after.ready_participant_1_at,
          'ready_participant_2_at_before', v_before.ready_participant_2_at,
          'ready_participant_2_at_after', v_after.ready_participant_2_at,
          'snoozed_by_before', v_before.snoozed_by,
          'snoozed_by_after', v_after.snoozed_by,
          'snooze_expires_at_before', v_before.snooze_expires_at,
          'snooze_expires_at_after', v_after.snooze_expires_at,
          'ended_reason_after', v_after.ended_reason,
          'row_count_checked', true,
          'observed_at', now()
        )
      );
    END IF;

    -- ── Canonical-truth enrichment (former rgt_preserve_warmup post-merge):
    -- participant-safe session truth rides on every machine result. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE v_session.ended_at IS NOT NULL
            OR v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
        END;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
          'event_id', v_session.event_id,
          'participant_1_id', v_session.participant_1_id,
          'participant_2_id', v_session.participant_2_id,
          'ready_participant_1_at', v_session.ready_participant_1_at,
          'ready_participant_2_at', v_session.ready_participant_2_at,
          'status', v_status,
          'ready_gate_status', v_status,
          'ready_gate_expires_at', v_session.ready_gate_expires_at,
          'snoozed_by', v_session.snoozed_by,
          'snooze_expires_at', v_session.snooze_expires_at,
          'terminal', v_terminal
        );

        -- ── Canonical both_ready room metadata re-derivation (former
        -- registration_desync post): a successful both_ready result must
        -- never leave the deterministic date-<id> room fields NULL. ──
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

        IF COALESCE((v_result->>'success')::boolean, false)
           AND v_status = 'both_ready' THEN
          -- Resolve the canonical Daily domain: GUC (optional) -> most recent
          -- canonical host -> hard fallback. A domain is ALWAYS resolved.
          v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

          IF v_domain IS NULL THEN
            SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
            INTO v_domain
            FROM public.video_sessions vs
            WHERE vs.daily_room_url LIKE 'http%://%/date-%'
            ORDER BY vs.state_updated_at DESC NULLS LAST
            LIMIT 1;
          END IF;

          -- Locked, non-secret production Daily domain (= DAILY_ROOM_DOMAIN_FALLBACK).
          v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
          v_url := 'https://' || v_domain || '/' || v_expected_room_name;

          UPDATE public.video_sessions
            SET
              daily_room_name = v_expected_room_name,
              daily_room_url = v_url,
              daily_room_provider_verify_reason = COALESCE(
                daily_room_provider_verify_reason,
                'ready_gate_both_ready_canonical_rederive'
              ),
              state_updated_at = now()
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status = 'both_ready'
              AND entry_started_at IS NULL
              AND date_started_at IS NULL
              AND participant_1_joined_at IS NULL
              AND participant_2_joined_at IS NULL
              AND (daily_room_name IS NULL OR daily_room_url IS NULL)
            RETURNING * INTO v_restored;

          IF FOUND THEN
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'success',
              'both_ready_canonical_room_metadata_rederived',
              NULL,
              v_restored.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'daily_room_name', v_restored.daily_room_name,
                'daily_room_verified_at', v_restored.daily_room_verified_at,
                'daily_room_expires_at', v_restored.daily_room_expires_at,
                'rederived', true,
                'provider_verify_skip_eligible', false
              )
            );

            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
              'daily_room_name', v_restored.daily_room_name,
              'daily_room_url', v_restored.daily_room_url,
              'daily_room_verified_at', v_restored.daily_room_verified_at,
              'daily_room_expires_at', v_restored.daily_room_expires_at,
              'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── Registration-desync forfeit post-check (former result_status base):
    -- an open pre-provider gate whose registrations no longer point at it is
    -- forfeited instead of being echoed back as live. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE false
        END;

        -- `both_ready` is a valid pre-provider handoff while its expiry is
        -- open. Other terminal statuses/reasons are owned by the machine.
        IF NOT (
             COALESCE(v_result->>'success', 'true') = 'false'
             OR v_status NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
             OR (v_terminal AND v_status IS DISTINCT FROM 'both_ready')
             OR v_session.ended_at IS NOT NULL
             OR v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
             OR v_session.entry_started_at IS NOT NULL
             OR v_session.date_started_at IS NOT NULL
             OR v_session.daily_room_name IS NOT NULL
             OR v_session.daily_room_url IS NOT NULL
             OR v_session.participant_1_joined_at IS NOT NULL
             OR v_session.participant_2_joined_at IS NOT NULL
             OR COALESCE(v_session.phase, 'ready_gate') IN ('entry', 'date')
             OR v_session.ready_gate_expires_at IS NULL
             OR v_session.ready_gate_expires_at <= v_now
           ) THEN
          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p1_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_1_id
          FOR UPDATE;

          v_p1_ready_gate := COALESCE(v_p1_ready_gate, false);

          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p2_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_2_id
          FOR UPDATE;

          v_p2_ready_gate := COALESCE(v_p2_ready_gate, false);

          IF NOT (v_p1_ready_gate AND v_p2_ready_gate) THEN
            v_missing_participant_registration := CASE
              WHEN NOT v_p1_ready_gate AND NOT v_p2_ready_gate THEN 'both'
              WHEN NOT v_p1_ready_gate THEN 'participant_1'
              ELSE 'participant_2'
            END;

            UPDATE public.video_sessions
            SET
              ready_gate_status = 'forfeited',
              ready_gate_expires_at = v_now,
              snoozed_by = NULL,
              snooze_expires_at = NULL,
              state = 'ended'::public.video_date_state,
              phase = 'ended',
              ended_at = COALESCE(ended_at, v_now),
              ended_reason = COALESCE(ended_reason, 'ready_gate_registration_desync'),
              duration_seconds = COALESCE(
                duration_seconds,
                GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
              ),
              state_updated_at = v_now
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
              AND entry_started_at IS NULL
              AND date_started_at IS NULL
              AND daily_room_name IS NULL
              AND daily_room_url IS NULL
              AND participant_1_joined_at IS NULL
              AND participant_2_joined_at IS NULL
              AND COALESCE(phase, 'ready_gate') NOT IN ('entry', 'date')
            RETURNING * INTO v_after;

            GET DIAGNOSTICS v_row_count = ROW_COUNT;

            IF v_row_count > 0 THEN
              UPDATE public.event_registrations
              SET
                queue_status = 'idle',
                current_room_id = NULL,
                current_partner_id = NULL,
                last_active_at = v_now
              WHERE event_id = v_after.event_id
                AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
                AND (
                  current_room_id = v_after.id
                  OR (queue_status = 'in_ready_gate' AND current_room_id IS NULL)
                );

              PERFORM public.record_event_loop_observability(
                'ready_gate_transition',
                'success',
                'ready_gate_registration_desync',
                NULL,
                v_after.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', p_action,
                  'p_reason', p_reason,
                  'status_before', v_status,
                  'missing_participant_registration', v_missing_participant_registration,
                  'registration_desync', true
                )
              );

              v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
                'success', true,
                'status', 'forfeited',
                'ready_gate_status', 'forfeited',
                'ready_gate_expires_at', v_after.ready_gate_expires_at,
                'reason', 'ready_gate_registration_desync',
                'error_code', 'ready_gate_registration_desync',
                'terminal', true,
                'registration_desync', true,
                'missing_participant_registration', v_missing_participant_registration,
                'event_id', v_after.event_id
              );
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── result_status echo + dual server clock keys (former clock/57014
    -- layers). ──
    IF jsonb_typeof(v_result) = 'object' THEN
      v_status := COALESCE(
        v_result->>'ready_gate_status',
        v_result->>'status',
        v_result->>'result_ready_gate_status',
        v_result->>'result_status'
      );

      IF NULLIF(v_status, '') IS NOT NULL THEN
        v_result := v_result || jsonb_build_object(
          'result_status', v_status,
          'result_ready_gate_status', v_status
        );
      END IF;
    END IF;

    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  EXCEPTION
    WHEN query_canceled OR lock_not_available THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        PERFORM public.video_date_lifecycle_observe_exception_v2(
          p_session_id,
          v_actor,
          'ready_gate_transition.machine_timeout',
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'ready_gate_transition_timeout',
        'reason', 'ready_gate_transition_timeout',
        'code', 'READY_GATE_TRANSITION_TIMEOUT',
        'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
        'retryable', true,
        'retry_after_seconds', 2,
        'retry_after_ms', 2000,
        'status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'terminal', false,
        'single_body_rpc', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    BEGIN
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        v_actor,
        'ready_gate_transition',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    BEGIN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_snapshot := NULL;
    END;
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_failed',
      'reason', 'ready_gate_transition_failed',
      'code', 'READY_GATE_TRANSITION_FAILED',
      'error_code', 'READY_GATE_TRANSITION_FAILED',
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot,
      'single_body_rpc', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.recover_ready_gate_missing_rooms_v1(p_limit integer DEFAULT 100, p_grace_seconds integer DEFAULT 20, p_terminal_after_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_t0 timestamptz := clock_timestamp();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_grace interval := make_interval(secs => GREATEST(5, LEAST(COALESCE(p_grace_seconds, 20), 300)));
  v_terminal_after interval := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_terminal_after_seconds, 120), 1800)));
  v_enqueued integer := 0;
  v_waiting integer := 0;
  v_recovered integer := 0;
  v_terminalized integer := 0;
  v_skipped integer := 0;
  v_registration_rows integer := 0;
  v_rows integer := 0;
  v_ms integer;
  v_outbox jsonb;
  v_latest_outbox record;
  v_outbox_lock_key bigint;
  v_base_dedupe_key text;
  v_recovery_dedupe_key text;
  v_has_outbox boolean;
  v_latest_is_recovery boolean;
  r record;
BEGIN
  FOR r IN
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.started_at,
      vs.state_updated_at,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.ready_gate_expires_at,
      vs.prepare_entry_expires_at,
      GREATEST(
        COALESCE(vs.ready_participant_1_at, vs.started_at, vs.state_updated_at, v_now),
        COALESCE(vs.ready_participant_2_at, vs.started_at, vs.state_updated_at, v_now),
        COALESCE(vs.state_updated_at, vs.started_at, v_now)
      ) AS both_ready_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.ready_gate_status = 'both_ready'
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.date_started_at IS NULL
      AND vs.entry_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND (
        NULLIF(vs.daily_room_name, '') IS NULL
        OR NULLIF(vs.daily_room_url, '') IS NULL
        OR (
          NULLIF(vs.daily_room_name, '') IS NOT NULL
          AND NULLIF(vs.daily_room_url, '') IS NOT NULL
          AND vs.daily_room_url NOT LIKE ('%/' || vs.daily_room_name)
        )
      )
    ORDER BY
      COALESCE(vs.ready_gate_expires_at, vs.prepare_entry_expires_at, vs.started_at, v_now),
      vs.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_base_dedupe_key := 'phase3:ensure_room:' || r.id::text;
    v_recovery_dedupe_key := 'phase3:ensure_room_recovery:' || r.id::text;

    SELECT o.*
    INTO v_latest_outbox
    FROM public.video_date_provider_outbox o
    WHERE o.session_id = r.id
      AND o.kind = 'daily.ensure_video_date_room'
      AND o.dedupe_key IN (v_base_dedupe_key, v_recovery_dedupe_key)
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1;

    v_has_outbox := FOUND;
    IF v_has_outbox THEN
      v_latest_is_recovery := v_latest_outbox.dedupe_key = v_recovery_dedupe_key;
    ELSE
      v_latest_is_recovery := false;
    END IF;

    IF r.both_ready_at + v_grace > v_now THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), r.both_ready_at + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), r.both_ready_at + v_grace)
      WHERE id = r.id
        AND ended_at IS NULL
        AND ready_gate_status = 'both_ready'
        AND state = 'ready_gate'::public.video_date_state
        AND date_started_at IS NULL
        AND entry_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          NULLIF(daily_room_name, '') IS NULL
          OR NULLIF(daily_room_url, '') IS NULL
          OR (
            NULLIF(daily_room_name, '') IS NOT NULL
            AND NULLIF(daily_room_url, '') IS NOT NULL
            AND daily_room_url NOT LIKE ('%/' || daily_room_name)
          )
        );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_outbox.state = 'done' THEN
      SELECT count(*)::integer
      INTO v_rows
      FROM public.video_sessions vs
      WHERE vs.id = r.id
        AND vs.ended_at IS NULL
        AND NULLIF(vs.daily_room_name, '') IS NOT NULL
        AND NULLIF(vs.daily_room_url, '') IS NOT NULL
        AND vs.daily_room_url LIKE ('%/' || vs.daily_room_name);

      IF v_rows > 0 THEN
        v_recovered := v_recovered + 1;
        PERFORM public.record_event_loop_observability(
          'ready_gate_missing_room_recovery',
          'success',
          'provider_room_recovered',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object('outbox_id', v_latest_outbox.id)
        );
        CONTINUE;
      END IF;
    END IF;

    IF v_has_outbox
       AND v_latest_is_recovery
       AND v_latest_outbox.state IN ('failed', 'done')
       AND COALESCE(v_latest_outbox.attempts, 0) > 0
       AND COALESCE(v_latest_outbox.updated_at, v_latest_outbox.created_at) + v_terminal_after <= v_now THEN
      UPDATE public.video_sessions
      SET
        ready_gate_status = 'expired',
        state = 'ended'::public.video_date_state,
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'ready_gate_room_recovery_failed',
        prepare_entry_started_at = NULL,
        prepare_entry_expires_at = NULL,
        prepare_entry_attempt_id = NULL,
        prepare_entry_actor_id = NULL,
        snoozed_by = NULL,
        snooze_expires_at = NULL,
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
        ),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL
        AND ready_gate_status = 'both_ready'
        AND state = 'ready_gate'::public.video_date_state
        AND date_started_at IS NULL
        AND entry_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          NULLIF(daily_room_name, '') IS NULL
          OR NULLIF(daily_room_url, '') IS NULL
          OR (
            NULLIF(daily_room_name, '') IS NOT NULL
            AND NULLIF(daily_room_url, '') IS NOT NULL
            AND daily_room_url NOT LIKE ('%/' || daily_room_name)
          )
        );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'idle',
          current_room_id = NULL,
          current_partner_id = NULL,
          last_active_at = v_now
        WHERE event_id = r.event_id
          AND profile_id IN (r.participant_1_id, r.participant_2_id)
          AND current_room_id = r.id;

        GET DIAGNOSTICS v_registration_rows = ROW_COUNT;
        v_terminalized := v_terminalized + 1;

        PERFORM public.record_event_loop_observability(
          'ready_gate_missing_room_recovery',
          'terminalized',
          'ready_gate_room_recovery_failed',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object(
            'outbox_id', v_latest_outbox.id,
            'outbox_state', v_latest_outbox.state,
            'outbox_attempts', v_latest_outbox.attempts,
            'outbox_created_at', v_latest_outbox.created_at,
            'registration_rows', v_registration_rows
          )
        );
      END IF;

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_is_recovery AND v_latest_outbox.state = 'failed' THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_failed_waiting_terminal_deadline',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts,
          'outbox_updated_at', v_latest_outbox.updated_at
        )
      );

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_is_recovery AND v_latest_outbox.state = 'done' THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_done_waiting_room_metadata',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts,
          'outbox_updated_at', v_latest_outbox.updated_at
        )
      );

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_outbox.state IN ('pending', 'claimed') THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_in_progress',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts
        )
      );

      CONTINUE;
    END IF;

    v_outbox_lock_key := hashtextextended(
      'video_date_outbox_v2:' ||
      r.id::text || ':daily.ensure_video_date_room:' || v_recovery_dedupe_key,
      0
    );

    IF NOT pg_try_advisory_xact_lock(v_outbox_lock_key) THEN
      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_lock_busy',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('lock_scope', 'ensure_room_outbox_dedupe')
      );

      CONTINUE;
    END IF;

    v_outbox := public.video_date_outbox_enqueue_v2(
      r.id,
      'daily.ensure_video_date_room',
      jsonb_build_object(
        'source', 'ready_gate_missing_room_recovery',
        'previous_outbox_id', CASE WHEN v_has_outbox THEN v_latest_outbox.id ELSE NULL END,
        'previous_outbox_state', CASE WHEN v_has_outbox THEN v_latest_outbox.state ELSE NULL END
      ),
      v_recovery_dedupe_key,
      v_now
    );

    IF COALESCE((v_outbox->>'ok')::boolean, false) THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_enqueued := v_enqueued + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'success',
        'provider_room_recovery_enqueued',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_outbox->>'outboxId',
          'deduped', COALESCE((v_outbox->>'deduped')::boolean, false)
        )
      );
    ELSE
      v_waiting := v_waiting + 1;
      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'error',
        'provider_room_recovery_enqueue_failed',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('error', COALESCE(v_outbox->>'error', 'unknown'))
      );
    END IF;
  END LOOP;

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'ready_gate_missing_room_recovery',
    CASE WHEN v_enqueued + v_recovered + v_terminalized > 0 THEN 'success' ELSE 'no_op' END,
    NULL,
    v_ms,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'limit', v_limit,
      'grace_seconds', EXTRACT(EPOCH FROM v_grace)::integer,
      'terminal_after_seconds', EXTRACT(EPOCH FROM v_terminal_after)::integer,
      'enqueued', v_enqueued,
      'waiting', v_waiting,
      'recovered', v_recovered,
      'terminalized', v_terminalized,
      'skipped', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'waiting', v_waiting,
    'recovered', v_recovered,
    'terminalized', v_terminalized,
    'skipped', v_skipped
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_failed_video_date(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_sess record;
  v_eligible_reasons constant text[] := ARRAY[
    'partial_join_peer_timeout',
    'prepare_entry_provider_failed_repair',
    'prepare_entry_daily_join_missing',
    'prepare_entry_timeout',
    'entry_grace_expired',
    'reconnect_grace_expired',
    'queued_ttl_expired',
    'ready_gate_expired'
  ];
  v_p1_extra_time int := 0;
  v_p1_extended_vibe int := 0;
  v_p2_extra_time int := 0;
  v_p2_extended_vibe int := 0;
  v_p1_makeup int := 0;
  v_p2_makeup int := 0;
  v_session_started_date boolean := false;
  v_breakdown jsonb;
  v_refund_status text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_id_required');
  END IF;

  SELECT *
  INTO v_sess
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  -- Idempotent: a settled session never gets another refund.
  IF v_sess.refund_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'refund_status', v_sess.refund_status,
      'refund_granted_at', v_sess.refund_granted_at,
      'breakdown', v_sess.refund_breakdown
    );
  END IF;

  -- Only ended sessions are eligible for evaluation.
  IF v_sess.ended_at IS NULL OR v_sess.ended_reason IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_ended');
  END IF;

  v_session_started_date := v_sess.date_started_at IS NOT NULL;

  -- If the ended_reason is not platform / peer failure, mark denied and exit.
  IF NOT (v_sess.ended_reason = ANY(v_eligible_reasons)) THEN
    UPDATE public.video_sessions
    SET refund_status = 'denied',
        refund_granted_at = now(),
        refund_breakdown = jsonb_build_object(
          'ended_reason', v_sess.ended_reason,
          'reason', 'ineligible_ended_reason'
        )
    WHERE id = p_session_id
      AND refund_status IS NULL;

    RETURN jsonb_build_object(
      'success', true,
      'refund_status', 'denied',
      'reason', 'ineligible_ended_reason',
      'ended_reason', v_sess.ended_reason
    );
  END IF;

  -- Compute per-participant extension spend totals from the canonical ledger.
  IF v_sess.participant_1_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN credit_type = 'extra_time' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(CASE WHEN credit_type = 'extended_vibe' THEN 1 ELSE 0 END), 0)::int
    INTO v_p1_extra_time, v_p1_extended_vibe
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_sess.participant_1_id;
  END IF;

  IF v_sess.participant_2_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN credit_type = 'extra_time' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(CASE WHEN credit_type = 'extended_vibe' THEN 1 ELSE 0 END), 0)::int
    INTO v_p2_extra_time, v_p2_extended_vibe
    FROM public.video_date_credit_extension_spends
    WHERE session_id = p_session_id
      AND user_id = v_sess.participant_2_id;
  END IF;

  -- Goodwill make-up: only when the session never reached the date phase
  -- (i.e. the failure cost the user the date itself) AND no extension was
  -- already consumed for that participant. Extension refunds are precise
  -- compensation when extensions were actually spent; make-up never stacks.
  IF v_p1_extra_time + v_p1_extended_vibe = 0 AND NOT v_session_started_date THEN
    v_p1_makeup := 1;
  END IF;
  IF v_p2_extra_time + v_p2_extended_vibe = 0 AND NOT v_session_started_date THEN
    v_p2_makeup := 1;
  END IF;

  -- Apply the refunds. INSERT … ON CONFLICT so users without a baseline
  -- credit row still receive the grant.
  IF v_sess.participant_1_id IS NOT NULL
     AND (v_p1_extra_time + v_p1_extended_vibe + v_p1_makeup) > 0 THEN
    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
    VALUES (
      v_sess.participant_1_id,
      v_p1_extra_time + v_p1_makeup,
      v_p1_extended_vibe
    )
    ON CONFLICT (user_id) DO UPDATE
    SET extra_time_credits = public.user_credits.extra_time_credits + EXCLUDED.extra_time_credits,
        extended_vibe_credits = public.user_credits.extended_vibe_credits + EXCLUDED.extended_vibe_credits,
        updated_at = now();
  END IF;

  IF v_sess.participant_2_id IS NOT NULL
     AND (v_p2_extra_time + v_p2_extended_vibe + v_p2_makeup) > 0 THEN
    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
    VALUES (
      v_sess.participant_2_id,
      v_p2_extra_time + v_p2_makeup,
      v_p2_extended_vibe
    )
    ON CONFLICT (user_id) DO UPDATE
    SET extra_time_credits = public.user_credits.extra_time_credits + EXCLUDED.extra_time_credits,
        extended_vibe_credits = public.user_credits.extended_vibe_credits + EXCLUDED.extended_vibe_credits,
        updated_at = now();
  END IF;

  v_breakdown := jsonb_build_object(
    'ended_reason', v_sess.ended_reason,
    'session_started_date', v_session_started_date,
    'participant_1', jsonb_build_object(
      'profile_id', v_sess.participant_1_id,
      'extra_time_refunded', v_p1_extra_time,
      'extended_vibe_refunded', v_p1_extended_vibe,
      'extra_time_makeup', v_p1_makeup
    ),
    'participant_2', jsonb_build_object(
      'profile_id', v_sess.participant_2_id,
      'extra_time_refunded', v_p2_extra_time,
      'extended_vibe_refunded', v_p2_extended_vibe,
      'extra_time_makeup', v_p2_makeup
    )
  );

  v_refund_status := CASE
    WHEN (v_p1_extra_time + v_p1_extended_vibe + v_p1_makeup
          + v_p2_extra_time + v_p2_extended_vibe + v_p2_makeup) > 0
      THEN 'granted'
    ELSE 'noop'
  END;

  UPDATE public.video_sessions
  SET refund_status = v_refund_status,
      refund_granted_at = now(),
      refund_breakdown = v_breakdown
  WHERE id = p_session_id
    AND refund_status IS NULL;

  -- Best-effort observability hook.
  BEGIN
    PERFORM public.record_event_loop_observability(
      'refund_failed_video_date',
      'success',
      v_sess.ended_reason,
      NULL,
      v_sess.event_id,
      v_sess.participant_1_id,
      v_sess.id,
      v_breakdown
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Observability must never break the refund.
      NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'refund_status', v_refund_status,
    'breakdown', v_breakdown
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.take_video_date_token_refresh_provider_rate_limit_v1(p_session_id uuid, p_bucket text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bucket text := btrim(lower(COALESCE(p_bucket, '')));
  v_scoped_bucket text;
  v_capacity integer;
  v_refill numeric;
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated', 'retryAfterSeconds', 30);
  END IF;

  SELECT vs.id, vs.state, vs.phase, vs.ended_at
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant', 'retryAfterSeconds', 30);
  END IF;

  IF v_session.ended_at IS NOT NULL
    OR NOT (
      COALESCE(v_session.state::text, '') IN ('entry', 'date')
      OR COALESCE(v_session.phase::text, '') IN ('entry', 'date')
    )
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_active', 'retryAfterSeconds', 30);
  END IF;

  IF v_bucket = 'room_lookup' THEN
    v_capacity := 15;
    v_refill := 5;
  ELSIF v_bucket = 'meeting_token' THEN
    v_capacity := 20;
    v_refill := 10;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rate_limit_bucket', 'retryAfterSeconds', 30);
  END IF;

  v_scoped_bucket := concat(v_bucket, ':session:', p_session_id::text, ':user:', v_uid::text);

  RETURN public.take_provider_rate_limit_token_v1(
    'daily',
    v_scoped_bucket,
    1,
    v_capacity,
    v_refill
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates(p_event_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_inactive_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_terminal_reason text;
  v_total integer := 0;
  r public.video_sessions%ROWTYPE;
  v_terminalize jsonb;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_event_id',
      'terminalized', 0
    );
  END IF;

  IF v_inactive_reason IS NULL THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  END IF;

  IF v_inactive_reason IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'inactive_reason', NULL,
      'terminalized', 0
    );
  END IF;

  v_terminal_reason := CASE v_inactive_reason
    WHEN 'event_archived' THEN 'ready_gate_event_archived'
    WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
    WHEN 'event_ended' THEN 'ready_gate_event_ended'
    WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
    ELSE 'ready_gate_event_inactive'
  END;

  -- Daily room metadata alone is not provider-prepared/date-capable evidence.
  -- Exclude only rows already owned by handshake/date or concrete Daily join proof.
  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.entry_started_at IS NULL
      AND vs.date_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND COALESCE(vs.phase, 'ready_gate') NOT IN ('entry', 'date')
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.started_at), vs.id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
      r.id,
      NULL,
      v_terminal_reason,
      jsonb_build_object(
        'source', 'terminalize_event_ready_gates',
        'inactive_reason', v_inactive_reason,
        'previous_ready_gate_status', r.ready_gate_status,
        'previous_state', r.state::text,
        'previous_phase', r.phase,
        'previous_daily_room_name_present', NULLIF(r.daily_room_name, '') IS NOT NULL,
        'previous_daily_room_url_present', NULLIF(r.daily_room_url, '') IS NOT NULL,
        'room_metadata_not_provider_prepared_evidence', true
      )
    );

    IF lower(COALESCE(v_terminalize ->> 'terminalized', 'false')) IN ('true', 't', '1', 'yes') THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'inactive_reason', v_inactive_reason,
    'terminal_reason', v_terminal_reason,
    'terminalized', v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(p_limit integer DEFAULT 100, p_reason text DEFAULT 'cron'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'cron');
  v_inactive_reason text;
  v_terminal_reason text;
  v_row_count integer := 0;
  v_registration_rows integer := 0;
  v_total integer := 0;
  v_expected_room_name text;
  v_domain text;
  v_url text;
  r public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
BEGIN
  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND COALESCE(vs.phase, 'ready_gate') NOT IN ('entry', 'date')
      AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.entry_started_at IS NULL
      AND vs.date_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND (
        vs.daily_room_name IS NOT NULL
        OR vs.daily_room_url IS NOT NULL
        OR vs.daily_room_verified_at IS NOT NULL
        OR vs.daily_room_expires_at IS NOT NULL
        OR vs.daily_room_provider_verify_reason IS NOT NULL
        OR public.get_event_lobby_inactive_reason(vs.event_id) IS NOT NULL
      )
      AND (
        public.get_event_lobby_inactive_reason(vs.event_id) IS NOT NULL
        OR (
          vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
          AND vs.ready_gate_expires_at IS NOT NULL
          AND vs.ready_gate_expires_at <= v_now
          AND (vs.prepare_entry_expires_at IS NULL OR vs.prepare_entry_expires_at <= v_now)
        )
      )
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.started_at), vs.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_inactive_reason := public.get_event_lobby_inactive_reason(r.event_id);
    v_terminal_reason := CASE
      WHEN v_inactive_reason = 'event_archived' THEN 'ready_gate_event_archived'
      WHEN v_inactive_reason = 'event_cancelled' THEN 'ready_gate_event_cancelled'
      WHEN v_inactive_reason IN ('event_ended', 'event_outside_live_window') THEN 'ready_gate_event_ended'
      WHEN v_inactive_reason IS NOT NULL THEN 'ready_gate_event_inactive'
      WHEN r.ready_gate_status = 'both_ready'
           AND r.prepare_entry_expires_at IS NOT NULL
           AND r.prepare_entry_expires_at <= v_now THEN 'date_entry_prepare_timeout'
      ELSE 'ready_gate_expired'
    END;

    v_expected_room_name := 'date-' || replace(r.id::text, '-', '');
    v_domain := NULLIF(btrim(current_setting('app.daily_domain', true)), '');
    IF v_domain IS NULL
       AND r.daily_room_url IS NOT NULL
       AND r.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
      v_domain := substring(r.daily_room_url from '^https?://([^/]+)/');
    END IF;
    IF v_domain IS NULL THEN
      SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
      INTO v_domain
      FROM public.video_sessions vs
      WHERE vs.daily_room_url LIKE 'http%://%/date-%'
      ORDER BY vs.state_updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;
    v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
    v_url := 'https://' || v_domain || '/' || v_expected_room_name;

    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      daily_room_name = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN COALESCE(daily_room_name, v_expected_room_name)
        ELSE NULL
      END,
      daily_room_url = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN
          CASE
            WHEN daily_room_url IS NOT NULL AND daily_room_url LIKE ('%/' || v_expected_room_name)
              THEN daily_room_url
            ELSE v_url
          END
        ELSE NULL
      END,
      daily_room_verified_at = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN daily_room_verified_at
        ELSE NULL
      END,
      daily_room_expires_at = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN daily_room_expires_at
        ELSE NULL
      END,
      daily_room_provider_verify_reason = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_entry_terminal_diagnostic')
        ELSE NULL
      END,
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL,
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = v_terminal_reason,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND COALESCE(phase, 'ready_gate') NOT IN ('entry', 'date')
      AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND entry_started_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    RETURNING * INTO v_after;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_after.event_id
      AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
      AND (
        current_room_id = v_after.id
        OR (
          queue_status = 'in_ready_gate'
          AND current_partner_id IN (v_after.participant_1_id, v_after.participant_2_id)
        )
      );

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      CASE
        WHEN r.ready_gate_status = 'both_ready' THEN 'stale_both_ready_entry_terminalized_with_room_diagnostic'
        ELSE 'stale_pre_date_ready_gate_room_metadata_terminalized'
      END,
      NULL,
      v_after.event_id,
      NULL,
      v_after.id,
      jsonb_build_object(
        'source', v_reason,
        'terminal_reason', v_terminal_reason,
        'inactive_reason', v_inactive_reason,
        'previous_ready_gate_status', r.ready_gate_status,
        'previous_state', r.state::text,
        'previous_phase', r.phase,
        'previous_prepare_entry_started_at', r.prepare_entry_started_at,
        'previous_prepare_entry_expires_at', r.prepare_entry_expires_at,
        'had_daily_room_metadata',
          r.daily_room_name IS NOT NULL
          OR r.daily_room_url IS NOT NULL
          OR r.daily_room_verified_at IS NOT NULL
          OR r.daily_room_expires_at IS NOT NULL
          OR r.daily_room_provider_verify_reason IS NOT NULL,
        'preserved_terminal_room_metadata', r.ready_gate_status = 'both_ready',
        'daily_room_name', v_after.daily_room_name,
        'daily_room_url', v_after.daily_room_url,
        'registration_rows', v_registration_rows
      )
    );

    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_participant_status(p_event_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_current_status text;
  v_current_room_id uuid;
  v_has_active_joined_session boolean := false;
  v_has_pending_post_date_survey boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR btrim(p_status) = '' THEN
    RETURN;
  END IF;

  v_status := lower(btrim(p_status));
  IF v_status NOT IN (
    'browsing',
    'idle',
    'in_survey',
    'offline'
  ) THEN
    RETURN;
  END IF;

  SELECT queue_status, current_room_id
  INTO v_current_status, v_current_room_id
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND profile_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_current_room_id IS NOT NULL
     AND v_current_status IN ('in_ready_gate', 'in_handshake', 'in_date')
     AND v_status IN ('browsing', 'idle', 'in_survey', 'offline') THEN
    RETURN;
  END IF;

  IF v_status IN ('browsing', 'idle', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND vs.ended_at IS NULL
        AND (
          vs.entry_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
        )
    )
    INTO v_has_active_joined_session;

    IF v_has_active_joined_session THEN
      RETURN;
    END IF;
  END IF;

  IF v_current_status = 'in_survey'
     AND v_status IN ('browsing', 'idle', 'offline') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND v_uid IN (vs.participant_1_id, vs.participant_2_id)
        AND (v_current_room_id IS NULL OR vs.id = v_current_room_id)
        AND public.video_date_session_is_post_date_survey_eligible_v2(
          vs.ended_at,
          vs.ended_reason,
          vs.date_started_at,
          vs.state::text,
          vs.phase,
          vs.participant_1_joined_at,
          vs.participant_2_joined_at,
          vs.participant_1_remote_seen_at,
          vs.participant_2_remote_seen_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.date_feedback df
          WHERE df.session_id = vs.id
            AND df.user_id = v_uid
        )
    )
    INTO v_has_pending_post_date_survey;

    IF v_has_pending_post_date_survey THEN
      RETURN;
    END IF;
  END IF;

  UPDATE public.event_registrations
  SET queue_status = v_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_absence_review_1232_1242_base(p_session_id uuid, p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_p1 jsonb := '{}'::jsonb;
  v_p2 jsonb := '{}'::jsonb;
  v_p1_active boolean := false;
  v_p2_active boolean := false;
  v_p1_left_at timestamptz;
  v_p2_left_at timestamptz;
  v_latest_left_at timestamptz;
  v_confirmed boolean := false;
  v_confirmed_after_at timestamptz;
  v_grace_until timestamptz;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_rows_changed integer := 0;
  v_source text := NULLIF(left(btrim(COALESCE(p_source, '')), 120), '');
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_id_required');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', true,
      'already_ended', true,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  v_confirmed := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  IF NOT v_confirmed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', false,
      'reason', 'confirmed_encounter_required'
    );
  END IF;

  v_p1 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_1_id
  );
  v_p2 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_2_id
  );

  v_p1_active := COALESCE((v_p1->>'active')::boolean, false);
  v_p2_active := COALESCE((v_p2->>'active')::boolean, false);

  v_p1_left_at := CASE
    WHEN v_p1->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p1->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p1->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;
  v_p2_left_at := CASE
    WHEN v_p2->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p2->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p2->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;

  IF v_p1_active OR v_p2_active THEN
    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = CASE
        WHEN v_p1_active THEN NULL
        ELSE participant_1_away_at
      END,
      participant_2_away_at = CASE
        WHEN v_p2_active THEN NULL
        ELSE participant_2_away_at
      END,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (
        reconnect_grace_ends_at IS NOT NULL
        OR (v_p1_active AND participant_1_away_at IS NOT NULL)
        OR (v_p2_active AND participant_2_away_at IS NOT NULL)
      );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(p_session_id);
      PERFORM public.record_event_loop_observability(
        'video_date_provider_absence',
        'success',
        'provider_absence_grace_cleared_by_rejoin',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
          'participant_1_provider_active', v_p1_active,
          'participant_2_provider_active', v_p2_active,
          'participant_1_provider_presence', v_p1,
          'participant_2_provider_presence', v_p2
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'provider_absence_grace_cleared', v_rows_changed > 0,
      'reason', 'active_provider_present',
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  IF v_p1_left_at IS NULL OR v_p2_left_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'missing_left_pair',
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_latest_left_at := GREATEST(v_p1_left_at, v_p2_left_at);
  v_confirmed_after_at := GREATEST(
    COALESCE(v_session.date_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.entry_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.started_at, '-infinity'::timestamptz)
  );

  IF v_latest_left_at < v_confirmed_after_at - interval '5 seconds' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'provider_left_before_confirmed_encounter',
      'latest_left_at', v_latest_left_at,
      'confirmed_after_at', v_confirmed_after_at
    );
  END IF;

  v_grace_until := v_latest_left_at + interval '12 seconds';

  IF v_now < v_grace_until THEN
    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = v_grace_until,
      participant_1_away_at = GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at),
      participant_2_away_at = GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (
        reconnect_grace_ends_at IS DISTINCT FROM v_grace_until
        OR participant_1_away_at IS DISTINCT FROM GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at)
        OR participant_2_away_at IS DISTINCT FROM GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at)
      );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(p_session_id);
      PERFORM public.record_event_loop_observability(
        'video_date_provider_absence',
        'success',
        'provider_absence_reconnect_grace_started',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
          'latest_left_at', v_latest_left_at,
          'reconnect_grace_ends_at', v_grace_until,
          'participant_1_provider_presence', v_p1,
          'participant_2_provider_presence', v_p2
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'provider_absence_grace_started', true,
      'reconnect_grace_ends_at', v_grace_until,
      'latest_left_at', v_latest_left_at,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
    v_now,
    'provider_absence_after_confirmed_encounter',
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  )
  INTO v_event_live;

  UPDATE public.video_sessions
  SET
    ended_at = v_now,
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_reason = 'provider_absence_after_confirmed_encounter',
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = COALESCE(participant_1_away_at, v_p1_left_at),
    participant_2_away_at = COALESCE(participant_2_away_at, v_p2_left_at),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(date_started_at, entry_started_at, started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;
  GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

  IF v_rows_changed > 0 THEN
    PERFORM public.bump_video_session_seq(p_session_id);
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'browsing' END,
    current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
    current_partner_id = CASE
      WHEN v_should_open_survey AND profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      WHEN v_should_open_survey AND profile_id = v_session.participant_2_id THEN v_session.participant_1_id
      ELSE NULL
    END,
    last_active_at = v_now,
    updated_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  UPDATE public.video_date_surface_claims
  SET
    released_at = COALESCE(released_at, v_now),
    updated_at = v_now
  WHERE session_id = p_session_id
    AND released_at IS NULL;

  v_resume_status := CASE
    WHEN v_should_open_survey THEN 'in_survey'
    WHEN v_event_live THEN 'browsing'
    ELSE 'idle'
  END;

  PERFORM public.record_event_loop_observability(
    'video_date_provider_absence',
    'success',
    CASE
      WHEN v_should_open_survey THEN 'provider_absence_terminal_survey'
      ELSE 'provider_absence_terminal_no_survey'
    END,
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
      'ended_reason', 'provider_absence_after_confirmed_encounter',
      'latest_left_at', v_latest_left_at,
      'reconnect_grace_ends_at', v_grace_until,
      'survey_required', v_should_open_survey,
      'resume_status', v_resume_status,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'terminal', true,
    'terminalized', v_rows_changed > 0,
    'survey_required', v_should_open_survey,
    'ended_reason', 'provider_absence_after_confirmed_encounter',
    'resume_status', v_resume_status,
    'latest_left_at', v_latest_left_at,
    'participant_1_provider_presence', v_p1,
    'participant_2_provider_presence', v_p2
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_auto_promote_stable_media_base(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_eligibility jsonb := '{}'::jsonb;
  v_payload jsonb;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'video_session_entry_auto_promote_v2'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    v_payload := v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'promotion_blocked_by_lifecycle_eligibility', true
    );

    RETURN v_payload;
  END IF;

  RETURN COALESCE(public.vd_auto_promote_eligible_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  ), '{}'::jsonb) || jsonb_build_object(
    'lifecycle_eligibility_checked', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_provider_overlap_eligible_base(p_session_id uuid, p_actor uuid DEFAULT NULL::uuid, p_source text DEFAULT 'video_date_promote_provider_overlap_v1'::text, p_reason text DEFAULT NULL::text, p_require_participant boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_stable jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_has_explicit_pass boolean := false;
  v_both_decided boolean := false;
  v_expected_room_name text;
  v_expected_room_url text;
  v_room_repair jsonb := '{}'::jsonb;
  v_event jsonb := '{}'::jsonb;
  v_previous_entry_started_at timestamptz;
  v_date_started_at timestamptz;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF p_require_participant AND p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF p_require_participant
     AND p_actor IS DISTINCT FROM v_session.participant_1_id
     AND p_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  v_expected_room_name := 'date-' || replace(p_session_id::text, '-', '');
  v_room_repair := public.video_date_restore_canonical_room_metadata_v1(
    p_session_id,
    COALESCE(NULLIF(p_source, ''), 'provider_overlap_promotion') || ':preflight'
  );
  v_expected_room_url := COALESCE(
    NULLIF(v_room_repair->>'room_url', ''),
    NULLIF(v_session.daily_room_url, ''),
    'https://vibelyapp.daily.co/' || v_expected_room_name
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR v_session.phase = 'ended' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', 'ended',
      'phase', 'ended',
      'reason', COALESCE(v_session.ended_reason, 'already_ended'),
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'already_in_date',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  IF v_session.ready_gate_status IS DISTINCT FROM 'both_ready'
     AND v_session.state IS DISTINCT FROM 'entry'::public.video_date_state
     AND COALESCE(v_session.phase, '') <> 'entry'
     AND v_session.entry_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', COALESCE(v_session.state::text, 'unknown'),
      'phase', COALESCE(v_session.phase, 'unknown'),
      'reason', 'not_routeable_for_provider_overlap',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_has_explicit_pass := (
    (v_session.participant_1_decided_at IS NOT NULL AND v_session.participant_1_liked IS FALSE)
    OR (v_session.participant_2_decided_at IS NOT NULL AND v_session.participant_2_liked IS FALSE)
  );
  v_both_decided := v_session.participant_1_decided_at IS NOT NULL
    AND v_session.participant_2_decided_at IS NOT NULL;

  IF v_has_explicit_pass OR v_both_decided THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'reason', CASE
        WHEN v_has_explicit_pass THEN 'explicit_pass_present'
        ELSE 'both_decided_before_provider_overlap_promotion'
      END,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);

  IF NOT v_stable_copresence THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'provider_overlap_promotion_waiting',
      NULL,
      v_session.event_id,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'p_reason', p_reason,
        'stable_copresence', v_stable
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'reason', COALESCE(v_stable->>'reason', 'stable_copresence_not_ready'),
      'waiting_for_stable_copresence', true,
      'stable_copresence', v_stable,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_previous_entry_started_at := v_session.entry_started_at;
  v_date_started_at := v_now;

  UPDATE public.video_sessions
  SET
    entry_started_at = COALESCE(entry_started_at, v_now),
    state = 'date'::public.video_date_state,
    phase = 'date',
    date_started_at = v_date_started_at,
    ended_at = NULL,
    ended_reason = NULL,
    reconnect_grace_ends_at = NULL,
    entry_grace_expires_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    daily_room_name = COALESCE(NULLIF(daily_room_name, ''), v_expected_room_name),
    daily_room_url = COALESCE(NULLIF(daily_room_url, ''), v_expected_room_url),
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'provider_overlap_promotion_room_restored'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND date_started_at IS NULL
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'state', COALESCE(v_session.state::text, 'unknown'),
      'phase', COALESCE(v_session.phase, 'unknown'),
      'reason', 'promotion_lost_race',
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_date',
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  v_event := public.append_video_session_event_v2(
    p_session_id,
    'provider_overlap_promoted_to_date',
    'participants',
    p_actor,
    jsonb_build_object(
      'action', 'complete_entry',
      'source', p_source,
      'p_reason', p_reason,
      'previous_entry_started_at', v_previous_entry_started_at,
      'date_started_at', v_session.date_started_at,
      'stable_copresence', v_stable,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url
    ),
    jsonb_build_object(
      'state', 'date',
      'phase', 'date',
      'date_started_at', v_session.date_started_at,
      'reason', 'provider_overlap_promotion'
    ),
    true,
    gen_random_uuid()
  );

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'provider_overlap_promoted_to_date',
    NULL,
    v_session.event_id,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'action', 'complete_entry',
      'source', p_source,
      'p_reason', p_reason,
      'previous_entry_started_at', v_previous_entry_started_at,
      'date_started_at', v_session.date_started_at,
      'stable_copresence', v_stable,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'event_result', v_event
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'promoted', true,
    'provider_overlap_promoted_to_date', true,
    'state', 'date',
    'phase', 'date',
    'date_started_at', v_session.date_started_at,
    'reason', 'provider_overlap_promotion',
    'stable_copresence', v_stable,
    'event_result', v_event,
    'session_seq', COALESCE(v_session.session_seq, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.vd_start_snapshot_partial_base(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_server_now_ms bigint;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_deadline_at timestamptz;
  v_actor_role text;
  v_partner_id uuid;
  v_ready_gate_status text;
  v_i_am_ready boolean := false;
  v_partner_ready boolean := false;
  v_is_participant boolean := false;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_inactive_reason text := NULL;
  v_can_mark_ready boolean := false;
  v_can_enter_date boolean := false;
  v_terminal boolean := false;
  v_retryable boolean := false;
  v_allowed text[] := ARRAY[]::text[];
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_is_participant :=
    v_uid = v_session.participant_1_id
    OR v_uid = v_session.participant_2_id;

  IF NOT v_is_participant THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'error_code', 'NOT_PARTICIPANT',
      'retryable', false,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_ready_gate_status := COALESCE(v_session.ready_gate_status, 'queued');
  v_actor_role := CASE
    WHEN v_uid = v_session.participant_1_id THEN 'participant_1'
    WHEN v_uid = v_session.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_partner_id := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  BEGIN
    v_is_blocked := COALESCE(
      public.is_blocked(v_session.participant_1_id, v_session.participant_2_id),
      false
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_uid AND ur.reported_id = v_partner_id)
         OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_uid)
    )
    INTO v_has_report;

    v_actor_hidden := COALESCE(public.is_profile_hidden(v_uid), false);
    v_partner_hidden := COALESCE(public.is_profile_hidden(v_partner_id), false);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'safety_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'safety_check_unavailable',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'sqlstate', SQLSTATE,
        'message', v_message,
        'retryable', true,
        'terminal', false,
        'status', v_ready_gate_status,
        'ready_gate_status', v_ready_gate_status,
        'result_status', v_ready_gate_status,
        'result_ready_gate_status', v_ready_gate_status,
        'can_mark_ready', false,
        'canMarkReady', false,
        'auxiliary_errors', v_auxiliary_errors,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;

  IF COALESCE(v_is_blocked, false)
     OR COALESCE(v_has_report, false)
     OR COALESCE(v_actor_hidden, false)
     OR COALESCE(v_partner_hidden, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'viewer_role', v_actor_role,
      'partner_id', v_partner_id,
      'error', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'error_code', CASE
        WHEN v_is_blocked THEN 'BLOCKED_PAIR'
        WHEN v_has_report THEN 'REPORTED_PAIR'
        WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
        ELSE 'PARTNER_NOT_ELIGIBLE'
      END,
      'reason', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'ended_reason', CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END,
      'retryable', false,
      'terminal', true,
      'status', 'ended',
      'ready_gate_status', 'ended',
      'result_status', 'ended',
      'result_ready_gate_status', 'ended',
      'can_mark_ready', false,
      'can_enter_date', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  BEGIN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'event_active_check',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
      v_inactive_reason := NULL;
  END;

  v_i_am_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_1_at IS NOT NULL
    ELSE v_session.ready_participant_2_at IS NOT NULL
  END;
  v_partner_ready := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.ready_participant_2_at IS NOT NULL
    ELSE v_session.ready_participant_1_at IS NOT NULL
  END;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.entry_started_at IS NOT NULL OR v_session.state::text = 'entry' THEN 'entry'
    WHEN v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'entry', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'entry' AND kind IN ('entry_auto_promote', 'entry_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_deadline_at := COALESCE(
    v_deadline_row_at,
    CASE
      WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
      WHEN v_phase = 'entry' THEN COALESCE(v_session.entry_started_at, v_session.state_updated_at) + interval '60 seconds'
      WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
      WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
      ELSE NULL
    END
  );

  v_terminal :=
    v_session.ended_at IS NOT NULL
    OR v_session.state::text = 'ended'
    OR v_ready_gate_status IN ('expired', 'forfeited', 'cancelled', 'ended');

  v_can_mark_ready :=
    v_inactive_reason IS NULL
    AND v_session.ended_at IS NULL
    AND v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
    AND (
      v_session.ready_gate_expires_at IS NULL
      OR v_session.ready_gate_expires_at > v_now
      OR v_ready_gate_status = 'snoozed'
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snooze_expires_at IS NULL
      OR v_session.snooze_expires_at > v_now
    )
    AND (
      v_ready_gate_status <> 'snoozed'
      OR v_session.snoozed_by IS NULL
      OR v_session.snoozed_by = v_uid
    )
    AND NOT COALESCE(v_is_blocked, false)
    AND NOT COALESCE(v_has_report, false)
    AND NOT COALESCE(v_actor_hidden, false)
    AND NOT COALESCE(v_partner_hidden, false);

  v_can_enter_date :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_session.date_started_at IS NOT NULL
      OR v_session.state::text = 'date'
      OR v_ready_gate_status = 'both_ready'
    )
    AND v_session.daily_room_name IS NOT NULL
    AND v_session.daily_room_url IS NOT NULL;

  v_retryable :=
    v_session.ended_at IS NULL
    AND v_inactive_reason IS NULL
    AND (
      v_ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_phase IN ('entry', 'date')
    );

  v_allowed := CASE
    WHEN v_can_mark_ready THEN ARRAY['mark_ready', 'forfeit']::text[]
    WHEN v_can_enter_date THEN ARRAY['enter_date']::text[]
    WHEN v_ready_gate_status = 'both_ready' THEN ARRAY['enter_date']::text[]
    ELSE ARRAY[]::text[]
  END;

  RETURN
    jsonb_build_object(
      'ok', true,
      'success', true,
      'snapshot', true,
      'source', 'get_video_date_start_snapshot_v1',
      'session_id', v_session.id,
      'sessionId', v_session.id,
      'event_id', v_session.event_id,
      'eventId', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'partnerId', v_partner_id,
      'viewer_id', v_uid,
      'viewerId', v_uid,
      'actor_role', v_actor_role,
      'actorRole', v_actor_role,
      'viewer_role', v_actor_role,
      'viewerRole', v_actor_role,
      'status', v_ready_gate_status,
      'ready_gate_status', v_ready_gate_status,
      'result_status', v_ready_gate_status,
      'result_ready_gate_status', v_ready_gate_status,
      'state', v_session.state,
      'phase', v_session.phase,
      'normalized_phase', v_phase,
      'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
      'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
      'seq', COALESCE(v_session.session_seq, 0),
      'session_seq', COALESCE(v_session.session_seq, 0)
    )
    || jsonb_build_object(
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at,
      'i_am_ready', v_i_am_ready,
      'iAmReady', v_i_am_ready,
      'partner_ready', v_partner_ready,
      'partnerReady', v_partner_ready,
      'is_both_ready', v_ready_gate_status = 'both_ready',
      'isBothReady', v_ready_gate_status = 'both_ready',
      'entry_started_at', v_session.entry_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at
    )
    || jsonb_build_object(
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'room', CASE
        WHEN v_session.daily_room_url IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', v_session.daily_room_name,
          'url', v_session.daily_room_url,
          'tokenRequired', true
        )
      END,
      'ended_at', v_session.ended_at,
      'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END,
      'ended_reason', v_session.ended_reason,
      'endedReason', v_session.ended_reason,
      'inactive_reason', v_inactive_reason,
      'inactiveReason', v_inactive_reason
    )
    || jsonb_build_object(
      'can_mark_ready', v_can_mark_ready,
      'canMarkReady', v_can_mark_ready,
      'can_enter_date', v_can_enter_date,
      'canEnterDate', v_can_enter_date,
      'terminal', v_terminal,
      'retryable', v_retryable,
      'allowedActions', to_jsonb(v_allowed),
      'auxiliary_errors', v_auxiliary_errors,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms,
      'serverNow', v_server_now_ms
    );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'start_snapshot_failed',
      'error_code', 'START_SNAPSHOT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_both_ready_operator_diagnostics_v1(p_event_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_daily_domain text := COALESCE(NULLIF(btrim(current_setting('app.daily_domain', true)), ''), 'vibelyapp.daily.co');
  v_rows jsonb;
BEGIN
  WITH candidate AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.state,
      vs.phase,
      vs.daily_room_name,
      vs.daily_room_url,
      vs.entry_started_at,
      vs.date_started_at,
      vs.participant_1_joined_at,
      vs.participant_2_joined_at,
      vs.participant_1_remote_seen_at,
      vs.participant_2_remote_seen_at,
      vs.ended_at,
      vs.ended_reason,
      vs.state_updated_at,
      vs.ready_gate_expires_at,
      COALESCE(df.feedback_count, 0) AS feedback_count,
      CASE
        WHEN vs.ready_gate_status = 'both_ready'
             AND vs.ended_at IS NULL
             AND (vs.participant_1_joined_at IS NULL OR vs.participant_2_joined_at IS NULL)
          THEN 'both_ready_without_bilateral_join'
        WHEN vs.daily_room_url IS NOT NULL
             AND vs.daily_room_url NOT LIKE ('https://' || v_daily_domain || '/%')
          THEN 'daily_room_domain_mismatch'
        WHEN vs.participant_1_joined_at IS NOT NULL
             AND vs.participant_2_joined_at IS NOT NULL
             AND (vs.participant_1_remote_seen_at IS NULL OR vs.participant_2_remote_seen_at IS NULL)
             AND vs.ended_at IS NULL
          THEN 'joined_without_bilateral_remote_seen'
        WHEN vs.participant_1_remote_seen_at IS NOT NULL
             AND vs.participant_2_remote_seen_at IS NOT NULL
             AND vs.date_started_at IS NULL
             AND vs.ended_at IS NULL
          THEN 'remote_seen_without_date_promotion'
        WHEN vs.ended_at IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.event_registrations er
               WHERE er.event_id = vs.event_id
                 AND er.current_room_id = vs.id
                 AND er.queue_status = 'in_survey'
             )
             AND COALESCE(df.feedback_count, 0) < 2
          THEN 'survey_required_without_bilateral_feedback'
        ELSE NULL
      END AS diagnostic_category
    FROM public.video_sessions vs
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS feedback_count
      FROM public.date_feedback df
      WHERE df.session_id = vs.id
    ) df ON true
    WHERE (p_event_id IS NULL OR vs.event_id = p_event_id)
      AND (
        vs.ready_gate_status = 'both_ready'
        OR vs.entry_started_at IS NOT NULL
        OR vs.date_started_at IS NOT NULL
        OR vs.ended_at IS NOT NULL
        OR vs.daily_room_url IS NOT NULL
      )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(candidate) ORDER BY state_updated_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM candidate
    WHERE diagnostic_category IS NOT NULL
    ORDER BY state_updated_at DESC NULLS LAST
    LIMIT v_limit
  ) candidate;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'event_id', p_event_id,
    'daily_domain', v_daily_domain,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'generated_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_both_ready_route_payload_v1(p_session_id uuid, p_actor_id uuid DEFAULT auth.uid(), p_payload jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT 'video_date_both_ready_route_payload_v1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_session record;
  v_status text;
  v_ended boolean := false;
  v_has_provider_room boolean := false;
  v_date_owned boolean := false;
  v_ready_gate_completed boolean := false;
  v_ready_gate_terminal boolean := false;
  v_date_terminal boolean := false;
  v_survey_required boolean := false;
  v_route_decision text := 'stay_lobby';
  v_next_action text := 'lobby';
  v_path text := NULL;
  v_actor_registration_status text := NULL;
  v_actor_feedback_exists boolean := false;
BEGIN
  SELECT
    vs.id,
    vs.event_id,
    vs.participant_1_id,
    vs.participant_2_id,
    vs.state,
    vs.phase,
    vs.ready_gate_status,
    vs.ready_gate_expires_at,
    vs.daily_room_name,
    vs.daily_room_url,
    vs.entry_started_at,
    vs.date_started_at,
    vs.participant_1_joined_at,
    vs.participant_2_joined_at,
    vs.participant_1_remote_seen_at,
    vs.participant_2_remote_seen_at,
    vs.ended_at,
    vs.ended_reason
  INTO v_session
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id;

  IF NOT FOUND THEN
    RETURN v_payload || jsonb_build_object(
      'route_decision', 'stay_lobby',
      'routeDecision', 'stay_lobby',
      'next_surface', jsonb_build_object('action', 'lobby'),
      'nextSurface', jsonb_build_object('action', 'lobby'),
      'ready_gate_completed', false,
      'readyGateCompleted', false,
      'ready_gate_terminal', false,
      'readyGateTerminal', false,
      'date_terminal', false,
      'dateTerminal', false,
      'date_owned', false,
      'dateOwned', false,
      'both_ready_date_owned', false,
      'bothReadyDateOwned', false,
      'route_payload_source', p_source
    );
  END IF;

  v_status := COALESCE(v_session.ready_gate_status, v_payload->>'ready_gate_status', v_payload->>'status');
  v_ended := v_session.ended_at IS NOT NULL
    OR v_session.state = 'ended'::public.video_date_state
    OR COALESCE(v_session.phase, '') = 'ended'
    OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended');
  v_has_provider_room := v_session.daily_room_name IS NOT NULL AND v_session.daily_room_url IS NOT NULL;
  v_ready_gate_completed := v_status = 'both_ready';
  v_ready_gate_terminal := v_status IN ('expired', 'forfeited', 'cancelled', 'ended');
  v_date_terminal := v_ended AND (
    v_session.date_started_at IS NOT NULL
    OR v_session.participant_1_remote_seen_at IS NOT NULL
    OR v_session.participant_2_remote_seen_at IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
  );
  v_date_owned := NOT v_ended AND (
    v_status = 'both_ready'
    OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('entry', 'date')
    OR v_session.entry_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
  );

  IF p_actor_id IS NOT NULL THEN
    SELECT er.queue_status
    INTO v_actor_registration_status
    FROM public.event_registrations er
    WHERE er.event_id = v_session.event_id
      AND er.profile_id = p_actor_id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = p_session_id
        AND df.user_id = p_actor_id
    )
    INTO v_actor_feedback_exists;
  END IF;

  v_survey_required :=
    COALESCE(v_actor_registration_status, '') = 'in_survey'
    AND NOT COALESCE(v_actor_feedback_exists, false);

  IF v_survey_required THEN
    v_route_decision := 'navigate_survey';
    v_next_action := 'survey';
  ELSIF v_date_owned THEN
    v_route_decision := 'navigate_date';
    v_next_action := 'date';
  ELSIF v_ended THEN
    v_route_decision := 'ended';
    v_next_action := 'lobby';
  ELSIF v_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
        AND v_session.ready_gate_expires_at IS NOT NULL
        AND v_session.ready_gate_expires_at > now() THEN
    v_route_decision := 'navigate_ready';
    v_next_action := 'ready_gate';
  ELSE
    v_route_decision := 'stay_lobby';
    v_next_action := 'lobby';
  END IF;

  v_path := CASE v_next_action
    WHEN 'date' THEN '/date/' || p_session_id::text
    WHEN 'survey' THEN '/date/' || p_session_id::text
    WHEN 'ready_gate' THEN '/ready/' || p_session_id::text
    WHEN 'lobby' THEN '/event/' || v_session.event_id::text || '/lobby'
    ELSE NULL
  END;

  RETURN v_payload || jsonb_build_object(
    'route_decision', v_route_decision,
    'routeDecision', v_route_decision,
    'next_surface', jsonb_strip_nulls(jsonb_build_object(
      'action', v_next_action,
      'path', v_path,
      'session_id', p_session_id,
      'event_id', v_session.event_id
    )),
    'nextSurface', jsonb_strip_nulls(jsonb_build_object(
      'action', v_next_action,
      'path', v_path,
      'sessionId', p_session_id,
      'eventId', v_session.event_id
    )),
    'ready_gate_completed', v_ready_gate_completed,
    'readyGateCompleted', v_ready_gate_completed,
    'ready_gate_terminal', v_ready_gate_terminal,
    'readyGateTerminal', v_ready_gate_terminal,
    'date_terminal', v_date_terminal,
    'dateTerminal', v_date_terminal,
    'date_owned', v_date_owned,
    'dateOwned', v_date_owned,
    'both_ready_date_owned', v_ready_gate_completed AND NOT v_ended,
    'bothReadyDateOwned', v_ready_gate_completed AND NOT v_ended,
    'provider_room_present', v_has_provider_room,
    'providerRoomPresent', v_has_provider_room,
    'canonical_daily_room_name', v_session.daily_room_name,
    'canonicalDailyRoomName', v_session.daily_room_name,
    'canonical_daily_room_url', v_session.daily_room_url,
    'canonicalDailyRoomUrl', v_session.daily_room_url,
    'route_payload_source', p_source
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_terminal_context_v1(p_session_id uuid, p_actor_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_queue_status text := NULL;
  v_current_room_id uuid := NULL;
  v_feedback_exists boolean := false;
  v_survey_required boolean := false;
  v_terminal boolean := false;
  v_authorized_context boolean := false;
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id
    );
  END IF;

  v_authorized_context :=
    v_is_service
    OR (
      p_actor_id IS NOT NULL
      AND (
        v_row.participant_1_id = p_actor_id
        OR v_row.participant_2_id = p_actor_id
      )
    );

  IF NOT v_authorized_context THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_id', p_session_id,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'access_denied', true,
      'code', 'ACCESS_DENIED',
      'error_code', 'ACCESS_DENIED',
      'error', 'not_participant'
    );
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT er.queue_status, er.current_room_id
    INTO v_queue_status, v_current_room_id
    FROM public.event_registrations er
    WHERE er.event_id = v_row.event_id
      AND er.profile_id = p_actor_id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = p_session_id
        AND df.user_id = p_actor_id
    )
    INTO v_feedback_exists;
  END IF;

  v_terminal :=
    v_row.ended_at IS NOT NULL
    OR v_row.state::text = 'ended'
    OR COALESCE(v_row.phase, '') = 'ended';

  v_survey_required :=
    v_queue_status = 'in_survey'
    OR public.video_date_session_is_post_date_survey_eligible_v2(
      v_row.ended_at,
      v_row.ended_reason,
      v_row.date_started_at,
      v_row.state::text,
      v_row.phase,
      v_row.participant_1_joined_at,
      v_row.participant_2_joined_at,
      v_row.participant_1_remote_seen_at,
      v_row.participant_2_remote_seen_at
    );

  RETURN jsonb_build_object(
    'terminal_context_available', true,
    'authorized_context', true,
    'session_id', v_row.id,
    'event_id', v_row.event_id,
    'state', v_row.state::text,
    'phase', v_row.phase,
    'ready_gate_status', v_row.ready_gate_status,
    'session_ended', v_terminal,
    'terminal', v_terminal,
    'ended_at', v_row.ended_at,
    'ended_reason', v_row.ended_reason,
    'survey_required', v_survey_required,
    'queue_status', v_queue_status,
    'current_room_id', v_current_room_id,
    'date_started_at', v_row.date_started_at,
    'entry_started_at', v_row.entry_started_at,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
    'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
    'daily_room_name', v_row.daily_room_name,
    'daily_room_url', v_row.daily_room_url,
    'feedback_exists', v_feedback_exists
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id,
      'terminal_context_error', SQLSTATE,
      'terminal_context_message', SQLERRM
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_protect_both_ready_entry_v1(p_session_id uuid, p_actor_id uuid DEFAULT auth.uid(), p_entry_attempt_id text DEFAULT NULL::text, p_source text DEFAULT 'video_date_protect_both_ready_entry_v1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_actor uuid := p_actor_id;
  v_attempt_id text := NULLIF(btrim(COALESCE(p_entry_attempt_id, '')), '');
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_protect_both_ready_entry_v1');
  v_inactive_reason text;
  v_previous_lease_expires_at timestamptz;
  v_lease_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_row_count integer := 0;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state::text = 'ended'
     OR COALESCE(v_session.phase, '') = 'ended' THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_ENDED',
      'error', 'Session has ended',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  IF v_actor IS NULL
     OR (
       v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'ACCESS_DENIED',
      'error', 'Access denied',
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'EVENT_INACTIVE',
      'error', 'Event is no longer active',
      'inactive_reason', v_inactive_reason,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  IF v_session.state::text IS DISTINCT FROM 'ready_gate'
     OR COALESCE(v_session.phase, 'ready_gate') IS DISTINCT FROM 'ready_gate'
     OR v_session.ready_gate_status IS DISTINCT FROM 'both_ready'
     OR v_session.entry_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'NOT_PROTECTABLE',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'entry_started_at', v_session.entry_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at
    );
  END IF;

  v_domain := NULLIF(btrim(current_setting('app.daily_domain', true)), '');
  IF v_domain IS NULL
     AND v_session.daily_room_url IS NOT NULL
     AND v_session.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
  END IF;
  IF v_domain IS NULL THEN
    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
    INTO v_domain
    FROM public.video_sessions vs
    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
    ORDER BY vs.state_updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
  v_url := 'https://' || v_domain || '/' || v_expected_room_name;

  v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
  v_lease_expires_at := GREATEST(
    COALESCE(v_session.prepare_entry_expires_at, v_now),
    v_now + interval '5 minutes'
  );

  UPDATE public.video_sessions
  SET
    prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now),
    prepare_entry_expires_at = v_lease_expires_at,
    prepare_entry_attempt_id = COALESCE(NULLIF(prepare_entry_attempt_id, ''), v_attempt_id),
    prepare_entry_actor_id = COALESCE(prepare_entry_actor_id, v_actor),
    ready_gate_expires_at = GREATEST(
      COALESCE(ready_gate_expires_at, v_now),
      v_lease_expires_at
    ),
    daily_room_name = v_expected_room_name,
    daily_room_url = CASE
      WHEN daily_room_url IS NOT NULL AND daily_room_url LIKE ('%/' || v_expected_room_name)
        THEN daily_room_url
      ELSE v_url
    END,
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'ready_gate_entry_protected'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state::text = 'ready_gate'
    AND COALESCE(phase, 'ready_gate') = 'ready_gate'
    AND ready_gate_status = 'both_ready'
    AND entry_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'PROTECT_ZERO_ROWS',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE
      WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_route_protected'
      ELSE 'prepare_entry_route_protection_refreshed'
    END,
    NULL,
    v_after.event_id,
    v_actor,
    v_after.id,
    jsonb_build_object(
      'source', v_source,
      'entry_attempt_id', v_attempt_id,
      'ready_gate_status', v_after.ready_gate_status,
      'prepare_entry_started_at', v_after.prepare_entry_started_at,
      'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
      'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
      'ready_gate_expires_at', v_after.ready_gate_expires_at,
      'daily_room_name', v_after.daily_room_name,
      'daily_room_url', v_after.daily_room_url,
      'provider_reason', v_after.daily_room_provider_verify_reason,
      'routeable_for_date_owner', true,
      'provider_ready', v_after.daily_room_verified_at IS NOT NULL,
      'daily_metadata_authoritative_before_both_ready', false
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'ok', true,
    'code', 'OK',
    'event_id', v_after.event_id,
    'state', v_after.state::text,
    'phase', v_after.phase,
    'ready_gate_status', v_after.ready_gate_status,
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'prepare_entry_started_at', v_after.prepare_entry_started_at,
    'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
    'prepare_entry_attempt_id', v_after.prepare_entry_attempt_id,
    'prepare_entry_actor_id', v_after.prepare_entry_actor_id,
    'participant_1_id', v_after.participant_1_id,
    'participant_2_id', v_after.participant_2_id,
    'daily_room_name', v_after.daily_room_name,
    'daily_room_url', v_after.daily_room_url,
    'daily_room_verified_at', v_after.daily_room_verified_at,
    'daily_room_expires_at', v_after.daily_room_expires_at,
    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
    'routeable_for_date_owner', true,
    'provider_ready', v_after.daily_room_verified_at IS NOT NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1(p_session_id uuid, p_actor_id uuid DEFAULT auth.uid(), p_source text DEFAULT 'video_date_ready_gate_actionability_v1'::text, p_allow_actor_owned_snooze boolean DEFAULT false, p_require_current_ready_gate_registration boolean DEFAULT true, p_terminalize_invalid boolean DEFAULT false, p_lock_rows boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_date_ready_gate_actionability_v1.single_body_core (rebuild PR 4):
-- owner-eligibility matrix + participant eligibility + route payload wrap.
DECLARE
  v_now timestamptz := now();
  v_actor uuid := p_actor_id;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_ready_gate_actionability_v1');
  v_session public.video_sessions%ROWTYPE;
  v_status text;
  v_partner_id uuid;
  v_inactive_reason text;
  v_terminal_reason text;
  v_is_blocked boolean := false;
  v_has_report boolean := false;
  v_actor_hidden boolean := false;
  v_partner_hidden boolean := false;
  v_p1_queue_status text;
  v_p2_queue_status text;
  v_p1_current_room_id uuid;
  v_p2_current_room_id uuid;
  v_p1_current_partner_id uuid;
  v_p2_current_partner_id uuid;
  v_p1_registration_found boolean := false;
  v_p2_registration_found boolean := false;
  v_registration_issues text[] := ARRAY[]::text[];
  v_timestamp_issue text := NULL;
  v_terminalize jsonb;
  v_base jsonb := NULL;
  v_actor_eligibility jsonb := '{}'::jsonb;
  v_partner_eligibility jsonb := '{}'::jsonb;
  v_invalid_eligibility jsonb := '{}'::jsonb;
  v_actor_ok boolean := true;
  v_partner_ok boolean := true;
  v_invalid_role text := NULL;
  v_invalid_retryable boolean := false;
  v_invalid_terminal boolean := true;
  v_invalid_code text;
  v_invalid_reason text;
  v_invalid_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── Owner-eligibility matrix (formerly the owner_eligibility base). Every
  -- failure returns through the route-payload wrap below; v_base stays NULL
  -- until the matrix decides. ──
  IF v_actor IS NULL THEN
    v_base := jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'AUTH_REQUIRED',
      'error_code', 'AUTH_REQUIRED',
      'error', 'auth_required',
      'reason', 'auth_required',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    IF p_lock_rows THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;
    ELSE
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;
    END IF;

    IF NOT FOUND THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'SESSION_NOT_FOUND',
        'error_code', 'SESSION_NOT_FOUND',
        'error', 'session_not_found',
        'reason', 'session_not_found',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'code', 'ACCESS_DENIED',
        'error_code', 'ACCESS_DENIED',
        'error', 'not_participant',
        'reason', 'not_participant',
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    v_status := COALESCE(v_session.ready_gate_status, 'queued');
    v_partner_id := CASE
      WHEN v_actor = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END;

    IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
       OR COALESCE(v_session.phase, 'ready_gate') IN ('entry', 'date')
       OR v_session.entry_started_at IS NOT NULL
       OR v_session.date_started_at IS NOT NULL
       OR v_session.participant_1_joined_at IS NOT NULL
       OR v_session.participant_2_joined_at IS NOT NULL THEN
      v_base := jsonb_build_object(
        'ok', true,
        'success', true,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'actionable', true,
        'source', v_source,
        'non_ready_gate_owned', true
      );
    ELSIF v_session.ended_at IS NOT NULL
       OR v_session.state = 'ended'::public.video_date_state
       OR COALESCE(v_session.phase, '') = 'ended'
       OR v_status IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'SESSION_ENDED',
        'error_code', 'SESSION_ENDED',
        'error', 'session_ended',
        'reason', COALESCE(v_session.ended_reason, 'session_ended'),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    ELSIF v_status = 'queued' THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_OPEN',
        'error_code', 'READY_GATE_NOT_OPEN',
        'error', 'ready_gate_not_open',
        'reason', 'ready_gate_not_open',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status = 'snoozed'
       AND (
         p_allow_actor_owned_snooze IS NOT TRUE
         OR v_session.snoozed_by IS NULL
         OR v_session.snoozed_by IS DISTINCT FROM v_actor
         OR (v_session.snooze_expires_at IS NOT NULL AND v_session.snooze_expires_at <= v_now)
       ) THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'snoozed_by', v_session.snoozed_by,
        'snooze_expires_at', v_session.snooze_expires_at,
        'code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error_code', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'PARTNER_SNOOZED' ELSE 'READY_GATE_SNOOZED' END,
        'error', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'reason', CASE WHEN v_session.snoozed_by IS DISTINCT FROM v_actor THEN 'partner_snoozed' ELSE 'ready_gate_snoozed' END,
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    ELSIF v_status NOT IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
      v_base := jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', v_status,
        'ready_gate_status', v_status,
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'READY_GATE_NOT_READY',
        'error', 'ready_gate_not_ready',
        'reason', 'ready_gate_not_ready',
        'retryable', true,
        'terminal', false,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    IF v_status = 'ready_a'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_a_timestamp_mismatch';
    ELSIF v_status = 'ready_b'
       AND (v_session.ready_participant_2_at IS NULL OR v_session.ready_participant_1_at IS NOT NULL) THEN
      v_timestamp_issue := 'ready_b_timestamp_mismatch';
    ELSIF v_status = 'both_ready'
       AND (v_session.ready_participant_1_at IS NULL OR v_session.ready_participant_2_at IS NULL) THEN
      v_timestamp_issue := 'both_ready_timestamp_mismatch';
    END IF;

    IF v_timestamp_issue IS NOT NULL THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_status_timestamp_desync',
          jsonb_build_object('source', v_source, 'issue', v_timestamp_issue)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error_code', 'READY_GATE_STATUS_TIMESTAMP_DESYNC',
        'error', 'ready_gate_status_timestamp_desync',
        'reason', 'ready_gate_status_timestamp_desync',
        'timestamp_issue', v_timestamp_issue,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL
     AND v_session.ready_gate_expires_at IS NOT NULL
     AND v_session.ready_gate_expires_at <= v_now
     AND NOT (
       v_status = 'both_ready'
       AND v_session.prepare_entry_expires_at IS NOT NULL
       AND v_session.prepare_entry_expires_at > v_now
     ) THEN
    IF p_terminalize_invalid THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        v_session.id,
        v_actor,
        'ready_gate_expired',
        jsonb_build_object('source', v_source)
      );
    END IF;

    v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
      'code', 'READY_GATE_EXPIRED',
      'error_code', 'READY_GATE_EXPIRED',
      'error', 'ready_gate_expired',
      'reason', 'ready_gate_expired',
      'retryable', false,
      'terminal', true,
      'source', v_source
    );
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            v_source || '.event_active_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error_code', 'EVENT_ACTIVE_CHECK_UNAVAILABLE',
          'error', 'event_active_check_unavailable',
          'reason', 'event_active_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND v_inactive_reason IS NOT NULL THEN
      v_terminal_reason := CASE v_inactive_reason
        WHEN 'event_archived' THEN 'ready_gate_event_archived'
        WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
        WHEN 'event_ended' THEN 'ready_gate_event_ended'
        WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
        ELSE 'ready_gate_event_inactive'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object('source', v_source, 'inactive_reason', v_inactive_reason)
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'EVENT_NOT_ACTIVE',
        'error_code', 'EVENT_NOT_ACTIVE',
        'error', 'event_not_active',
        'reason', v_terminal_reason,
        'inactive_reason', v_inactive_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL THEN
    BEGIN
      v_is_blocked := COALESCE(public.is_blocked(v_session.participant_1_id, v_session.participant_2_id), false);

      SELECT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
           OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
      )
      INTO v_has_report;

      v_actor_hidden := COALESCE(public.is_profile_hidden(v_actor), false);
      v_partner_hidden := COALESCE(public.is_profile_hidden(v_partner_id), false);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_message = MESSAGE_TEXT,
          v_detail = PG_EXCEPTION_DETAIL,
          v_hint = PG_EXCEPTION_HINT;
        BEGIN
          PERFORM public.video_date_lifecycle_observe_exception_v2(
            p_session_id,
            v_actor,
            v_source || '.safety_check',
            SQLSTATE,
            v_message,
            v_detail,
            v_hint
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
        v_base := jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', v_session.id,
          'event_id', v_session.event_id,
          'status', v_status,
          'ready_gate_status', v_status,
          'code', 'SAFETY_CHECK_UNAVAILABLE',
          'error_code', 'SAFETY_CHECK_UNAVAILABLE',
          'error', 'safety_check_unavailable',
          'reason', 'safety_check_unavailable',
          'retryable', true,
          'terminal', false,
          'source', v_source
        );
    END;

    IF v_base IS NULL AND (v_is_blocked OR v_has_report OR v_actor_hidden OR v_partner_hidden) THEN
      v_terminal_reason := CASE
        WHEN v_is_blocked THEN 'blocked_pair'
        WHEN v_has_report THEN 'reported_pair'
        WHEN v_actor_hidden THEN 'actor_hidden'
        ELSE 'partner_hidden'
      END;

      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          v_terminal_reason,
          jsonb_build_object(
            'source', v_source,
            'blocked_pair', v_is_blocked,
            'reported_pair', v_has_report,
            'actor_hidden', v_actor_hidden,
            'partner_hidden', v_partner_hidden
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error_code', CASE
          WHEN v_is_blocked THEN 'BLOCKED_PAIR'
          WHEN v_has_report THEN 'REPORTED_PAIR'
          WHEN v_actor_hidden THEN 'ACTOR_NOT_ELIGIBLE'
          ELSE 'PARTNER_NOT_ELIGIBLE'
        END,
        'error', v_terminal_reason,
        'reason', v_terminal_reason,
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  IF v_base IS NULL AND p_require_current_ready_gate_registration THEN
    IF p_lock_rows THEN
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id
      FOR UPDATE;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id
      FOR UPDATE;
    ELSE
      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p1_queue_status,
        v_p1_current_room_id,
        v_p1_current_partner_id,
        v_p1_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_1_id;

      SELECT
        er.queue_status,
        er.current_room_id,
        er.current_partner_id,
        true
      INTO
        v_p2_queue_status,
        v_p2_current_room_id,
        v_p2_current_partner_id,
        v_p2_registration_found
      FROM public.event_registrations er
      WHERE er.event_id = v_session.event_id
        AND er.profile_id = v_session.participant_2_id;
    END IF;

    v_p1_registration_found := COALESCE(v_p1_registration_found, false);
    v_p2_registration_found := COALESCE(v_p2_registration_found, false);

    v_registration_issues := array_remove(ARRAY[
      CASE WHEN NOT v_p1_registration_found THEN 'participant_1_registration_missing' END,
      CASE WHEN NOT v_p2_registration_found THEN 'participant_2_registration_missing' END,
      CASE WHEN v_p1_registration_found AND v_p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
      CASE WHEN v_p2_registration_found AND v_p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_1_current_room_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_room_id IS DISTINCT FROM v_session.id THEN 'participant_2_current_room_mismatch' END,
      CASE WHEN v_p1_registration_found AND v_p1_current_partner_id IS DISTINCT FROM v_session.participant_2_id THEN 'participant_1_partner_mismatch' END,
      CASE WHEN v_p2_registration_found AND v_p2_current_partner_id IS DISTINCT FROM v_session.participant_1_id THEN 'participant_2_partner_mismatch' END
    ]::text[], NULL);

    IF cardinality(v_registration_issues) > 0 THEN
      IF p_terminalize_invalid THEN
        v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
          v_session.id,
          v_actor,
          'ready_gate_registration_desync',
          jsonb_build_object(
            'source', v_source,
            'registration_issues', to_jsonb(v_registration_issues),
            'participant_1_queue_status', v_p1_queue_status,
            'participant_2_queue_status', v_p2_queue_status,
            'participant_1_current_room_id', v_p1_current_room_id,
            'participant_2_current_room_id', v_p2_current_room_id,
            'participant_1_current_partner_id', v_p1_current_partner_id,
            'participant_2_current_partner_id', v_p2_current_partner_id
          )
        );
      END IF;

      v_base := COALESCE(v_terminalize, '{}'::jsonb) || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', v_session.id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_status),
        'code', 'READY_GATE_REGISTRATION_DESYNC',
        'error_code', 'READY_GATE_REGISTRATION_DESYNC',
        'error', 'ready_gate_registration_desync',
        'reason', 'ready_gate_registration_desync',
        'registration_desync', true,
        'registration_issues', to_jsonb(v_registration_issues),
        'retryable', false,
        'terminal', true,
        'source', v_source
      );
    END IF;
  END IF;

  -- ── Matrix failures: route-payload wrap without eligibility checks
  -- (identical to the former head's not-ok base handling). ──
  IF v_base IS NOT NULL
     AND lower(COALESCE(v_base ->> 'ok', v_base ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'eligibility_checked', false
      ),
      v_source
    );
  END IF;

  IF v_base IS NULL THEN
    v_base := jsonb_build_object(
      'ok', true,
      'success', true,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'partner_id', v_partner_id,
      'status', v_status,
      'ready_gate_status', v_status,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
      'actionable', true,
      'source', v_source,
      'registration_checked', p_require_current_ready_gate_registration,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
  END IF;

  -- ── Participant eligibility (former head layer; runs for ok bases,
  -- including the non-ready-gate-owned pass-through, as before). ──
  v_actor_eligibility := public.video_date_participant_eligibility_v1(v_actor, v_source || '.actor');
  v_partner_eligibility := public.video_date_participant_eligibility_v1(v_partner_id, v_source || '.partner');
  v_actor_ok := lower(COALESCE(v_actor_eligibility ->> 'ok', v_actor_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');
  v_partner_ok := lower(COALESCE(v_partner_eligibility ->> 'ok', v_partner_eligibility ->> 'success', 'false')) IN ('true', 't', '1', 'yes');

  IF NOT v_actor_ok OR NOT v_partner_ok THEN
    v_invalid_role := CASE WHEN NOT v_actor_ok THEN 'actor' ELSE 'partner' END;
    v_invalid_eligibility := CASE
      WHEN v_invalid_role = 'actor' THEN v_actor_eligibility
      ELSE v_partner_eligibility
    END;
    v_invalid_retryable := lower(COALESCE(v_invalid_eligibility ->> 'retryable', 'false')) IN ('true', 't', '1', 'yes');
    v_invalid_terminal := lower(COALESCE(v_invalid_eligibility ->> 'terminal', 'true')) IN ('true', 't', '1', 'yes');
    v_invalid_code := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'code', ''),
      NULLIF(v_invalid_eligibility ->> 'error_code', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END
    );
    v_invalid_reason := COALESCE(
      NULLIF(v_invalid_eligibility ->> 'reason', ''),
      NULLIF(v_invalid_eligibility ->> 'error', ''),
      CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END
    );

    v_terminalize := NULL;
    IF p_terminalize_invalid AND NOT v_invalid_retryable AND v_invalid_terminal THEN
      v_terminalize := public.video_date_terminalize_ready_gate_session_v1(
        p_session_id,
        v_actor,
        CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END,
        jsonb_build_object(
          'source', v_source,
          'invalid_role', v_invalid_role,
          'actor_eligibility', v_actor_eligibility,
          'partner_eligibility', v_partner_eligibility
        )
      );
    END IF;

    v_invalid_payload := COALESCE(v_terminalize, '{}'::jsonb)
      || COALESCE(v_base, '{}'::jsonb)
      || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'event_id', v_session.event_id,
        'status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'ready_gate_status', COALESCE(v_terminalize->>'ready_gate_status', v_session.ready_gate_status),
        'code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error_code', CASE WHEN v_invalid_retryable THEN v_invalid_code ELSE CASE WHEN v_invalid_role = 'actor' THEN 'ACTOR_NOT_ELIGIBLE' ELSE 'PARTNER_NOT_ELIGIBLE' END END,
        'error', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'reason', CASE WHEN v_invalid_retryable THEN v_invalid_reason ELSE CASE WHEN v_invalid_role = 'actor' THEN 'actor_eligibility_invalid' ELSE 'partner_eligibility_invalid' END END,
        'retryable', v_invalid_retryable,
        'terminal', NOT v_invalid_retryable AND v_invalid_terminal,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'eligibility_retryable', v_invalid_retryable,
        'eligibility_terminal', v_invalid_terminal,
        'eligibility_code', v_invalid_code,
        'actor_eligibility', v_actor_eligibility,
        'partner_eligibility', v_partner_eligibility,
        'invalid_eligibility_role', v_invalid_role,
        'source', v_source
      );

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_invalid_payload,
      v_source
    );
  END IF;

  RETURN public.video_date_both_ready_route_payload_v1(
    p_session_id,
    v_actor,
    COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
      'ready_gate_actionability_checked', true,
      'eligibility_checked', true,
      'actor_eligibility_ok', true,
      'partner_eligibility_ok', true
    ),
    v_source
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    BEGIN
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        v_actor,
        v_source,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error_code', 'READY_GATE_ACTIONABILITY_UNAVAILABLE',
        'error', 'ready_gate_actionability_unavailable',
        'reason', 'ready_gate_actionability_unavailable',
        'retryable', true,
        'terminal', false,
        'ready_gate_actionability_checked', true,
        'eligibility_checked', true,
        'single_body_rpc', true,
        'source', v_source
      ),
      v_source
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible(p_ended_at timestamp with time zone, p_ended_reason text, p_date_started_at timestamp with time zone, p_state text, p_phase text, p_participant_1_joined_at timestamp with time zone, p_participant_2_joined_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_encounter_exposure(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'entry_grace_expired',
      'partial_join_peer_timeout',
      'peer_missing_timeout',
      'prepare_entry_daily_join_missing',
      'pre_stable_media_failed',
      'blocked_pair',
      'blocked_or_reported_pair'
    );
$function$;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(p_ended_at timestamp with time zone, p_ended_reason text, p_date_started_at timestamp with time zone, p_state text, p_phase text, p_participant_1_joined_at timestamp with time zone, p_participant_2_joined_at timestamp with time zone, p_participant_1_remote_seen_at timestamp with time zone, p_participant_2_remote_seen_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_confirmed_encounter(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at,
      p_participant_1_remote_seen_at,
      p_participant_2_remote_seen_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'entry_grace_expired',
      'partial_join_peer_timeout',
      'peer_missing_timeout',
      'prepare_entry_daily_join_missing',
      'pre_stable_media_failed',
      'blocked_pair',
      'blocked_or_reported_pair'
    );
$function$;

CREATE OR REPLACE FUNCTION public.video_date_terminalize_ready_gate_session_v1(p_session_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'ready_gate_actionability_invalid'::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'ready_gate_actionability_invalid');
  v_terminal_status text;
  v_row_count integer := 0;
  v_registration_rows integer := 0;
  v_message text;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'terminalized', false
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'code', 'SESSION_NOT_FOUND',
      'error', 'session_not_found',
      'terminalized', false
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state = 'ended'::public.video_date_state
     OR COALESCE(v_session.phase, '') = 'ended'
     OR COALESCE(v_session.ready_gate_status, '') IN ('expired', 'forfeited', 'cancelled', 'ended') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ended_reason', COALESCE(v_session.ended_reason, v_reason),
      'terminal', true,
      'terminalized', false,
      'already_terminal', true
    );
  END IF;

  IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR COALESCE(v_session.phase, 'ready_gate') IN ('entry', 'date')
     OR v_session.entry_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'code', 'NOT_TERMINALIZABLE',
      'error', 'not_terminalizable',
      'terminal', false,
      'terminalized', false
    );
  END IF;

  v_terminal_status := CASE
    WHEN v_reason IN (
      'ready_gate_expired',
      'ready_gate_event_archived',
      'ready_gate_event_cancelled',
      'ready_gate_event_ended',
      'ready_gate_event_inactive'
    ) THEN 'expired'
    ELSE 'forfeited'
  END;

  UPDATE public.video_sessions
  SET
    ready_gate_status = v_terminal_status,
    ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
    snoozed_by = NULL,
    snooze_expires_at = NULL,
    daily_room_name = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_name ELSE NULL END,
    daily_room_url = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_url ELSE NULL END,
    daily_room_verified_at = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_verified_at ELSE NULL END,
    daily_room_expires_at = CASE WHEN v_session.ready_gate_status = 'both_ready' THEN daily_room_expires_at ELSE NULL END,
    daily_room_provider_verify_reason = CASE
      WHEN v_session.ready_gate_status = 'both_ready'
        THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_actionability_terminal_diagnostic')
      ELSE NULL
    END,
    prepare_entry_started_at = NULL,
    prepare_entry_expires_at = NULL,
    prepare_entry_attempt_id = NULL,
    prepare_entry_actor_id = NULL,
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = v_now,
    ended_reason = COALESCE(ended_reason, v_reason),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
    AND entry_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
    AND COALESCE(phase, 'ready_gate') NOT IN ('entry', 'date')
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', v_session.id,
      'event_id', v_session.event_id,
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'code', 'TERMINALIZE_LOST_RACE',
      'error', 'terminalize_lost_race',
      'retryable', true,
      'terminalized', false
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now,
    updated_at = v_now
  WHERE event_id = v_after.event_id
    AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
    AND queue_status IS DISTINCT FROM 'in_survey'
    AND (
      current_room_id = v_after.id
      OR queue_status = 'in_ready_gate'
      OR current_partner_id IN (v_after.participant_1_id, v_after.participant_2_id)
    );

  GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

  BEGIN
    PERFORM public.record_event_loop_observability(
      'ready_gate_transition',
      'success',
      v_reason,
      NULL,
      v_after.event_id,
      p_actor_id,
      p_session_id,
      jsonb_build_object(
        'action', 'ready_gate_actionability_terminalize',
        'reason', v_reason,
        'status_before', v_session.ready_gate_status,
        'status_after', v_after.ready_gate_status,
        'registration_rows', v_registration_rows,
        'detail', COALESCE(p_detail, '{}'::jsonb)
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  IF COALESCE(NULLIF(v_after.daily_room_name, ''), NULLIF(v_session.daily_room_name, '')) IS NOT NULL
     AND v_after.ready_gate_status IS DISTINCT FROM 'both_ready' THEN
    BEGIN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'daily.delete_video_date_room',
        jsonb_build_object(
          'roomName', COALESCE(NULLIF(v_session.daily_room_name, ''), NULLIF(v_after.daily_room_name, '')),
          'source', 'video_date_terminalize_ready_gate_session_v1',
          'reason', v_reason
        ),
        'phase3:delete_room:' || p_session_id::text || ':' || v_reason,
        v_now
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        p_detail := COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
          'delete_room_enqueue_degraded', true,
          'delete_room_enqueue_sqlstate', SQLSTATE,
          'delete_room_enqueue_message', v_message
        );
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'success', true,
    'session_id', v_after.id,
    'event_id', v_after.event_id,
    'status', v_after.ready_gate_status,
    'ready_gate_status', v_after.ready_gate_status,
    'result_status', v_after.ready_gate_status,
    'result_ready_gate_status', v_after.ready_gate_status,
    'reason', v_reason,
    'error_code', upper(v_reason),
    'ended_reason', v_after.ended_reason,
    'terminal', true,
    'terminalized', true,
    'registration_rows', v_registration_rows,
    'detail', COALESCE(p_detail, '{}'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_session_mark_ready_v2.single_body_core (rebuild PR 4): actionability
-- precheck -> event-inactive sweep -> decisive command core -> both-ready
-- entry protection -> partner/date-starting notifications -> enrichment ->
-- both-ready route payload owner, inside the hot-path no-throw shell.
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    COALESCE(p_session_id::text, 'missing-session') || ':phase3:mark_ready'
  );
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_precheck jsonb;
  v_begin jsonb;
  v_command_id bigint;
  v_command_status text;
  v_request_hash text;
  v_replay_result jsonb := '{}'::jsonb;
  v_replay_retryable boolean := false;
  v_replay_terminal boolean := false;
  v_reopened_retryable_command boolean := false;
  v_reclaimed_processing_command boolean := false;
  v_command_created_at timestamptz;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_is_p1 boolean := false;
  v_actor_ready boolean := false;
  v_new_p1_ready_at timestamptz;
  v_new_p2_ready_at timestamptz;
  v_new_status text;
  v_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_inactive_reason text;
  v_status text;
  v_date_capable boolean := false;
  v_cleanup jsonb := '{}'::jsonb;
  v_result jsonb;
  v_clean_result jsonb;
  v_protection jsonb;
  v_success boolean := false;
  v_event_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner_id uuid;
  v_recipient uuid;
  v_enqueue_result jsonb;
  v_path text;
  v_notification_degraded boolean := false;
  v_date_starting_degraded boolean := false;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- ── Hot-path no-throw shell: everything below returns structured JSON. ──
  BEGIN
    -- ── Decisive actionability precheck (owner-eligibility + participant
    -- eligibility + safety + registration, locking the session and both
    -- registration rows; invalid gates terminalize). ──
    v_precheck := public.video_date_ready_gate_actionability_v1(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      false,
      true,
      true,
      true
    );

    IF lower(COALESCE(v_precheck ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
      v_result := v_precheck
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        || jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', p_session_id,
          'commandStatus', 'rejected',
          'decisive_mark_ready_prechecked', true,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    ELSE
      -- ── Event-inactive sweep (former routeable_entry pre-pass): events
      -- that died between the precheck statement and this statement still
      -- terminalize their gates before the decisive commit. ──
      IF p_session_id IS NOT NULL THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND v_session.event_id IS NOT NULL
           AND v_session.ended_at IS NULL
           AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
           AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
           AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
          v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
          IF v_inactive_reason IS NOT NULL THEN
            PERFORM public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);
          END IF;
          v_inactive_reason := NULL;
        END IF;
      END IF;

      -- ── Decisive event-cleanup command core. Its own handlers own the
      -- READY_GATE_TRANSITION_TIMEOUT / MARK_READY_FAILED payloads and the
      -- command-finish bookkeeping. ──
      BEGIN
        PERFORM set_config('lock_timeout', '10000ms', true);
        PERFORM set_config('statement_timeout', '20000ms', true);

        IF p_session_id IS NULL THEN
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'session_not_found',
            'reason', 'session_not_found',
            'code', 'SESSION_NOT_FOUND',
            'error_code', 'SESSION_NOT_FOUND',
            'retryable', false,
            'terminal', true,
            'commandStatus', 'rejected',
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        ELSIF v_actor IS NULL THEN
          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'not_authenticated',
            'reason', 'not_authenticated',
            'code', 'NOT_AUTHENTICATED',
            'error_code', 'NOT_AUTHENTICATED',
            'retryable', false,
            'terminal', false,
            'commandStatus', 'rejected',
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        ELSE
          v_begin := public.video_session_command_begin_v2(
            p_session_id,
            v_actor,
            'mark_ready',
            v_key,
            v_request,
            p_request_hash
          );

          IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
            v_result := COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
              'ok', false,
              'success', false,
              'commandStatus', COALESCE(v_begin->>'status', 'rejected'),
              'terminal', false,
              'server_now_ms', v_server_now_ms,
              'serverNowMs', v_server_now_ms
            );
          ELSE
            v_command_status := COALESCE(v_begin->>'status', 'unknown');
            v_command_id := NULLIF(v_begin->>'commandId', '')::bigint;
            v_request_hash := v_begin->>'requestHash';
            v_result := NULL;

            IF v_command_status IN ('replay', 'replay_rejected', 'in_progress') THEN
              SELECT *
              INTO v_after
              FROM public.video_sessions
              WHERE id = p_session_id;

              v_actor_ready := (
                (v_after.participant_1_id = v_actor AND v_after.ready_participant_1_at IS NOT NULL)
                OR (v_after.participant_2_id = v_actor AND v_after.ready_participant_2_at IS NOT NULL)
                OR v_after.ready_gate_status = 'both_ready'
              );

              IF v_actor_ready AND v_command_status IS DISTINCT FROM 'in_progress' THEN
                v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'commandStatus', v_command_status,
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'result_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
                  'event_id', v_after.event_id,
                  'participant_1_id', v_after.participant_1_id,
                  'participant_2_id', v_after.participant_2_id,
                  'ready_participant_1_at', v_after.ready_participant_1_at,
                  'ready_participant_2_at', v_after.ready_participant_2_at,
                  'ready_gate_expires_at', v_after.ready_gate_expires_at,
                  'daily_room_name', v_after.daily_room_name,
                  'daily_room_url', v_after.daily_room_url,
                  'daily_room_verified_at', v_after.daily_room_verified_at,
                  'daily_room_expires_at', v_after.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
                  'session_seq', v_after.session_seq,
                  'terminal', v_after.ready_gate_status = 'both_ready',
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            END IF;

            IF v_result IS NULL AND v_command_status = 'replay' THEN
              v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
                'commandStatus', 'replay',
                'commandId', v_command_id,
                'requestHash', v_request_hash,
                'status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'result_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'result_ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
                'ready_participant_1_at', v_after.ready_participant_1_at,
                'ready_participant_2_at', v_after.ready_participant_2_at,
                'ready_gate_expires_at', v_after.ready_gate_expires_at,
                'daily_room_name', v_after.daily_room_name,
                'daily_room_url', v_after.daily_room_url,
                'session_seq', v_after.session_seq,
                'server_now_ms', v_server_now_ms,
                'serverNowMs', v_server_now_ms
              );
            END IF;

            IF v_result IS NULL AND v_command_status = 'replay_rejected' THEN
              v_replay_result := COALESCE(v_begin->'result', '{}'::jsonb);
              v_replay_retryable :=
                jsonb_typeof(v_replay_result->'retryable') = 'boolean'
                AND (v_replay_result->>'retryable')::boolean;
              v_replay_terminal :=
                jsonb_typeof(v_replay_result->'terminal') = 'boolean'
                AND (v_replay_result->>'terminal')::boolean;

              IF v_replay_retryable AND NOT v_replay_terminal THEN
                UPDATE public.video_session_commands
                SET
                  status = 'processing',
                  committed_at = NULL,
                  result_payload = NULL
                WHERE id = v_command_id
                  AND actor = v_actor
                  AND session_id = p_session_id
                  AND command_kind = 'mark_ready'
                  AND idempotency_key = v_key
                  AND request_hash = v_request_hash
                  AND status = 'rejected'
                RETURNING id INTO v_command_id;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                IF v_row_count = 0 THEN
                  v_result := v_replay_result || jsonb_build_object(
                    'commandStatus', 'replay_rejected',
                    'commandId', NULLIF(v_begin->>'commandId', '')::bigint,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                ELSE
                  v_reopened_retryable_command := true;
                END IF;
              ELSE
                v_result := v_replay_result || jsonb_build_object(
                  'commandStatus', 'replay_rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'result_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'result_ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            ELSIF v_result IS NULL AND v_command_status = 'in_progress' THEN
              SELECT created_at
              INTO v_command_created_at
              FROM public.video_session_commands
              WHERE id = v_command_id
                AND actor = v_actor
                AND session_id = p_session_id
                AND command_kind = 'mark_ready'
                AND idempotency_key = v_key
                AND request_hash = v_request_hash;

              IF v_command_created_at IS NOT NULL
                 AND v_command_created_at < v_now - interval '6 seconds' THEN
                UPDATE public.video_session_commands
                SET
                  status = 'processing',
                  committed_at = NULL,
                  result_payload = NULL
                WHERE id = v_command_id
                  AND actor = v_actor
                  AND session_id = p_session_id
                  AND command_kind = 'mark_ready'
                  AND idempotency_key = v_key
                  AND request_hash = v_request_hash
                  AND status = 'processing'
                RETURNING id INTO v_command_id;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;
                v_reclaimed_processing_command := v_row_count > 0;
              END IF;

              IF NOT v_reclaimed_processing_command THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'command_in_progress',
                  'reason', 'command_in_progress',
                  'retryable', true,
                  'retry_after_seconds', 1,
                  'retry_after_ms', 1000,
                  'commandStatus', 'in_progress',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'terminal', false,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
              END IF;
            ELSIF v_result IS NULL AND v_command_status IS DISTINCT FROM 'started' THEN
              v_result := jsonb_build_object(
                'ok', false,
                'success', false,
                'error', 'command_in_progress',
                'reason', 'command_in_progress',
                'retryable', true,
                'retry_after_seconds', 1,
                'retry_after_ms', 1000,
                'commandStatus', v_command_status,
                'commandId', v_command_id,
                'requestHash', v_request_hash,
                'terminal', false,
                'server_now_ms', v_server_now_ms,
                'serverNowMs', v_server_now_ms
              );
            END IF;

            IF v_result IS NULL THEN
              SELECT *
              INTO v_session
              FROM public.video_sessions
              WHERE id = p_session_id
              FOR UPDATE;

              IF NOT FOUND THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'session_not_found',
                  'reason', 'session_not_found',
                  'code', 'SESSION_NOT_FOUND',
                  'error_code', 'SESSION_NOT_FOUND',
                  'retryable', false,
                  'terminal', true,
                  'commandStatus', 'rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSE
                v_is_p1 := v_session.participant_1_id = v_actor;
                IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
                  v_result := jsonb_build_object(
                    'ok', false,
                    'success', false,
                    'error', 'not_participant',
                    'reason', 'not_participant',
                    'retryable', false,
                    'terminal', true,
                    'commandStatus', 'rejected',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                END IF;
              END IF;
            END IF;

            IF v_result IS NULL THEN
              IF v_session.event_id IS NOT NULL
                 AND v_session.ended_at IS NULL
                 AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
                 AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
                 AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
                v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
              END IF;

              IF v_inactive_reason IS NOT NULL THEN
                UPDATE public.video_sessions
                SET
                  ready_gate_status = 'expired',
                  state = 'ended'::public.video_date_state,
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = COALESCE(ended_reason, v_inactive_reason),
                  snoozed_by = NULL,
                  snooze_expires_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND COALESCE(state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
                  AND COALESCE(phase, 'ready_gate') = 'ready_gate'
                  AND COALESCE(ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                RETURNING * INTO v_after;

                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = p_session_id;

                v_status := COALESCE(v_after.ready_gate_status, v_session.ready_gate_status, 'expired');
                v_date_capable := (
                  v_after.entry_started_at IS NOT NULL
                  OR v_after.date_started_at IS NOT NULL
                  OR v_after.daily_room_name IS NOT NULL
                  OR v_after.daily_room_url IS NOT NULL
                  OR v_after.participant_1_joined_at IS NOT NULL
                  OR v_after.participant_2_joined_at IS NOT NULL
                  OR v_after.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                  OR COALESCE(v_after.phase, '') IN ('entry', 'date')
                );
                v_cleanup := jsonb_build_object('session_terminalized', true);

                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', v_status,
                  'ready_gate_status', v_status,
                  'result_status', v_status,
                  'result_ready_gate_status', v_status,
                  'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
                  'reason', COALESCE(v_after.ended_reason, v_inactive_reason),
                  'error_code', COALESCE(v_after.ended_reason, v_inactive_reason),
                  'inactive_reason', v_inactive_reason,
                  'date_capable', v_date_capable,
                  'terminal', true,
                  'event_id', COALESCE(v_after.event_id, v_session.event_id),
                  'event_active_preflight_blocked', true,
                  'cleanup', v_cleanup,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ended_at IS NOT NULL
                 OR v_session.ready_gate_status IN ('forfeited', 'expired', 'cancelled', 'ended') THEN
                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'result_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                  'terminal', true,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ready_gate_status = 'both_ready' THEN
                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', 'both_ready',
                  'ready_gate_status', 'both_ready',
                  'result_status', 'both_ready',
                  'result_ready_gate_status', 'both_ready',
                  'event_id', v_session.event_id,
                  'participant_1_id', v_session.participant_1_id,
                  'participant_2_id', v_session.participant_2_id,
                  'ready_participant_1_at', v_session.ready_participant_1_at,
                  'ready_participant_2_at', v_session.ready_participant_2_at,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'daily_room_name', v_session.daily_room_name,
                  'daily_room_url', v_session.daily_room_url,
                  'daily_room_verified_at', v_session.daily_room_verified_at,
                  'daily_room_expires_at', v_session.daily_room_expires_at,
                  'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason,
                  'session_seq', v_session.session_seq,
                  'terminal', true,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
                 OR v_session.entry_started_at IS NOT NULL
                 OR v_session.date_started_at IS NOT NULL
                 OR v_session.participant_1_joined_at IS NOT NULL
                 OR v_session.participant_2_joined_at IS NOT NULL
                 OR v_session.ready_gate_status NOT IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
                v_result := jsonb_build_object(
                  'ok', false,
                  'success', false,
                  'error', 'session_no_longer_ready_gate_mutable',
                  'reason', 'session_no_longer_ready_gate_mutable',
                  'status', v_session.ready_gate_status,
                  'ready_gate_status', v_session.ready_gate_status,
                  'result_status', v_session.ready_gate_status,
                  'result_ready_gate_status', v_session.ready_gate_status,
                  'terminal', false,
                  'retryable', true,
                  'retry_after_ms', 1000,
                  'commandStatus', 'rejected',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSIF v_session.ready_gate_expires_at IS NOT NULL
                 AND v_session.ready_gate_expires_at <= v_now THEN
                UPDATE public.video_sessions
                SET
                  ready_gate_status = 'expired',
                  state = 'ended'::public.video_date_state,
                  phase = 'ended',
                  ended_at = v_now,
                  ended_reason = COALESCE(ended_reason, 'ready_gate_expired'),
                  snoozed_by = NULL,
                  snooze_expires_at = NULL,
                  duration_seconds = COALESCE(
                    duration_seconds,
                    GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                  ),
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND state = 'ready_gate'::public.video_date_state
                  AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                  AND entry_started_at IS NULL
                  AND date_started_at IS NULL
                  AND participant_1_joined_at IS NULL
                  AND participant_2_joined_at IS NULL
                RETURNING * INTO v_after;

                BEGIN
                  UPDATE public.event_registrations
                  SET
                    queue_status = 'idle',
                    current_room_id = NULL,
                    current_partner_id = NULL,
                    last_active_at = v_now
                  WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
                    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                    AND current_room_id = p_session_id;
                EXCEPTION WHEN OTHERS THEN
                  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                  BEGIN
                    PERFORM public.video_date_lifecycle_observe_exception_v2(
                      p_session_id, v_actor,
                      'video_session_mark_ready_v2.expired_registration_cleanup',
                      SQLSTATE, v_message, NULL, NULL);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                  v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                    'kind', 'expired_registration_cleanup'
                  ));
                END;

                v_result := jsonb_build_object(
                  'ok', true,
                  'success', true,
                  'status', 'expired',
                  'ready_gate_status', 'expired',
                  'result_status', 'expired',
                  'result_ready_gate_status', 'expired',
                  'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
                  'reason', 'ready_gate_expired',
                  'error_code', 'ready_gate_expired',
                  'terminal', true,
                  'auxiliary_errors', v_auxiliary_errors,
                  'commandStatus', 'committed',
                  'commandId', v_command_id,
                  'requestHash', v_request_hash,
                  'server_now_ms', v_server_now_ms,
                  'serverNowMs', v_server_now_ms
                );
                BEGIN
                  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                EXCEPTION WHEN OTHERS THEN
                  NULL;
                END;
              ELSE
                v_new_p1_ready_at := v_session.ready_participant_1_at;
                v_new_p2_ready_at := v_session.ready_participant_2_at;

                IF v_is_p1 THEN
                  v_new_p1_ready_at := COALESCE(v_new_p1_ready_at, v_now);
                ELSE
                  v_new_p2_ready_at := COALESCE(v_new_p2_ready_at, v_now);
                END IF;

                IF v_new_p1_ready_at IS NOT NULL AND v_new_p2_ready_at IS NOT NULL THEN
                  v_new_status := 'both_ready';
                ELSIF v_is_p1 THEN
                  v_new_status := 'ready_a';
                ELSE
                  v_new_status := 'ready_b';
                END IF;

                v_expires_at := GREATEST(
                  COALESCE(v_session.ready_gate_expires_at, v_now),
                  v_now + interval '45 seconds'
                );

                IF v_new_status = 'both_ready' THEN
                  v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');
                  IF v_domain IS NULL AND v_session.daily_room_url IS NOT NULL THEN
                    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
                  END IF;
                  IF v_domain IS NULL THEN
                    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
                    INTO v_domain
                    FROM public.video_sessions vs
                    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
                    ORDER BY vs.state_updated_at DESC NULLS LAST
                    LIMIT 1;
                  END IF;
                  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
                  v_url := 'https://' || v_domain || '/' || v_expected_room_name;
                END IF;

                UPDATE public.video_sessions
                SET
                  ready_participant_1_at = v_new_p1_ready_at,
                  ready_participant_2_at = v_new_p2_ready_at,
                  ready_gate_status = v_new_status,
                  ready_gate_expires_at = v_expires_at,
                  daily_room_name = CASE
                    WHEN v_new_status = 'both_ready' THEN v_expected_room_name
                    ELSE daily_room_name
                  END,
                  daily_room_url = CASE
                    WHEN v_new_status = 'both_ready' THEN v_url
                    ELSE daily_room_url
                  END,
                  daily_room_provider_verify_reason = CASE
                    WHEN v_new_status = 'both_ready'
                      THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_mark_ready_decisive_commit')
                    ELSE daily_room_provider_verify_reason
                  END,
                  state = 'ready_gate'::public.video_date_state,
                  phase = 'ready_gate',
                  state_updated_at = v_now
                WHERE id = p_session_id
                  AND ended_at IS NULL
                  AND state = 'ready_gate'::public.video_date_state
                  AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
                  AND entry_started_at IS NULL
                  AND date_started_at IS NULL
                  AND participant_1_joined_at IS NULL
                  AND participant_2_joined_at IS NULL
                RETURNING * INTO v_after;

                GET DIAGNOSTICS v_row_count = ROW_COUNT;

                IF v_row_count = 0 THEN
                  SELECT *
                  INTO v_after
                  FROM public.video_sessions
                  WHERE id = p_session_id;

                  v_result := jsonb_build_object(
                    'ok', false,
                    'success', false,
                    'error', 'guarded_update_zero_rows',
                    'reason', 'guarded_update_zero_rows',
                    'status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
                    'retryable', true,
                    'retry_after_ms', 1000,
                    'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
                    'commandStatus', 'rejected',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                ELSE
                  v_result := jsonb_build_object(
                    'ok', true,
                    'success', true,
                    'commandStatus', 'committed',
                    'commandId', v_command_id,
                    'requestHash', v_request_hash,
                    'status', v_after.ready_gate_status,
                    'ready_gate_status', v_after.ready_gate_status,
                    'result_status', v_after.ready_gate_status,
                    'result_ready_gate_status', v_after.ready_gate_status,
                    'event_id', v_after.event_id,
                    'participant_1_id', v_after.participant_1_id,
                    'participant_2_id', v_after.participant_2_id,
                    'ready_participant_1_at', v_after.ready_participant_1_at,
                    'ready_participant_2_at', v_after.ready_participant_2_at,
                    'ready_gate_expires_at', v_after.ready_gate_expires_at,
                    'snoozed_by', v_after.snoozed_by,
                    'snooze_expires_at', v_after.snooze_expires_at,
                    'daily_room_name', v_after.daily_room_name,
                    'daily_room_url', v_after.daily_room_url,
                    'daily_room_verified_at', v_after.daily_room_verified_at,
                    'daily_room_expires_at', v_after.daily_room_expires_at,
                    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
                    'session_seq', v_after.session_seq,
                    'terminal', v_after.ready_gate_status = 'both_ready',
                    'provider_outbox_degraded', false,
                    'retryable_command_reopened', v_reopened_retryable_command,
                    'reclaimed_processing_command', v_reclaimed_processing_command,
                    'hot_path', true,
                    'decisive_mark_ready_commit', true,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );

                  BEGIN
                    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.command_finish',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_result := v_result || jsonb_build_object(
                      'command_finish_degraded', true
                    );
                  END;

                  BEGIN
                    PERFORM public.record_event_loop_observability(
                      'ready_gate_transition',
                      'success',
                      'mark_ready',
                      NULL,
                      v_after.event_id,
                      v_actor,
                      p_session_id,
                      jsonb_build_object(
                        'action', 'mark_ready',
                        'hot_path', true,
                        'decisive_mark_ready_commit', true,
                        'status_before', v_session.ready_gate_status,
                        'status_after', v_after.ready_gate_status,
                        'ready_participant_1_at_before', v_session.ready_participant_1_at,
                        'ready_participant_1_at_after', v_after.ready_participant_1_at,
                        'ready_participant_2_at_before', v_session.ready_participant_2_at,
                        'ready_participant_2_at_after', v_after.ready_participant_2_at,
                        'ready_gate_expires_at_before', v_session.ready_gate_expires_at,
                        'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
                        'daily_room_name', v_after.daily_room_name,
                        'retryable_command_reopened', v_reopened_retryable_command,
                        'reclaimed_processing_command', v_reclaimed_processing_command
                      )
                    );
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.observability',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'observability'
                    ));
                  END;

                  BEGIN
                    PERFORM public.append_video_session_event_v2(
                      p_session_id,
                      CASE WHEN v_after.ready_gate_status = 'both_ready' THEN 'ready_gate_both_ready' ELSE 'ready_gate_mark_ready' END,
                      'participants',
                      v_actor,
                      jsonb_build_object(
                        'action', 'mark_ready',
                        'ready_gate_status', v_after.ready_gate_status,
                        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END,
                        'hot_path', true,
                        'decisive_mark_ready_commit', true
                      ),
                      jsonb_build_object(
                        'ready_gate_status', v_after.ready_gate_status,
                        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END
                      ),
                      true,
                      gen_random_uuid()
                    );
                  EXCEPTION WHEN OTHERS THEN
                    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.event_append',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'event_append'
                    ));
                  END;

                  IF v_after.ready_gate_status = 'both_ready' THEN
                    BEGIN
                      PERFORM public.video_date_outbox_enqueue_v2(
                        p_session_id,
                        'daily.ensure_video_date_room',
                        jsonb_build_object(
                          'roomName', COALESCE(NULLIF(v_after.daily_room_name, ''), v_expected_room_name),
                          'source', 'video_session_mark_ready_v2_decisive_commit'
                        ),
                        'phase3:ensure_room:' || p_session_id::text,
                        now()
                      );
                    EXCEPTION WHEN OTHERS THEN
                      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
                      BEGIN
                        PERFORM public.video_date_lifecycle_observe_exception_v2(
                          p_session_id, v_actor,
                          'video_session_mark_ready_v2.daily_room_outbox',
                          SQLSTATE, v_message, NULL, NULL);
                      EXCEPTION WHEN OTHERS THEN
                        NULL;
                      END;
                      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                        'kind', 'daily_room_outbox'
                      ));
                    END;
                  END IF;

                  v_result := v_result || jsonb_build_object(
                    'session_seq', v_after.session_seq,
                    'auxiliary_errors', v_auxiliary_errors,
                    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0
                  );
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;
      EXCEPTION
        WHEN query_canceled OR lock_not_available THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core_timeout',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

          BEGIN
            SELECT *
            INTO v_after
            FROM public.video_sessions
            WHERE id = p_session_id;
          EXCEPTION WHEN OTHERS THEN
            v_after := NULL;
          END;

          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'mark_ready_timeout',
            'reason', 'mark_ready_timeout',
            'code', 'READY_GATE_TRANSITION_TIMEOUT',
            'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
            'retryable', true,
            'retry_after_seconds', 1,
            'retry_after_ms', 1000,
            'status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
            'commandStatus', 'rejected',
            'commandId', v_command_id,
            'requestHash', v_request_hash,
            'hot_path', true,
            'decisive_mark_ready_commit', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );

          IF v_command_id IS NOT NULL THEN
            BEGIN
              PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

          BEGIN
            SELECT *
            INTO v_after
            FROM public.video_sessions
            WHERE id = p_session_id;
          EXCEPTION WHEN OTHERS THEN
            v_after := NULL;
          END;

          v_result := jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'mark_ready_failed',
            'reason', 'mark_ready_failed',
            'code', 'MARK_READY_FAILED',
            'error_code', 'MARK_READY_FAILED',
            'retryable', true,
            'retry_after_seconds', 1,
            'retry_after_ms', 1000,
            'status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
            'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
            'commandStatus', 'rejected',
            'commandId', v_command_id,
            'requestHash', v_request_hash,
            'hot_path', true,
            'decisive_mark_ready_commit', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );

          IF v_command_id IS NOT NULL THEN
            BEGIN
              PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END;
          END IF;
      END;

      -- ── Both-ready entry protection (former review_comments post): runs on
      -- the un-enriched core result. ──
      v_success := COALESCE(
        NULLIF(v_result ->> 'success', '')::boolean,
        NULLIF(v_result ->> 'ok', '')::boolean,
        false
      );
      v_status := COALESCE(
        NULLIF(v_result ->> 'ready_gate_status', ''),
        NULLIF(v_result ->> 'result_ready_gate_status', ''),
        NULLIF(v_result ->> 'status', '')
      );

      IF v_success AND v_status = 'both_ready' THEN
        v_protection := public.video_date_protect_both_ready_entry_v1(
          p_session_id,
          v_actor,
          NULL,
          'video_session_mark_ready_v2'
        );

        IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
          v_result := v_result || jsonb_build_object(
            'entry_protection', 'active',
            'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
            'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
            'daily_room_name', v_protection ->> 'daily_room_name',
            'daily_room_url', v_protection ->> 'daily_room_url',
            'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at'
          );
        ELSE
          v_result := v_result || jsonb_build_object(
            'entry_protection', 'failed',
            'entry_protection_code', v_protection ->> 'code'
          );
        END IF;
      END IF;

      -- ── First-ready partner notification (former terminal_truth post). ──
      v_event_id := NULLIF(v_result ->> 'event_id', '')::uuid;
      v_p1 := NULLIF(v_result ->> 'participant_1_id', '')::uuid;
      v_p2 := NULLIF(v_result ->> 'participant_2_id', '')::uuid;
      v_partner_id := CASE
        WHEN v_actor IS NOT NULL AND v_actor = v_p1 THEN v_p2
        WHEN v_actor IS NOT NULL AND v_actor = v_p2 THEN v_p1
        ELSE NULL
      END;

      IF v_success
         AND v_status IN ('ready_a', 'ready_b')
         AND v_partner_id IS NOT NULL THEN
        BEGIN
          PERFORM public.video_date_outbox_enqueue_v2(
            p_session_id,
            'notification.send',
            jsonb_build_object(
              'user_id', v_partner_id,
              'recipient_id', v_partner_id,
              'match_user_id', v_actor,
              'category', 'partner_ready',
              'title', 'Your match is ready!',
              'body', 'Tap to start your video date',
              'data', jsonb_build_object(
                'session_id', p_session_id,
                'event_id', v_event_id,
                'ready_gate_status', v_status,
                'actor_id', v_actor,
                'source', 'video_session_mark_ready_v2_first_ready'
              ),
              'dedupe_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'provider_idempotency_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'source', 'video_session_mark_ready_v2',
              'event_id', v_event_id,
              'session_id', p_session_id,
              'actor_id', v_actor
            ),
            'notification:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
            now()
          );
        EXCEPTION
          WHEN OTHERS THEN
            v_notification_degraded := true;
        END;
      END IF;

      v_result := v_result || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'partner_ready_notification_degraded', v_notification_degraded
      );
    END IF;

    -- ── Enrichment (former both_ready_owner post): applies to every outcome,
    -- including precheck rejections. ──
    BEGIN
      v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_session_mark_ready_v2',
        v_result
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_result := COALESCE(v_result, '{}'::jsonb)
          - 'message'
          - 'detail'
          - 'hint'
          || jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'error', 'mark_ready_enrichment_failed',
            'reason', 'mark_ready_enrichment_failed',
            'code', 'MARK_READY_ENRICHMENT_FAILED',
            'error_code', 'MARK_READY_ENRICHMENT_FAILED',
            'retryable', true
          );
    END;

    -- ── Both-ready route owner (former active_entry post): safety-payload
    -- hygiene, date_starting notifications, route payload, shell markers. ──
    v_clean_result := COALESCE(v_result, '{}'::jsonb);
    IF COALESCE(v_clean_result ->> 'code', v_clean_result ->> 'error_code') = 'SAFETY_CHECK_UNAVAILABLE' THEN
      v_clean_result := v_clean_result
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        - 'auxiliary_errors';
    END IF;

    v_success := lower(COALESCE(v_clean_result ->> 'success', v_clean_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
    v_status := COALESCE(
      NULLIF(v_clean_result ->> 'ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'result_ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'status', '')
    );

    IF v_success AND v_status = 'both_ready' THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND THEN
        v_path := '/date/' || p_session_id::text;
        FOREACH v_recipient IN ARRAY ARRAY[v_session.participant_1_id, v_session.participant_2_id]
        LOOP
          BEGIN
            v_enqueue_result := public.video_date_outbox_enqueue_v2(
              p_session_id,
              'notification.send',
              jsonb_build_object(
                'user_id', v_recipient,
                'recipient_id', v_recipient,
                'match_user_id', CASE
                  WHEN v_recipient = v_session.participant_1_id THEN v_session.participant_2_id
                  ELSE v_session.participant_1_id
                END,
                'category', 'date_starting',
                'title', 'Your video date is starting',
                'body', 'Tap to join your video date',
                'data', jsonb_build_object(
                  'session_id', p_session_id,
                  'event_id', v_session.event_id,
                  'ready_gate_status', v_status,
                  'actor_id', v_actor,
                  'url', v_path,
                  'deep_link', v_path,
                  'source', 'video_session_mark_ready_v2_both_ready'
                ),
                'dedupe_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'provider_idempotency_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'source', 'video_session_mark_ready_v2',
                'event_id', v_session.event_id,
                'session_id', p_session_id,
                'actor_id', v_actor
              ),
              'notification:date_starting:' || p_session_id::text || ':' || v_recipient::text,
              now()
            );

            IF lower(COALESCE(v_enqueue_result ->> 'ok', v_enqueue_result ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
              v_date_starting_degraded := true;
            END IF;
          EXCEPTION
            WHEN OTHERS THEN
              v_date_starting_degraded := true;
          END;
        END LOOP;
      END IF;
    END IF;

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_clean_result || jsonb_build_object(
        'date_starting_notification_degraded', v_date_starting_degraded,
        'both_ready_route_owner_checked', true
      ),
      'video_session_mark_ready_v2.both_ready_owner'
    ) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_session_mark_ready_v2.hot_path_shell',
          'mark_ready_unavailable',
          'MARK_READY_UNAVAILABLE',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'commandStatus', 'rejected'
        );
      EXCEPTION
        WHEN OTHERS THEN
          BEGIN
            RETURN public.video_date_direct_json_fallback_v1(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2',
              'mark_ready_wrapper_failed',
              'MARK_READY_WRAPPER_FAILED',
              true,
              SQLSTATE
            ) || jsonb_build_object(
              'hot_path_no_throw_shell', true,
              'active_entry_failsoft_shell', true,
              'commandStatus', 'rejected'
            );
          EXCEPTION
            WHEN OTHERS THEN
              RETURN jsonb_build_object(
                'ok', false,
                'success', false,
                'session_id', p_session_id,
                'rpc', 'video_session_mark_ready_v2',
                'error', 'mark_ready_unavailable',
                'reason', 'mark_ready_unavailable',
                'code', 'MARK_READY_UNAVAILABLE',
                'error_code', 'MARK_READY_UNAVAILABLE',
                'retryable', true,
                'terminal', false,
                'commandStatus', 'rejected',
                'hot_path_no_throw_shell', true,
                'active_entry_failsoft_shell', true,
                'last_resort_payload', true,
                'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
              );
          END;
      END;
  END;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_session_mark_ready_v2',
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. Drop the folded generations and handshake-named twins (all call sites
--    re-pointed above; no remaining in-DB, client, or Edge callers)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.expire_stale_video_sessions_20260501103000_unbounded();
DROP FUNCTION public.expire_stale_video_sessions_bounded(integer);
DROP FUNCTION public.expire_stale_video_sessions_bounded_202605031300_base(integer);
DROP FUNCTION public.expire_stale_vsessions_bounded_202605060900_base(integer);
DROP FUNCTION public.expire_stale_vsessions_bounded_202605232020_base(integer);
DROP FUNCTION public.expire_stale_video_date_phases();
DROP FUNCTION public.expire_vd_phases_base_20260501133000(integer);
DROP FUNCTION public.expire_vd_phases_base_20260502143000(integer);
DROP FUNCTION public.expire_due_joined_video_date_handshakes_bounded(integer);
DROP FUNCTION public.expire_vd_reconnect_graces_202606071031_base();
DROP FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text);
DROP FUNCTION public.finalize_vd_handshake_deadline_20260603090000_base(uuid, uuid, text, text);
DROP FUNCTION public.finalize_vd_handshake_deadline_20260605085010_base(uuid, uuid, text, text);
DROP FUNCTION public.finalize_vd_handshake_deadline_20260605115657_base(uuid, uuid, text, text);
DROP FUNCTION public.finalize_video_date_handshake_deadline_20260603215948_handoff_b(uuid, uuid, text, text);
DROP FUNCTION public.repair_stale_vd_prepare_both_join_v1(integer);
DROP FUNCTION public.get_or_seed_video_session_vibe_questions_20260607155414_lifecyc(uuid, jsonb);
DROP FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb);
DROP FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid);
DROP FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text);
DROP FUNCTION public.record_vd_daily_webhook_v2_202606071031_base(text, text, text, text, text, timestamp with time zone, jsonb, timestamp with time zone);
DROP FUNCTION public.record_video_date_daily_webhook_event_v2_20260604193140_latest_(text, text, text, text, text, timestamp with time zone, jsonb, timestamp with time zone);
DROP FUNCTION public.record_video_date_daily_webhook_event_v2_20260603215948_handoff(text, text, text, text, text, timestamp with time zone, jsonb, timestamp with time zone);
DROP FUNCTION public.record_vd_launch_lat_20260609105249_active_base(uuid, text, jsonb, integer);
DROP FUNCTION public.record_vd_launch_latency_202605061020_base(uuid, text, jsonb, integer);
DROP FUNCTION public.record_vd_launch_latency_202605220240_base(uuid, text, jsonb, integer);
DROP FUNCTION public.record_vd_launch_latency_202605252340_base(uuid, text, jsonb, integer);
DROP FUNCTION public.record_vd_launch_latency_20260603150106_start_base(uuid, text, jsonb, integer);
DROP FUNCTION public.record_video_date_launch_latency_checkpoint_20260505214500_rpc_(uuid, text, jsonb, integer);
DROP FUNCTION public.vd_launch_latency_20260609130139_hot_base(uuid, text, jsonb, integer);
DROP FUNCTION public.submit_video_date_safety_report_v2_20260522011000_error_base(uuid, text, text, boolean, boolean, text);
DROP FUNCTION public.vd_promote_ce_auth_20260605221535_base(uuid, uuid, text, text, boolean);
DROP FUNCTION public.video_date_outbox_enqueue_v2_20260607103000_failsoft_base(uuid, text, jsonb, text, timestamp with time zone);
DROP FUNCTION public.video_session_continue_handshake_v2(uuid, text, text);
DROP FUNCTION public.video_session_continue_handshake_v2_20260603090000_remote_seen_(uuid, text, text);
DROP FUNCTION public.video_session_extend_date_v2_20260522011000_replay_base(uuid, text, text, text);
DROP FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text);
DROP FUNCTION public.video_session_handshake_auto_promote_v2_20260603090000_remote_s(uuid, text, text);
DROP FUNCTION public.vs_handshake_auto_promote_20260605115657_base(uuid, text, text);
