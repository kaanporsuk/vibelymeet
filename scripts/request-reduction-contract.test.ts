import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("active session hydration is coalesced and EventLobby can use the provider owner", () => {
  const useActiveSession = read("src/hooks/useActiveSession.ts");
  const sessionContext = read("src/contexts/SessionHydrationContext.tsx");
  const eventLobby = read("src/pages/EventLobby.tsx");
  const runtimeFlags = read("src/lib/runtimeFlags.ts");

  assert.match(useActiveSession, /checkInFlightRef/);
  assert.match(useActiveSession, /checkQueuedRef/);
  assert.match(useActiveSession, /enabled\s*=\s*options\?\.enabled\s*\?\?\s*true/);
  assert.match(useActiveSession, /get_active_session_context/);
  assert.match(sessionContext, /useEventActiveSession/);
  assert.match(eventLobby, /useEventActiveSession\(eventId\)/);
  assert.match(eventLobby, /enabled:\s*!singleOwnerActiveSessionEnabled/);
  assert.match(runtimeFlags, /VITE_ACTIVE_SESSION_SINGLE_OWNER[\s\S]{0,120}false/);
  assert.doesNotMatch(eventLobby, /useActiveSession\(user\?\.id,\s*\{\s*eventId\s*\}\)/);
});

test("focused web hot-path count queries no longer use HEAD", () => {
  const useMatchQueue = read("src/hooks/useMatchQueue.ts");
  const eventLobby = read("src/pages/EventLobby.tsx");
  const pushPrompt = read("src/components/PushPermissionPrompt.tsx");

  for (const [label, source] of [
    ["useMatchQueue", useMatchQueue],
    ["EventLobby", eventLobby],
    ["PushPermissionPrompt", pushPrompt],
  ] as const) {
    assert.doesNotMatch(source, /head:\s*true/, `${label} should avoid HEAD count queries`);
  }

  assert.match(useMatchQueue, /\.select\("id",\s*\{\s*count:\s*"exact"\s*\}\)[\s\S]{0,240}\.limit\(1\)/);
  assert.match(eventLobby, /\.from\("event_swipes"\)[\s\S]{0,240}\.select\("id",\s*\{\s*count:\s*"exact"\s*\}\)[\s\S]{0,240}\.limit\(1\)/);
  assert.match(pushPrompt, /\.from\("matches"\)[\s\S]{0,240}\.select\("id",\s*\{\s*count:\s*"exact"\s*\}\)[\s\S]{0,240}\.limit\(1\)/);
  assert.match(pushPrompt, /\.from\("event_registrations"\)[\s\S]{0,240}\.select\("id",\s*\{\s*count:\s*"exact"\s*\}\)[\s\S]{0,240}\.limit\(1\)/);
});

test("push sync and telemetry noise have narrow dedupe guards", () => {
  const webPushSync = read("src/lib/requestWebPushPermission.ts");
  const pushHealth = read("src/hooks/usePushDeliveryHealth.ts");
  const analytics = read("src/lib/analytics.ts");
  const app = read("src/App.tsx");

  assert.match(webPushSync, /syncInFlightByUser/);
  assert.match(webPushSync, /lastBackendSyncBySignature/);
  assert.match(webPushSync, /WEB_PUSH_BACKEND_SYNC_TTL_MS/);
  assert.doesNotMatch(pushHealth, /const onFocus = \(\) => \{[\s\S]{0,160}void sync\(\)/);
  assert.match(analytics, /ready_gate_to_date_latency_checkpoint/);
  assert.match(analytics, /push_delivery_health_observed/);
  assert.match(app, /isSpeedInsightsDateRouteSuppressed/);
  assert.match(app, /beforeSend/);
});

test("active-session shadow RPC migration is additive and read-only", () => {
  const migration = read("supabase/migrations/20260503120000_active_session_context_shadow.sql");

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_active_session_context/);
  assert.match(migration, /RETURNS jsonb/);
  assert.match(migration, /STABLE/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_active_session_context\(uuid\) TO authenticated, service_role/);
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE|DELETE)\b/i);
});
