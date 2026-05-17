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
  const offlineBanner = read("src/components/connectivity/OfflineBanner.tsx");
  const nativeAuthContext = read("apps/mobile/context/AuthContext.tsx");

  assert.match(browserDiagnostics, /window\.__vibelyBootDiagnostics/);
  assert.match(browserDiagnostics, /fetchHealthWithOnePerBootCap/);
  assert.match(browserDiagnostics, /browser\.health_check_capped/);
  assert.match(browserDiagnostics, /cachedHealthResponse/);
  assert.match(browserDiagnostics, /failedHealthResponseSnapshot/);
  assert.match(browserDiagnostics, /headers\.delete\("content-length"\)/);
  assert.match(browserDiagnostics, /TRAFFIC_QUERY_VALUE_ALLOWLIST/);
  assert.match(browserDiagnostics, /browser\.boot_supabase_summary/);
  assert.match(browserDiagnostics, /browser\.realtime_channel_state/);
  assert.match(browserDiagnostics, /seenFromNewest/);
  assert.match(browserDiagnostics, /channels\.length - 1/);
  assert.match(app, /instrumentSupabaseRealtimeDiagnostics\(supabase\)/);
  assert.match(app, /pruneDuplicateRealtimeChannels\(supabase,\s*`route:\$\{location\.pathname\}`\)/);
  assert.match(app, /visibilitychange/);
  assert.doesNotMatch(offlineBanner, /getHealthUrl|functions\/v1\/health|fetch\(/);
  assert.match(offlineBanner, /navigator\.onLine/);
  assert.match(authContext, /withBootTimeout/);
  assert.match(authContext, /auth\.getSession/);
  assert.match(authContext, /resolve_entry_state/);
  assert.match(authContext, /getFallbackEntryState\("resolver_exception"\)/);
  assert.match(authContext, /const userId = currentUserId/);
  assert.match(authContext, /authUserIdRef\.current !== userId/);
  assert.match(authContext, /removeAllRealtimeChannels\(supabase,\s*"logout"\)/);
  assert.match(authContext, /clearMyLocationDataCache\(\)/);
  assert.match(authContext, /if \(!nextUserId\) \{[\s\S]{0,160}clearMyLocationDataCache\(\)/);
  assert.match(authContext, /nextUserId !== previousUserId[\s\S]{0,180}clearMyLocationDataCache\(\)/);
  assert.match(nativeAuthContext, /withNativeAuthTimeout/);
  assert.match(nativeAuthContext, /auth\.getSession/);
  assert.match(nativeAuthContext, /resolve_entry_state/);
  assert.match(nativeAuthContext, /getFallbackEntryState\('resolver_exception'\)/);
  assert.match(nativeAuthContext, /const userId = currentUserId/);
  assert.match(nativeAuthContext, /authUserIdRef\.current !== userId/);
  assert.match(nativeAuthContext, /if \(!nextUserId\) \{[\s\S]{0,160}clearMyLocationDataCache\(\)/);
  assert.match(nativeAuthContext, /nextUserId !== previousUserId[\s\S]{0,180}clearMyLocationDataCache\(\)/);
  assert.doesNotMatch(nativeAuthContext, /getCachedSession/);
});

test("home boot realtime and polling hot paths are narrowed or paused", () => {
  const app = read("src/App.tsx");
  const nativeApp = read("apps/mobile/app/_layout.tsx");
  const nativeRealtimeLifecycle = read("apps/mobile/lib/realtimeLifecycle.ts");
  const nativeAuthContext = read("apps/mobile/context/AuthContext.tsx");
  const nativeTabsLayout = read("apps/mobile/app/(tabs)/_layout.tsx");
  const nativeBadgeCount = read("apps/mobile/lib/useBadgeCount.ts");
  const nativeDailyDropTabBadge = read("apps/mobile/lib/useDailyDropTabBadge.ts");
  const nativeRealtimeEvents = read("apps/mobile/lib/useRealtimeEvents.ts");
  const nativeChatApi = read("apps/mobile/lib/chatApi.ts");
  const useEvents = read("src/hooks/useEvents.ts");
  const eventDeck = read("src/hooks/useEventDeck.ts");
  const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
  const useMatches = read("src/hooks/useMatches.ts");
  const entitlements = read("src/contexts/EntitlementsContext.tsx");
  const nativeEntitlements = read("apps/mobile/context/EntitlementsContext.tsx");
  const heartbeat = read("src/hooks/useActivityHeartbeat.ts");
  const activeSession = read("src/hooks/useActiveSession.ts");
  const eventReminders = read("src/hooks/useEventReminders.ts");

  assert.doesNotMatch(app, /table:\s*"messages"/);
  assert.match(useEvents, /table:\s*"event_registrations",\s*filter:\s*`profile_id=eq\.\$\{userId\}`/);
  assert.match(nativeRealtimeEvents, /table:\s*'event_registrations',\s*filter:\s*`profile_id=eq\.\$\{userId\}`/);
  const matchRealtimeBlocks = useMatches.match(/table:\s*"matches"[\s\S]{0,140}filter/g) ?? [];
  assert.ok(matchRealtimeBlocks.length >= 2, "matches realtime should listen on filtered participant columns");
  assert.match(useMatches, /profile_id_1=eq\.\$\{userId\}/);
  assert.match(useMatches, /profile_id_2=eq\.\$\{userId\}/);
  assert.match(nativeChatApi, /profile_id_1=eq\.\$\{userId\}/);
  assert.match(nativeChatApi, /profile_id_2=eq\.\$\{userId\}/);
  assert.doesNotMatch(nativeChatApi, /table:\s*'matches'\s*\}/);
  assert.doesNotMatch(entitlements, /tier_config_overrides/);
  assert.doesNotMatch(nativeEntitlements, /tier_config_overrides/);
  assert.match(heartbeat, /ACTIVITY_HEARTBEAT_MS\s*=\s*5\s*\*\s*60_000/);
  assert.match(heartbeat, /document\.visibilityState\s*!==\s*"visible"/);
  assert.match(eventReminders, /refetchInterval:\s*\(\)\s*=>[\s\S]{0,140}document\.visibilityState\s*===\s*"visible"\s*\?\s*60_000\s*:\s*false/);
  assert.match(eventReminders, /refetchIntervalInBackground:\s*false/);
  assert.match(eventDeck, /refetchInterval:\s*\(\)\s*=>[\s\S]{0,140}document\.visibilityState\s*===\s*"visible"\s*\?\s*15_000\s*:\s*false/);
  assert.match(eventDeck, /refetchIntervalInBackground:\s*false/);
  assert.match(nativeEventsApi, /refetchInterval:\s*15_000/);
  assert.match(activeSession, /ACTIVE_SESSION_POLL_MS\s*=\s*30_000/);
  assert.match(activeSession, /document\.visibilityState\s*!==\s*"visible"/);
  assert.match(nativeRealtimeLifecycle, /seenFromNewest/);
  assert.match(nativeRealtimeLifecycle, /channels\.length - 1/);
  assert.match(app, /const WebProfileWarmup = \(\) =>/);
  assert.match(app, /queryClient\.prefetchQuery\(\{[\s\S]{0,180}queryKey:\s*myProfileQueryKey\(userId\)/);
  assert.match(app, /if \(!profile\) throw new Error\("Profile not ready"\)/);
  assert.match(app, /queryClient\.prefetchQuery\(\{[\s\S]{0,180}queryKey:\s*profileLiveCountsQueryKey\(userId\)/);
  assert.match(nativeTabsLayout, /refetchInterval:\s*UNREAD_BADGE_POLL_MS/);
  assert.match(nativeTabsLayout, /refetchIntervalInBackground:\s*false/);
  assert.match(nativeTabsLayout, /function ProfileTabWarmup\(\)/);
  assert.match(nativeTabsLayout, /queryClient\.prefetchQuery\(\{[\s\S]{0,180}queryKey:\s*myProfileQueryKey\(userId\)/);
  assert.match(nativeTabsLayout, /if \(!profile\) throw new Error\('Profile not ready'\)/);
  assert.match(nativeTabsLayout, /queryClient\.prefetchQuery\(\{[\s\S]{0,180}queryKey:\s*profileLiveCountsQueryKey\(userId\)/);
  assert.match(nativeBadgeCount, /refetchInterval:\s*BADGE_COUNT_POLL_MS/);
  assert.match(nativeBadgeCount, /refetchIntervalInBackground:\s*false/);
  assert.match(nativeDailyDropTabBadge, /refetchInterval:\s*60_000/);
  assert.match(nativeDailyDropTabBadge, /refetchIntervalInBackground:\s*false/);
  assert.match(nativeApp, /focusManager/);
  assert.match(nativeApp, /function ReactQueryAppStateBridge\(\)/);
  assert.match(nativeApp, /focusManager\.setFocused\(nextState === 'active'\)/);
  assert.match(nativeApp, /pruneDuplicateRealtimeChannels\(supabase,\s*`route:\$\{pathname\}`\)/);
  assert.match(nativeApp, /AppState\.addEventListener\('change'/);
  assert.match(nativeAuthContext, /removeAllRealtimeChannels\(supabase,\s*'sign_out'\)/);
  assert.match(nativeAuthContext, /clearMyLocationDataCache\(\)/);
});

test("dashboard request reduction defers rows and avoids obvious overfetch", () => {
  const dashboard = read("src/pages/Dashboard.tsx");
  const inbox = read("src/hooks/useNotificationInbox.ts");
  const nativeInbox = read("apps/mobile/lib/useNotificationInbox.ts");
  const nativeDashboard = read("apps/mobile/app/(tabs)/index.tsx");
  const webProfileService = read("src/services/profileService.ts");
  const webProfileStudio = read("src/pages/ProfileStudio.tsx");
  const webVibeStudio = read("src/pages/VibeStudio.tsx");
  const webProfileWizard = read("src/components/wizard/ProfileWizard.tsx");
  const nativeProfileApi = read("apps/mobile/lib/profileApi.ts");
  const webRegistrations = read("src/hooks/useRegistrations.ts");
  const nativeEventsApiForCounts = read("apps/mobile/lib/eventsApi.ts");
  const webMessages = read("src/hooks/useMessages.ts");
  const nativeChatApiForCounts = read("apps/mobile/lib/chatApi.ts");
  const webMatchesForCounts = read("src/hooks/useMatches.ts");
  const nativeMyLocation = read("apps/mobile/lib/myLocationData.ts");
  const nativeHeartbeat = read("apps/mobile/lib/useActivityHeartbeat.ts");
  const scheduleHub = read("src/hooks/useScheduleHub.ts");
  const nativeScheduleHub = read("apps/mobile/lib/useScheduleHub.ts");
  const dateSuggestionData = read("src/hooks/useDateSuggestionData.ts");
  const nativeDateSuggestionData = read("apps/mobile/lib/useDateSuggestionData.ts");
  const notificationPreferences = read("src/hooks/useNotificationPreferences.ts");
  const matchSuccessModal = read("src/components/match/MatchSuccessModal.tsx");
  const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
  const myLocation = read("src/services/myLocationData.ts");
  const matches = read("src/hooks/useMatches.ts");
  const last8ReviewMigration = read("supabase/migrations/20260513012000_last8_codex_review_followups.sql");

  assert.match(inbox, /loadRows\s*=\s*options\.loadRows\s*\?\?\s*true/);
  assert.match(inbox, /enabled:\s*!!userId\s*&&\s*loadRows/);
  assert.doesNotMatch(inbox, /\.select\("\*"\)/);
  assert.match(dashboard, /useNotificationInbox\(user\?\.id,\s*\{\s*loadRows:\s*notificationCenterOpen\s*\}\)/);
  assert.match(dashboard, /refetchInterval:\s*\(\)\s*=>[\s\S]{0,160}document\.visibilityState\s*===\s*"visible"\s*\?\s*60_000\s*:\s*false/);
  assert.match(myLocation, /MY_LOCATION_CACHE_TTL_MS\s*=\s*60_000/);
  assert.match(myLocation, /locationDataInFlight/);
  assert.match(myLocation, /locationDataCacheVersion/);
  assert.match(myLocation, /cacheVersion === locationDataCacheVersion/);
  assert.match(nativeInbox, /loadRows\s*=\s*options\.loadRows\s*\?\?\s*true/);
  assert.match(nativeInbox, /enabled:\s*!!userId\s*&&\s*loadRows/);
  assert.doesNotMatch(nativeInbox, /\.select\(['"]\*['"]\)/);
  assert.match(nativeDashboard, /useNotificationInbox\(user\?\.id,\s*\{\s*loadRows:\s*notificationCenterOpen\s*\}\)/);
  assert.match(nativeDashboard, /refetchInterval:\s*60_000/);
  assert.match(nativeDashboard, /refetchIntervalInBackground:\s*false/);

  const webFetchMyProfile = webProfileService.slice(
    webProfileService.indexOf("export const fetchMyProfile"),
    webProfileService.indexOf("// Update current user's profile"),
  );
  assert.match(webProfileService, /export const myProfileQueryKey = \(userId: string\) => \["my-profile", userId\] as const/);
  assert.match(webProfileService, /export const profileLiveCountsQueryKey = \(userId: string\) => \["profile-live-counts", userId\] as const/);
  assert.match(webProfileService, /export const fetchProfileLiveCounts = async \(userId: string\)/);
  assert.match(webProfileService, /const countError = eventsCountResult\.error \?\? matchesCountResult\.error \?\? convosCountResult\.error/);
  assert.match(webFetchMyProfile, /export const fetchMyProfile = async \(userId: string\)/);
  assert.match(webFetchMyProfile, /\.eq\("profile_id", userId\)/);
  assert.match(webFetchMyProfile, /profileRow\.id !== userId/);
  assert.match(webFetchMyProfile, /location_data:\s*null/);
  assert.doesNotMatch(webFetchMyProfile, /auth\.getUser/);
  assert.doesNotMatch(webFetchMyProfile, /fetchMyLocationData/);
  assert.doesNotMatch(webFetchMyProfile, /fetchProfileLiveCounts/);
  assert.doesNotMatch(webProfileStudio, /queryClient\.ensureQueryData\(\{[\s\S]{0,180}queryKey:\s*myProfileQueryKey\(profileUser\.id\)/);
  assert.match(webProfileStudio, /queryClient\.fetchQuery\(\{[\s\S]{0,180}queryKey:\s*myProfileQueryKey\(profileUser\.id\)[\s\S]{0,180}staleTime:\s*forceFresh \? 0 : MY_PROFILE_STALE_TIME_MS/);
  assert.match(webProfileStudio, /queryClient\.fetchQuery\(\{[\s\S]{0,180}queryKey:\s*profileLiveCountsQueryKey\(profileUser\.id\)[\s\S]{0,180}staleTime:\s*0/);
  assert.match(webProfileStudio, /const liveCountsPromise =/);
  assert.doesNotMatch(webProfileStudio, /const \[data, liveCounts\] = await Promise\.all/);
  assert.match(webProfileStudio, /const forceFresh = profileRefreshKey > 0/);
  assert.match(webProfileStudio, /queryClient\.setQueryData<ProfileData \| null>\(myProfileQueryKey\(userId\)/);
  assert.match(webProfileStudio, /queryClient\.invalidateQueries\(\{ queryKey: myProfileQueryKey\(userId\), exact: true \}\)/);
  assert.doesNotMatch(webProfileStudio, /p_user_id:\s*\(await supabase\.auth\.getUser\(\)\)\.data\.user\?\.id/);
  assert.match(webVibeStudio, /loadProfile\(refreshKey > 0\)/);
  assert.match(webVibeStudio, /queryClient\.fetchQuery\(\{[\s\S]{0,180}queryKey:\s*myProfileQueryKey\(userId\)[\s\S]{0,180}staleTime:\s*forceFresh \? 0 : MY_PROFILE_STALE_TIME_MS/);
  assert.doesNotMatch(webProfileWizard, /fetchMyProfile\(\)/);
  assert.match(webProfileWizard, /fetchMyProfile\(userId\)/);
  assert.match(webRegistrations, /queryKey:\s*\["profile-live-counts"\]/);
  assert.match(nativeEventsApiForCounts, /queryKey:\s*\['profile-live-counts'\]/);
  assert.match(webMessages, /queryKey:\s*\["profile-live-counts"\]/);
  assert.match(nativeChatApiForCounts, /queryKey:\s*\['profile-live-counts'\]/);
  assert.match(webMatchesForCounts, /queryKey:\s*\["profile-live-counts"\]/);

  const nativeFetchMyProfile = nativeProfileApi.slice(
    nativeProfileApi.indexOf("export async function fetchMyProfile"),
    nativeProfileApi.indexOf("/** Generic profile patch fields"),
  );
  assert.match(nativeProfileApi, /export const myProfileQueryKey = \(userId: string\) => \['my-profile', userId\] as const/);
  assert.match(nativeProfileApi, /export const profileLiveCountsQueryKey = \(userId: string\) => \['profile-live-counts', userId\] as const/);
  assert.match(nativeProfileApi, /const countError = eventsCountRes\.error \?\? matchesCountRes\.error \?\? convosCountRes\.error/);
  assert.match(nativeFetchMyProfile, /export async function fetchMyProfile\(userId: string\)/);
  assert.match(nativeFetchMyProfile, /\.eq\('profile_id', userId\)/);
  assert.match(nativeFetchMyProfile, /row\.id !== userId/);
  assert.match(nativeFetchMyProfile, /location_data:\s*null/);
  assert.doesNotMatch(nativeFetchMyProfile, /auth\.getUser/);
  assert.doesNotMatch(nativeFetchMyProfile, /fetchMyLocationData/);
  assert.doesNotMatch(nativeFetchMyProfile, /fetchProfileLiveCounts/);

  assert.match(nativeMyLocation, /MY_LOCATION_CACHE_TTL_MS\s*=\s*60_000/);
  assert.match(nativeMyLocation, /locationDataInFlight/);
  assert.match(nativeMyLocation, /locationDataCacheVersion/);
  assert.match(nativeMyLocation, /cacheVersion === locationDataCacheVersion/);
  assert.match(nativeHeartbeat, /HEARTBEAT_INTERVAL_MS\s*=\s*5\s*\*\s*60_000/);
  assert.doesNotMatch(scheduleHub, /\.select\(["']\*["']\)/);
  assert.doesNotMatch(nativeScheduleHub, /\.select\(["']\*["']\)/);
  assert.doesNotMatch(dateSuggestionData, /\.select\(["']\*["']\)/);
  assert.doesNotMatch(nativeDateSuggestionData, /\.select\(["']\*["']\)/);
  assert.doesNotMatch(notificationPreferences, /\.select\(["']\*["']\)/);
  assert.match(matchSuccessModal, /\.from\("matches"\)\.select\("id",\s*\{\s*count:\s*"exact",\s*head:\s*true\s*\}\)/);
  assert.match(nativeEventsApi, /\.from\('video_sessions'\)[\s\S]{0,120}\.select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/);
  assert.match(nativeEventsApi, /\.from\('event_swipes'\)[\s\S]{0,120}\.select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/);
  assert.match(matches, /\.rpc\("get_dashboard_visible_matches",\s*\{\s*p_limit:\s*5\s*\}\)/);
  assert.match(matches, /function isMissingDashboardRpc/);
  assert.match(matches, /if \(!isMissingDashboardRpc\(error\)\) throw error/);
  assert.match(matches, /while \(visibleMatches\.length < 5\)/);
  assert.match(matches, /\.range\(offset,\s*offset \+ pageSize - 1\)/);
  assert.match(matches, /return visibleMatches\.slice\(0,\s*5\)/);
  assert.match(last8ReviewMigration, /CREATE OR REPLACE FUNCTION public\.get_dashboard_visible_matches\(p_limit integer DEFAULT 5\)/);
  assert.match(last8ReviewMigration, /NOT EXISTS \([\s\S]*public\.match_archives[\s\S]*archive\.user_id = viewer\.user_id/);
  assert.match(last8ReviewMigration, /LIMIT greatest\(0, least\(coalesce\(p_limit, 5\), 20\)\)/);
});

test("media routing only promotes verified Bunny-backed prefixes", () => {
  const imageUrl = read("src/utils/imageUrl.ts");
  const chatMedia = read("src/lib/chatMediaResolver.ts");

  assert.match(imageUrl, /CONFIRMED_BUNNY_STORAGE_PREFIXES\s*=\s*\["photos\/",\s*"events\/",\s*"voice\/",\s*"media\/"\]/);
  assert.doesNotMatch(imageUrl, /"chat-videos\/"/);
  assert.match(chatMedia, /get-chat-media-url/);
});

test("match mute notification reads stay narrow on web and native", () => {
  const webMuteMatch = read("src/hooks/useMuteMatch.ts");
  const nativeMuteMatch = read("apps/mobile/lib/useMuteMatch.ts");

  assert.match(webMuteMatch, /\.select\("id, match_id, user_id, muted_until, created_at"\)/);
  assert.match(nativeMuteMatch, /\.select\('id, match_id, user_id, muted_until, created_at'\)/);
  assert.doesNotMatch(webMuteMatch, /\.select\(["']\*["']\)/);
  assert.doesNotMatch(nativeMuteMatch, /\.select\(["']\*["']\)/);
});
