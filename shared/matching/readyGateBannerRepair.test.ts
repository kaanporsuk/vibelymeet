import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readyGateTransitionResultBlocksActiveSession,
  readyGateTransitionResultReadyGateEligible,
} from "./activeSession";
import { resolveReadyGateTerminalRecovery } from "./readyGateTerminalRecovery";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("Ready Gate registration desync migration wraps the public transition RPC safely", () => {
  const migration = read("supabase/migrations/20260505203000_ready_gate_registration_desync_terminalization.sql");
  const validation = read("supabase/validation/ready_gate_registration_desync_terminalization.sql");

  assert.match(migration, /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)\s+RENAME TO ready_gate_transition_20260505203000_registration_desync_base/);
  assert.match(migration, /v_result := public\.ready_gate_transition_20260505203000_registration_desync_base/);
  assert.match(migration, /v_status NOT IN \('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready'\)/);
  assert.match(migration, /er\.queue_status = 'in_ready_gate'/);
  assert.match(migration, /er\.current_room_id = p_session_id/);
  assert.match(migration, /ready_gate_status = 'forfeited'/);
  assert.match(migration, /ended_reason = COALESCE\(ended_reason, 'ready_gate_registration_desync'\)/);
  assert.match(migration, /current_room_id = v_after\.id/);
  assert.match(migration, /OR \(queue_status = 'in_ready_gate' AND current_room_id IS NULL\)/);
  assert.match(migration, /'registration_desync', true/);
  assert.match(migration, /'missing_participant_registration', v_missing_participant_registration/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)[\s\S]*TO anon, authenticated, service_role/);

  assert.match(validation, /ready_gate_registration_desync_wrapper_installed/);
  assert.match(validation, /ready_gate_registration_desync_targets_only_pre_date_gates/);
  assert.match(validation, /ready_gate_registration_desync_requires_both_registration_pointers/);
  assert.match(validation, /ready_gate_registration_desync_terminalizes_and_clears_registrations/);
});

test("Ready Gate transition result helpers block stale banner states but allow valid both-ready handoff", () => {
  assert.equal(
    readyGateTransitionResultReadyGateEligible({
      success: true,
      status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:33:45.000Z",
      terminal: true,
    }, Date.parse("2026-04-24T00:33:00.000Z")),
    true,
  );

  assert.equal(
    readyGateTransitionResultBlocksActiveSession({
      success: true,
      status: "forfeited",
      reason: "ready_gate_registration_desync",
      terminal: true,
    }),
    true,
  );

  assert.equal(
    readyGateTransitionResultReadyGateEligible({
      success: true,
      status: "ready",
      ready_gate_expires_at: "2026-04-24T00:32:59.000Z",
      terminal: false,
    }, Date.parse("2026-04-24T00:33:00.000Z")),
    false,
  );
});

test("registration desync uses terminal recovery copy instead of retry loops", () => {
  const recovery = resolveReadyGateTerminalRecovery({
    status: "forfeited",
    reason: "ready_gate_registration_desync",
    terminal: true,
  });

  assert.equal(recovery.retryable, false);
  assert.equal(recovery.terminal, true);
  assert.equal(recovery.category, "partner_forfeited");
});

test("web and native active-session hydration sync Ready Gate before showing banner", () => {
  const webHook = read("src/hooks/useActiveSession.ts");
  const nativeHook = read("apps/mobile/lib/useActiveSession.ts");

  for (const source of [webHook, nativeHook]) {
    assert.match(source, /syncReadyGateActiveSession/);
    assert.match(source, /ready_gate_transition/);
    assert.match(source, /p_action:\s*["']sync["']/);
    assert.match(source, /readyGateTransitionResultReadyGateEligible/);
    assert.match(source, /ready_gate_sync_date_capable_without_provider_room/);
    assert.match(source, /const freshDateRoute =\s*[\r\n]+\s*canAttemptDaily &&[\r\n]+\s*isActiveSessionDirectFallbackFresh/);
    assert.match(source, /ready_gate_sync_not_startable/);
  }
});

test("web and native home banners guard Ready Gate Continue with sync/refetch", () => {
  const dashboard = read("src/pages/Dashboard.tsx");
  const nativeHome = read("apps/mobile/app/(tabs)/index.tsx");

  assert.match(dashboard, /const handleActiveSessionRejoin = useCallback/);
  assert.match(dashboard, /p_reason:\s*"dashboard_active_banner_continue"/);
  assert.match(dashboard, /p_reason:\s*"dashboard_active_banner"/);
  assert.match(dashboard, /readyGateTransitionResultReadyGateEligible/);
  assert.match(dashboard, /onRejoin=\{handleActiveSessionRejoin\}/);
  assert.doesNotMatch(dashboard, /activeSession\.kind === "ready_gate"\s*\?\s*navigate\(`\/event/);

  assert.match(nativeHome, /const handleActiveSessionRejoin = useCallback/);
  assert.match(nativeHome, /p_reason:\s*'dashboard_active_banner_continue'/);
  assert.match(nativeHome, /p_reason:\s*'dashboard_active_banner'/);
  assert.match(nativeHome, /readyGateTransitionResultReadyGateEligible/);
  assert.match(nativeHome, /onRejoin=\{handleActiveSessionRejoin\}/);
  assert.doesNotMatch(nativeHome, /onRejoin=\{\(\) => router\.push\(hrefForActiveSession\(activeSession\)\)\}/);
});
