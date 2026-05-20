import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260520120000_client_feature_flags_hardening.sql", "utf8");
const panel = readFileSync("src/components/admin/AdminClientFeatureFlagsPanel.tsx", "utf8");
const dashboard = readFileSync("src/pages/admin/AdminDashboard.tsx", "utf8");
const sidebar = readFileSync("src/components/admin/AdminSidebar.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const runbook = readFileSync("docs/client-feature-flags-runbook.md", "utf8");

test("feature flag admin RPCs require reasons and write audit/history-backed changes", () => {
  for (const fn of [
    "admin_list_client_feature_flags",
    "admin_update_client_feature_flag",
    "admin_list_client_feature_flag_overrides",
    "admin_upsert_client_feature_flag_override",
    "admin_delete_client_feature_flag_override",
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }
  assert.match(migration, /IF v_reason = '' THEN[\s\S]+A reason is required/);
  assert.match(migration, /public\.log_admin_action\(\s*'client_feature_flag\.update'/);
  assert.match(migration, /public\.log_admin_action\(\s*'client_feature_flag\.override_upsert'/);
  assert.match(migration, /public\.log_admin_action\(\s*'client_feature_flag\.override_delete'/);
  assert.match(migration, /client_feature_flags_history[\s\S]+client_feature_flag_state_history_trigger/);
  assert.match(migration, /client_feature_flag_user_overrides_history[\s\S]+client_feature_flag_override_history_trigger/);
});

test("feature flag admin UI is wired into dashboard, sidebar, and protected alias route", () => {
  assert.match(dashboard, /AdminClientFeatureFlagsPanel/);
  assert.match(dashboard, /'feature-flags'/);
  assert.match(dashboard, /activePanel === 'feature-flags' && <AdminClientFeatureFlagsPanel \/>/);
  assert.match(sidebar, /label: 'Feature Flags'/);
  assert.match(sidebar, /icon: Flag/);
  assert.match(app, /path="\/admin\/feature-flags"/);
  assert.match(app, /Navigate to="\/kaan\/dashboard\?panel=feature-flags"/);
});

test("feature flag admin panel uses RPCs, reason-required mutations, user search, and hard-kill controls", () => {
  assert.match(panel, /admin_list_client_feature_flags/);
  assert.match(panel, /admin_update_client_feature_flag/);
  assert.match(panel, /admin_list_client_feature_flag_overrides/);
  assert.match(panel, /admin_upsert_client_feature_flag_override/);
  assert.match(panel, /admin_delete_client_feature_flag_override/);
  assert.match(panel, /admin_search_users/);
  assert.match(panel, /A reason is required/);
  assert.match(panel, /Kill switch/);
  assert.match(panel, /p_kill_switch_active: killSwitchActive/);
  assert.match(panel, /p_rollout_bps: rolloutBps/);
  assert.match(panel, /p_description: description\.trim\(\)/);
});

test("runbook documents ramp, staff override, kill-switch, and debug fallback procedures", () => {
  assert.match(runbook, /\/kaan\/dashboard\?panel=feature-flags/);
  assert.match(runbook, /rollout_bps/);
  assert.match(runbook, /kill_switch_active = true/);
  assert.match(runbook, /Staff Testing/);
  assert.match(runbook, /evaluate_all_client_feature_flags/);
});
