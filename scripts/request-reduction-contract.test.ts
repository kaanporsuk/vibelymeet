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
  assert.match(webPushSync, /WEB_PUSH_BACKEND_SYNC_CACHE_KEY/);
  assert.match(webPushSync, /localStorage\.setItem\(WEB_PUSH_BACKEND_SYNC_CACHE_KEY/);
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

test("boot diagnostics, health caps, and auth timeout recovery are wired", () => {
  const browserDiagnostics = read("src/lib/browserDiagnostics.ts");
  const authContext = read("src/contexts/AuthContext.tsx");
  const app = read("src/App.tsx");

  assert.match(browserDiagnostics, /window\.__vibelyBootDiagnostics/);
  assert.match(browserDiagnostics, /fetchHealthWithOnePerBootCap/);
  assert.match(browserDiagnostics, /browser\.health_check_capped/);
  assert.match(browserDiagnostics, /browser\.boot_supabase_summary/);
  assert.match(browserDiagnostics, /browser\.realtime_channel_state/);
  assert.match(app, /instrumentSupabaseRealtimeDiagnostics\(supabase\)/);
  assert.match(app, /pruneDuplicateRealtimeChannels\(supabase,\s*`route:\$\{location\.pathname\}`\)/);
  assert.match(app, /visibilitychange/);
  assert.match(authContext, /withBootTimeout/);
  assert.match(authContext, /auth\.getSession/);
  assert.match(authContext, /resolve_entry_state/);
  assert.match(authContext, /getFallbackEntryState\("resolver_exception"\)/);
  assert.match(authContext, /removeAllRealtimeChannels\(supabase,\s*"logout"\)/);
  assert.match(authContext, /clearMyLocationDataCache\(\)/);
});

test("home boot realtime and polling hot paths are narrowed or paused", () => {
  const app = read("src/App.tsx");
  const useEvents = read("src/hooks/useEvents.ts");
  const useMatches = read("src/hooks/useMatches.ts");
  const entitlements = read("src/contexts/EntitlementsContext.tsx");
  const heartbeat = read("src/hooks/useActivityHeartbeat.ts");
  const activeSession = read("src/hooks/useActiveSession.ts");

  assert.doesNotMatch(app, /table:\s*"messages"/);
  assert.match(useEvents, /table:\s*"event_registrations",\s*filter:\s*`profile_id=eq\.\$\{userId\}`/);
  const matchRealtimeBlocks = useMatches.match(/table:\s*"matches"[\s\S]{0,140}filter/g) ?? [];
  assert.ok(matchRealtimeBlocks.length >= 2, "matches realtime should listen on filtered participant columns");
  assert.match(useMatches, /profile_id_1=eq\.\$\{userId\}/);
  assert.match(useMatches, /profile_id_2=eq\.\$\{userId\}/);
  assert.doesNotMatch(entitlements, /tier_config_overrides/);
  assert.match(heartbeat, /ACTIVITY_HEARTBEAT_MS\s*=\s*5\s*\*\s*60_000/);
  assert.match(heartbeat, /document\.visibilityState\s*!==\s*"visible"/);
  assert.match(activeSession, /ACTIVE_SESSION_POLL_MS\s*=\s*30_000/);
  assert.match(activeSession, /document\.visibilityState\s*!==\s*"visible"/);
});

test("dashboard request reduction defers rows and avoids obvious overfetch", () => {
  const dashboard = read("src/pages/Dashboard.tsx");
  const inbox = read("src/hooks/useNotificationInbox.ts");
  const myLocation = read("src/services/myLocationData.ts");
  const matches = read("src/hooks/useMatches.ts");

  assert.match(inbox, /loadRows\s*=\s*options\.loadRows\s*\?\?\s*true/);
  assert.match(inbox, /enabled:\s*!!userId\s*&&\s*loadRows/);
  assert.doesNotMatch(inbox, /\.select\("\*"\)/);
  assert.match(dashboard, /useNotificationInbox\(user\?\.id,\s*\{\s*loadRows:\s*notificationCenterOpen\s*\}\)/);
  assert.match(dashboard, /refetchInterval:\s*\(\)\s*=>[\s\S]{0,160}document\.visibilityState\s*===\s*"visible"\s*\?\s*60_000\s*:\s*false/);
  assert.match(myLocation, /MY_LOCATION_CACHE_TTL_MS\s*=\s*60_000/);
  assert.match(myLocation, /locationDataInFlight/);
  assert.match(matches, /\.limit\(20\)/);
  assert.match(matches, /const dashboardMatches = visibleMatches\.slice\(0,\s*5\)/);
});

test("media routing only promotes verified Bunny-backed prefixes", () => {
  const imageUrl = read("src/utils/imageUrl.ts");
  const chatMedia = read("src/lib/chatMediaResolver.ts");

  assert.match(imageUrl, /CONFIRMED_BUNNY_STORAGE_PREFIXES\s*=\s*\["photos\/",\s*"events\/",\s*"voice\/",\s*"media\/"\]/);
  assert.doesNotMatch(imageUrl, /"chat-videos\/"/);
  assert.match(chatMedia, /get-chat-media-url/);
});
