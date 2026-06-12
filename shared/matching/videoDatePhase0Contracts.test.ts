import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const phase0Migration = readFileSync(
  join(root, "supabase/migrations/20260521161000_video_date_phase0_observability_flags.sql"),
  "utf8",
);
const syntheticMonitor = readFileSync(
  join(root, "supabase/functions/synthetic-video-date-monitor/index.ts"),
  "utf8",
);
const supabaseConfig = readFileSync(join(root, "supabase/config.toml"), "utf8");
const flagCore = readFileSync(join(root, "shared/featureFlags/clientFeatureFlagCore.ts"), "utf8");
const videoDateFlags = readFileSync(join(root, "shared/featureFlags/videoDateV4Flags.ts"), "utf8");
const validationSql = readFileSync(join(root, "supabase/validation/video_date_phase0_observability_flags.sql"), "utf8");
const runtimeCopyEntities = readFileSync(join(root, "scripts/runtime-copy-entities.test.ts"), "utf8");
const autoNextRemovalMigration = readFileSync(
  join(root, "supabase/migrations/20260610000100_remove_post_date_instant_next.sql"),
  "utf8",
);
const entryContractMigration = readFileSync(
  join(root, "supabase/migrations/20260611114354_video_date_entry_contract_phase_de.sql"),
  "utf8",
);

test("Phase 0 keeps synthetic events out of user-facing event surfaces", () => {
  assert.match(phase0Migration, /ADD COLUMN IF NOT EXISTS is_test_event boolean NOT NULL DEFAULT false/);
  assert.match(phase0Migration, /DROP POLICY IF EXISTS "Anyone can view events"/);
  assert.match(phase0Migration, /CREATE POLICY "Anyone can view events"[\s\S]+COALESCE\(is_test_event, false\) = false/);
  assert.match(phase0Migration, /CREATE OR REPLACE FUNCTION public\.get_visible_events/);
  assert.match(phase0Migration, /category_keys\s+text\[\]/);
  assert.match(phase0Migration, /categories\s+jsonb/);
  assert.match(phase0Migration, /vibes\s+text\[\]/);
  assert.match(phase0Migration, /public\._get_user_tier_capability_bool_unchecked\(p_user_id, 'canCityBrowse'\)/);
  assert.match(phase0Migration, /public\._user_can_access_event_visibility_unchecked\(p_user_id, COALESCE\(e\.visibility, 'all'\)\)/);
  assert.match(phase0Migration, /WHERE e\.archived_at IS NULL[\s\S]+AND COALESCE\(e\.is_test_event, false\) = false/);
  assert.match(phase0Migration, /CREATE OR REPLACE FUNCTION public\.get_other_city_events/);
  assert.match(phase0Migration, /get_other_city_events[\s\S]+COALESCE\(e\.is_test_event, false\) = false/);
});

test("Phase 0 exposes service-role-only dashboard read models", () => {
  for (const view of [
    "vw_session_health",
    "vw_session_funnel",
    "vw_synthetic_video_date_health",
    "vw_video_date_flag_rollout",
    "vw_outbox_health",
  ]) {
    assert.match(phase0Migration, new RegExp(`CREATE OR REPLACE VIEW public\\.${view}`));
    assert.match(phase0Migration, new RegExp(`REVOKE ALL ON TABLE public\\.${view} FROM PUBLIC, anon, authenticated`));
    assert.match(phase0Migration, new RegExp(`GRANT SELECT ON TABLE public\\.${view} TO service_role`));
  }

  assert.match(phase0Migration, /sample_class/);
  assert.match(phase0Migration, /active_stuck_over_2m/);
  assert.match(phase0Migration, /stuck_over_2m_sessions/);
});

test("Phase 0 seeds every video-date flag default-off with hard-kill compatibility", () => {
  const historicalClientFlags = [
    "video_date.snapshot_v2",
    "video_date.readiness_v2",
    "video_date.micro_verdict_v2",
    "video_date.broadcast_v2",
    "video_date.timeline_v2",
    "video_date.extension_mutual_v2",
    "video_date.safety_always_on_v2",
    "video_date.outbox_v2.mark_ready",
    "video_date.outbox_v2.forfeit",
    "video_date.outbox_v2.continue_handshake",
    "video_date.outbox_v2.handshake_auto_promote",
    "video_date.outbox_v2.date_timeout",
    "video_date.outbox_v2.extension",
    "video_date.outbox_v2.safety",
  ];
  // PR 6 client single-path freeze: every previously client-read flag is
  // hard-coded to its live winner; no video_date.* keys remain client-read.
  const frozenClientFlags = [
    "video_date.snapshot_v2",
    "video_date.readiness_v2",
    "video_date.micro_verdict_v2",
    "video_date.broadcast_v2",
    "video_date.timeline_v2",
    "video_date.extension_mutual_v2",
    "video_date.safety_always_on_v2",
    "video_date.outbox_v2.mark_ready",
    "video_date.outbox_v2.forfeit",
    "video_date.outbox_v2.continue_entry",
    "video_date.outbox_v2.entry_auto_promote",
    "video_date.outbox_v2.date_timeout",
    "video_date.outbox_v2.extension",
    "video_date.outbox_v2.safety",
  ];
  // Seeded by Phase 0 but read only by DB functions (or retired from the
  // client path entirely, like submit_verdict after the v3 hard-coding); they
  // must not be declared in the client flag list.
  const serverOnlyOrRetiredFlags = [
    "video_date.deck_deal_v2",
    "video_date.daily_webhooks_v2",
    "video_date.daily_pool_v2",
    "video_date.outbox_v2.submit_verdict",
  ];
  const removedFlags = [
    "video_date.outbox_v2.drain_match_queue",
  ];

  for (const flag of historicalClientFlags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(phase0Migration, new RegExp(`'${escaped}', false, 0, [\\s\\S]+ false\\)`));
  }

  for (const flag of frozenClientFlags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(videoDateFlags, new RegExp(`"${escaped}"`));
  }

  for (const flag of [
    "video_date.outbox_v2.continue_handshake",
    "video_date.outbox_v2.handshake_auto_promote",
  ]) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(videoDateFlags, new RegExp(`"${escaped}"`));
  }

  for (const flag of [
    "video_date.outbox_v2.continue_entry",
    "video_date.outbox_v2.entry_auto_promote",
  ]) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(entryContractMigration, new RegExp(`'${escaped}'::text AS flag_key`));
    assert.match(entryContractMigration, new RegExp(`ON CONFLICT \\(flag_key\\) DO UPDATE`));
  }

  for (const flag of serverOnlyOrRetiredFlags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(videoDateFlags, new RegExp(`"${escaped}"`));
    assert.match(phase0Migration, new RegExp(`'${escaped}', false, 0, [\\s\\S]+ false\\)`));
  }

  for (const flag of removedFlags) {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(videoDateFlags, new RegExp(`"${escaped}"`));
    assert.match(phase0Migration, new RegExp(`'${escaped}', false, 0, [\\s\\S]+ false\\)`));
    assert.match(autoNextRemovalMigration, new RegExp(`DELETE FROM public\\.client_feature_flags[\\s\\S]*'${escaped}'`));
  }

  assert.match(flagCore, /VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS/);
  assert.match(phase0Migration, /ON CONFLICT \(flag_key\) DO UPDATE/);
});

test("synthetic monitor is cron-secret protected and test-event scoped", () => {
  assert.match(supabaseConfig, /\[functions\.synthetic-video-date-monitor\][\s\S]+verify_jwt = false/);
  assert.match(syntheticMonitor, /Deno\.env\.get\("CRON_SECRET"\)/);
  assert.match(syntheticMonitor, /function safeEqual/);
  assert.match(syntheticMonitor, /Authorization/);
  assert.match(syntheticMonitor, /x-cron-secret/);
  assert.match(syntheticMonitor, /vw_synthetic_video_date_health/);
  assert.match(syntheticMonitor, /vw_session_health/);
  assert.match(syntheticMonitor, /dashboard_view_error/);
  assert.match(syntheticMonitor, /Math\.max\(toInt\(selected\?\.stuck_over_2m_count\), stuckSessions\.length\)/);
  assert.match(syntheticMonitor, /record_event_loop_observability/);
  assert.doesNotMatch(syntheticMonitor, /handle_swipe/);
  assert.doesNotMatch(syntheticMonitor, /ready_gate_transition/);
});

test("Phase 0 schedules synthetic monitor only through Vault-backed cron", () => {
  assert.match(phase0Migration, /synthetic-video-date-monitor/);
  assert.match(phase0Migration, /vault\.decrypted_secrets/);
  assert.match(phase0Migration, /'Authorization', 'Bearer ' \|\| trim/);
  assert.match(phase0Migration, /'\/functions\/v1\/synthetic-video-date-monitor'/);
});

test("Phase 0 ships read-only validation checks for deploy review", () => {
  assert.match(validationSql, /video_date_phase0_events_is_test_event_exists/);
  assert.match(validationSql, /video_date_phase0_views_exist/);
  assert.match(validationSql, /video_date_phase0_flags_seeded_off/);
  assert.match(validationSql, /video_date_phase0_discovery_excludes_test_events/);
  assert.match(validationSql, /video_date_phase0_get_visible_events_preserves_current_shape/);
  assert.doesNotMatch(validationSql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
});

test("copy regression permits intentional escaped-output helpers without allowing runtime UI entities", () => {
  assert.match(runtimeCopyEntities, /intentionalEscapedOutputHelperPattern/);
  assert.match(runtimeCopyEntities, /\^cleanWebVttCueText\$/);
});
