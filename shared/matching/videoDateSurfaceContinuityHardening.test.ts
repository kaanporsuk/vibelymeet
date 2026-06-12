import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoDatePageFlowSource, readWebVideoDateNavigationIntentsSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateNavigationIntentsSource, readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260508143000_video_date_surface_claims_post_date_continuity.sql",
);
const readyGateRouteLabelCleanupMigration = read(
  "supabase/migrations/20260522162000_video_date_ready_gate_route_label_cleanup.sql",
);
const webDupGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const webLobby = read("src/pages/EventLobby.tsx");
const webVideoDate = readWebVideoDatePageFlowSource(root);
const readyRedirect = read("src/pages/ReadyRedirect.tsx");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const webDateEntryLatch = readWebVideoDateNavigationIntentsSource(root);
const nativeDateRoute = readNativeVideoDateScreenFlowSource();
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
// PR 8.5 split the standalone ready screen body into lib/videoDate sub-hooks;
// read the family so pins keep guarding the moved-verbatim bodies.
const nativeReadyRoute = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
  .map(read)
  .join("\n");
const nativeSurvey = read(
  "apps/mobile/components/video-date/PostDateSurvey.tsx",
);
const nativeDateEntryLatch = readNativeVideoDateNavigationIntentsSource(root);
const sharedContinuity = read("shared/matching/postDateContinuity.ts");
const postDateVerdictFunction = read(
  "supabase/functions/post-date-verdict/index.ts",
);
const dailyRoomFunction = read("supabase/functions/daily-room/index.ts");

function enclosingLayoutEffect(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `expected marker to exist: ${marker}`);
  const effectStart = source.lastIndexOf("useLayoutEffect(() => {", markerIndex);
  assert.ok(effectStart >= 0, `expected layout effect before marker: ${marker}`);
  const effectEnd = source.indexOf("\n  }, [", markerIndex);
  assert.ok(effectEnd >= 0, `expected layout effect deps after marker: ${marker}`);
  return source.slice(effectStart, effectEnd);
}

test("surface claim migration adds server-owned duplicate active UI ownership", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.video_date_surface_claims/,
  );
  assert.match(migration, /profile_id uuid PRIMARY KEY/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.claim_video_date_surface/,
  );
  assert.match(migration, /SURFACE_CLAIM_CONFLICT/);
  assert.match(migration, /p_takeover boolean DEFAULT false/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.claim_video_date_surface\(uuid, text, text, boolean, integer\) TO authenticated, service_role/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.release_video_date_surface_claim/,
  );
  assert.match(
    migration,
    /v_existing\.session_id IS DISTINCT FROM p_session_id[\s\S]{0,120}v_existing\.client_instance_id IS DISTINCT FROM v_client_instance_id/,
  );
});

test("active-session audit remains service-role-only and uses the shared active-surface predicate", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.video_date_session_is_active_surface/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.audit_active_video_date_surface_conflicts/,
  );
  assert.match(migration, /HAVING count\(DISTINCT ap\.session_id\) > 1/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.audit_active_video_date_surface_conflicts\(\) TO service_role/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.audit_active_video_date_surface_conflicts\(\) TO authenticated/,
  );
});

test("web duplicate-tab guard renews and releases backend surface claims", () => {
  assert.match(
    webDupGuard,
    /storageKey\(sessionId: string, profileId: string\)/,
  );
  assert.match(
    webDupGuard,
    /vibely_vd_tab_lease:\$\{profileId\}:\$\{sessionId\}/,
  );
  assert.match(
    webDupGuard,
    /sessionId && profileId \? storageKey\(sessionId, profileId\) : null/,
  );
  assert.match(webVideoDate, /useVideoDateDupTabGuard\(\s*id,\s*user\?\.id,/);
  assert.match(webDupGuard, /claim_video_date_surface/);
  assert.match(webDupGuard, /release_video_date_surface_claim/);
  assert.match(webDupGuard, /p_surface:\s*"video_date"/);
  assert.match(webDupGuard, /p_takeover:\s*true/);
  assert.match(webDupGuard, /SURFACE_CLAIM_CONFLICT/);
  assert.match(webDupGuard, /serverClaimInFlightRef/);
  assert.match(webDupGuard, /serverClaimBackoffUntilRef/);
  assert.match(webDupGuard, /nextServerClaimBackoffMs/);
  assert.match(webDupGuard, /payload\.retryable !== true/);
  assert.match(webDupGuard, /Date\.now\(\) \+ nextServerClaimBackoffMs/);
  assert.match(webDupGuard, /serverClientStorageKey/);
  assert.match(
    webDupGuard,
    /vibely_vd_surface_client:\$\{profileId\}:\$\{sessionId\}/,
  );
  assert.match(webDupGuard, /vd-tab-/);
  assert.match(webDupGuard, /serverClientInstanceId/);
  assert.match(webDupGuard, /type ActiveServerSurfaceOwner/);
  assert.match(webDupGuard, /activeServerSurfaceOwners/);
  assert.match(webDupGuard, /activeOwner\?\.owner === owner/);
  assert.match(
    webDupGuard,
    /activeServerSurfaceOwners\.get\(activeKey\)\?\.serverClientInstanceId/,
  );
  assert.match(webDupGuard, /SERVER_CLAIM_RELEASE_GRACE_MS = 1_000/);
  assert.match(webDupGuard, /p_client_instance_id:\s*serverClientInstanceId/);
  assert.match(webDupGuard, /getLocalStorage\(\)/);

  assert.match(
    nativeDateRoute,
    /NATIVE_VIDEO_DATE_SURFACE_CLAIM_BACKOFF_BASE_MS/,
  );
  assert.match(nativeDateRoute, /surfaceClaimInFlightRef/);
  assert.match(nativeDateRoute, /surfaceClaimBackoffUntilRef/);
  assert.match(nativeDateRoute, /surfaceClaimBlockedRef/);
  assert.match(nativeDateRoute, /nextNativeSurfaceClaimBackoffMs/);
  assert.match(nativeDateRoute, /payload\.retryable !== true/);
  assert.match(
    nativeDateRoute,
    /Date\.now\(\) \+[\s\S]{0,80}nextNativeSurfaceClaimBackoffMs/,
  );
  assert.match(
    nativeDateRoute,
    /canContinue: !surfaceClaimBlockedRef\.current/,
  );
  assert.match(nativeDateRoute, /AsyncStorage\.getItem\(storageKey\)/);
  assert.match(
    nativeDateRoute,
    /NATIVE_VIDEO_DATE_SURFACE_CLIENT_STORAGE_PREFIX/,
  );
  assert.match(nativeDateRoute, /nativeVideoDateActiveSurfaceOwners/);
  assert.match(nativeDateRoute, /type NativeVideoDateActiveSurfaceOwner/);
  assert.match(nativeDateRoute, /getCachedNativeVideoDateClientInstanceId/);
  assert.match(nativeDateRoute, /nativeSurfaceClientReady/);
  assert.match(nativeDateRoute, /setNativeSurfaceClientReady\(false\)/);
  assert.match(nativeDateRoute, /!nativeSurfaceClientReady/);
  assert.match(
    nativeDateRoute,
    /if \(!nativeSurfaceClientReady\) \{[\s\S]{0,500}native_video_date_surface_claim_waiting_for_client_identity[\s\S]{0,500}confirmed: false/,
  );
  assert.match(nativeDateRoute, /videoDateSurfaceOwnerIdRef/);
  assert.match(nativeDateRoute, /activeOwner\?\.owner === surfaceOwnerId/);
  assert.match(nativeDateRoute, /\?\.clientInstanceId === clientInstanceId/);
  assert.match(
    nativeDateRoute,
    /NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS = 1_000/,
  );
  assert.match(nativeDateRoute, /p_client_instance_id:\s*clientInstanceId/);
  assert.doesNotMatch(
    nativeDateRoute,
    /surfaceClaimInFlightRef\.current \|\| now < surfaceClaimBackoffUntilRef\.current\) \{[\s\S]{0,120}setSurfaceClaimBlockedState\(false\)/,
  );
});

test("web duplicate-tab conflicts do not auto-end an active Daily call", () => {
  assert.match(webVideoDate, /DUPLICATE_TAB_CONFLICT_STABLE_MS/);
  assert.match(webVideoDate, /showDuplicateTabConflict/);
  assert.match(webVideoDate, /duplicate_tab_conflict_visible/);
  assert.doesNotMatch(webVideoDate, /duplicate_tab_lease_blocked/);
});

test("date-route ownership suppresses stale Ready Gate and lobby bounces on web and native", () => {
  for (const latch of [webDateEntryLatch, nativeDateEntryLatch]) {
    assert.match(latch, /VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 10 \* 60_000/);
    assert.match(latch, /VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS = 30_000/);
    assert.match(latch, /VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 2 \* 60_000/);
    assert.match(
      latch,
      /Math\.min\(ttl, VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS\)/,
    );
    assert.match(latch, /export function markVideoDateRouteOwned/);
    assert.match(latch, /export function isVideoDateRouteOwned/);
    assert.match(latch, /export function clearVideoDateRouteOwnership/);
    assert.match(latch, /routeOwnership\.delete/);
  }

  assert.match(webDateEntryLatch, /clearStoredRouteOwnershipForSession/);
  assert.match(
    nativeDateEntryLatch,
    /const keysToClear = \[routeOwnershipKey\(sessionId, null\)\]/,
  );

  assert.match(
    webVideoDate,
    /markVideoDateRouteOwned\(id, user\?\.id \?\? null\)/,
  );
  const webDateEntryMount = enclosingLayoutEffect(
    webVideoDate,
    "markVideoDateEntryPipelineStarted(id);",
  );
  assert.doesNotMatch(webDateEntryMount, /markVideoDateRouteOwned/);
  // The dedicated `terminalSurveyOwner` variable became inline guard
  // conditions during the PR 7/7.5 decomposition; the ownership semantics
  // (feedback shown / terminal recovery active / ended) are unchanged.
  assert.match(
    webVideoDate,
    /showFeedback \|\|\s*terminalSurveyRecoveryActive \|\|\s*phase === "ended"/,
  );
  assert.match(
    webVideoDate,
    /videoDateAccess !== "allowed"[\s\S]{0,900}markVideoDateRouteOwned\(id, user\.id\)/,
  );
  assert.match(
    webVideoDate,
    /window\.setInterval\([\s\S]{0,160}VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS/,
  );
  assert.match(webVideoDate, /date_route_bounce_suppressed_by_route_ownership/);
  assert.match(
    webVideoDate,
    /date_guard_ready_gate_bounce_suppressed_by_route_ownership/,
  );
  assert.match(
    webVideoDate,
    /date_guard_canonical_ready_bounce_suppressed_by_route_ownership/,
  );
  assert.match(
    webVideoDate,
    /date_guard_lobby_bounce_suppressed_by_route_ownership/,
  );
  assert.match(
    webVideoDate,
    /clearVideoDateRouteOwnership\(id, user\?\.id \?\? null\)/,
  );
  assert.match(webLobby, /ready_gate_open_suppressed_by_date_route_ownership/);
  // The `date_route_ownership_active` log label was renamed during the PR 7
  // EventLobby port; pin the suppression condition itself instead.
  assert.match(webLobby, /isVideoDateRouteOwned\(sessionId, user\?\.id \?\? null\)/);
  assert.match(readyRedirect, /ready_redirect_route_ownership/);
  assert.match(readyRedirect, /ready_redirect_canonical_route_ownership/);

  assert.match(
    nativeDateRoute,
    /markVideoDateRouteOwned\(sessionId, user\?\.id \?\? null\)/,
  );
  const nativeDateEntryMount = enclosingLayoutEffect(
    nativeDateRoute,
    "markVideoDateEntryPipelineStarted(sessionId);",
  );
  assert.doesNotMatch(nativeDateEntryMount, /markVideoDateRouteOwned/);
  assert.match(
    nativeDateRoute,
    /terminalSurveyOwner =[\s\S]{0,160}showFeedback \|\| phase === ["']ended["']/,
  );
  assert.match(
    nativeDateRoute,
    /!dateEntryPermissionEligible[\s\S]{0,900}markVideoDateRouteOwned\(sessionId, user\.id\)/,
  );
  assert.match(
    nativeDateRoute,
    /setInterval\([\s\S]{0,160}VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS/,
  );
  assert.doesNotMatch(
    nativeDateRoute,
    /phaseRef\.current === ['"]handshake['"][\s\S]{0,220}markVideoDateRouteOwned\(sessionId, user\.id\)/,
  );
  // PR 8.5 guard port: one shared-decision suppression path (ready/lobby
  // folded into suppressedBy on the date_route decision).
  assert.match(nativeDateRoute, /surface: "date_route"/);
  assert.match(
    nativeDateRoute,
    /date_guard_bounce_suppressed_by_route_ownership/,
  );
  assert.match(
    nativeDateRoute,
    /route_bounce_suppressed_by_date_ownership/,
  );
  assert.match(
    nativeDateRoute,
    /clearVideoDateRouteOwnership\(sessionId, user\?\.id \?\? null\)/,
  );
  assert.match(nativeLobby, /date_route_decision_suppressed_by_ownership/);
  assert.match(
    nativeLobby,
    /ready_gate_open_suppressed_by_date_route_ownership/,
  );
  assert.match(
    nativeReadyRoute,
    /standalone_ready_redirect_suppressed_by_date_route_ownership/,
  );
});

test("post-date continuity is backend-resolved before client event fallback", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.resolve_post_date_next_surface/,
  );
  for (const action of [
    "survey",
    "ready_gate",
    "video_date",
    "lobby",
    "chat",
    "wrap_up",
    "home",
  ]) {
    assert.match(migration, new RegExp(`'action', '${action}'`));
  }
  assert.match(migration, /v_session\.event_id IS NULL[\s\S]*'action', 'home'/);
  assert.match(migration, /INSERT INTO public\.migration_classifications/);
  assert.match(sharedContinuity, /normalizeServerPostDateNextSurface/);
  assert.match(webSurvey, /resolve_post_date_next_surface/);
  assert.match(nativeSurvey, /resolve_post_date_next_surface/);
  // Post-date instant-next was removed (2026-06-10): ready_gate / video_date
  // server-next actions are deliberately ignored instead of auto-routed.
  assert.match(nativeSurvey, /removed_auto_next_target_ignored/);
  assert.match(webSurvey, /fetchPostDateNextSessionTruth/);
  assert.match(nativeSurvey, /fetchPostDateNextSessionTruth/);
  assert.match(
    nativeSurvey,
    /serverNext\.action === 'ready_gate' \|\| serverNext\.action === 'video_date'/,
  );
  assert.ok(
    webSurvey.indexOf("resolve_post_date_next_surface") <
      webSurvey.indexOf("const active = await checkEventActive"),
    "web survey should ask backend for next surface before falling back to client lifecycle checks",
  );
  assert.ok(
    nativeSurvey.indexOf("resolve_post_date_next_surface") <
      nativeSurvey.indexOf(
        "const continuation = await getEventContinuationSnapshot",
      ),
    "native survey should ask backend for next surface before falling back to client lifecycle checks",
  );
});

test("post-date continuity uses the standalone Ready Gate route label", () => {
  assert.match(
    readyGateRouteLabelCleanupMigration,
    /CREATE OR REPLACE FUNCTION public\.resolve_post_date_next_surface/,
  );
  assert.match(
    readyGateRouteLabelCleanupMigration,
    /'action', 'ready_gate'[\s\S]*'route', 'ready_gate'/,
  );
  assert.doesNotMatch(
    readyGateRouteLabelCleanupMigration,
    /event_lobby_pending_ready_gate/,
  );
});

test("optional post-date details use participant-checked RPC instead of direct client updates", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.update_post_date_feedback_details/,
  );
  assert.match(migration, /VERDICT_REQUIRED/);
  assert.match(
    migration,
    /jsonb_typeof\(v_patch->'tag_chemistry'\) = 'boolean'/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.update_post_date_feedback_details\(uuid, jsonb\) TO authenticated, service_role/,
  );
  assert.match(webSurvey, /update_post_date_feedback_details/);
  assert.match(nativeSurvey, /update_post_date_feedback_details/);
  assert.doesNotMatch(
    webSurvey,
    /\.from\(["']date_feedback["']\)[\s\S]{0,500}\.update\(/,
  );
  assert.doesNotMatch(
    nativeSurvey,
    /\.from\(["']date_feedback["']\)[\s\S]{0,500}\.update\(/,
  );
});

test("service-role Edge functions keep participant state writes behind user-authenticated RPCs", () => {
  assert.match(
    postDateVerdictFunction,
    /const userClient = createClient\(supabaseUrl, anonKey/,
  );
  assert.match(
    postDateVerdictFunction,
    /userClient\.rpc\("submit_post_date_verdict_v3"/,
  );
  assert.doesNotMatch(
    postDateVerdictFunction,
    /userClient\.rpc\("submit_post_date_verdict_v2"/,
  );
  assert.doesNotMatch(
    postDateVerdictFunction,
    /userClient\.rpc\("submit_post_date_verdict"/,
  );
  assert.doesNotMatch(
    postDateVerdictFunction,
    /serviceClient\.rpc\("submit_post_date_verdict/,
  );
  assert.match(
    dailyRoomFunction,
    /const supabase = createClient\(supabaseUrl, supabaseAnonKey/,
  );
  assert.match(dailyRoomFunction, /supabase\.rpc\("video_date_transition"/);
  assert.doesNotMatch(
    dailyRoomFunction,
    /serviceClient\.rpc\("video_date_transition"/,
  );
});
