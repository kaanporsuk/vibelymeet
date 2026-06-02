import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function extractBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `missing ${endNeedle}`);
  return source.slice(start, end);
}

const permissionHardeningMigration = read(
  "supabase/migrations/20260602020000_permission_flow_definitive_hardening.sql",
);
const triggerGrantHardeningMigration = read(
  "supabase/migrations/20260602021000_permission_flow_trigger_function_grants.sql",
);
const pushSubscriptionGrantHardeningMigration = read(
  "supabase/migrations/20260602022000_push_subscription_table_grants_hardening.sql",
);
const pushSubscriptionPublicGrantHardeningMigration = read(
  "supabase/migrations/20260602023000_push_subscription_public_grants_hardening.sql",
);

test("native iOS permission metadata matches the shipped runtime prompts", () => {
  const appConfig = read("apps/mobile/app.base.json");
  const plistPaths = [
    "apps/mobile/ios/Vibely/Info.plist",
    "apps/mobile/ios/mobile/Info.plist",
  ].filter((path) => existsSync(join(root, path)));
  assert.ok(plistPaths.length > 0, "expected at least one checked-in iOS Info.plist");

  for (const path of plistPaths) {
    const source = read(path);
    assert.match(source, /<key>NSCameraUsageDescription<\/key>/);
    assert.match(source, /join video dates, record Vibe Videos or chat clips/);
    assert.match(source, /<key>NSMicrophoneUsageDescription<\/key>/);
    assert.match(source, /send voice messages/);
    assert.match(source, /<key>NSPhotoLibraryUsageDescription<\/key>/);
    assert.match(source, /photo library only when you choose photos or videos/);
    assert.match(source, /<key>NSLocationWhenInUseUsageDescription<\/key>/);
    assert.match(source, /while the app is open/);
    assert.match(source, /<key>NSSpeechRecognitionUsageDescription<\/key>/);
    assert.doesNotMatch(source, /NSLocationAlways(?:AndWhenInUse)?UsageDescription/);
  }

  assert.match(appConfig, /NSCameraUsageDescription/);
  assert.match(appConfig, /join video dates, record Vibe Videos or chat clips/);
  assert.match(appConfig, /NSMicrophoneUsageDescription/);
  assert.match(appConfig, /send voice messages/);
  assert.match(appConfig, /NSPhotoLibraryUsageDescription/);
  assert.match(appConfig, /photo library only when you choose photos or videos/);
  assert.match(appConfig, /NSLocationWhenInUseUsageDescription/);
  assert.match(appConfig, /while the app is open/);
  assert.match(appConfig, /NSSpeechRecognitionUsageDescription/);
  assert.doesNotMatch(appConfig, /NSLocationAlways(?:AndWhenInUse)?UsageDescription/);
  assert.match(appConfig, /com\.apple\.security\.application-groups/);
  assert.match(appConfig, /"photosPermission": "Vibely uses your photo library only when you choose photos or videos/);
  assert.match(appConfig, /"cameraPermission": "Vibely uses your camera when you choose to join video dates/);
  assert.doesNotMatch(appConfig, /Vibely only uses the photos and videos/);
  assert.doesNotMatch(appConfig, /take profile photos, chat photos, and verification selfies/);

  const appConfigJs = read("apps/mobile/app.config.js");
  assert.match(appConfigJs, /microphonePermission: 'Vibely uses your microphone when you choose to join video dates/);
  assert.doesNotMatch(appConfigJs, /microphonePermission: 'Vibely uses your microphone when you choose optional speech captions/);

  const generatedEntitlementsPath = "apps/mobile/ios/Vibely/Vibely.entitlements";
  if (existsSync(join(root, generatedEntitlementsPath))) {
    const entitlements = read(generatedEntitlementsPath);
    assert.match(entitlements, /<key>aps-environment<\/key>\s*<string>\$\(APS_ENVIRONMENT\)<\/string>/);
  }

  const generatedProjectPath = "apps/mobile/ios/Vibely.xcodeproj/project.pbxproj";
  if (existsSync(join(root, generatedProjectPath))) {
    const project = read(generatedProjectPath);
    assert.match(project, /APS_ENVIRONMENT = development;/);
    assert.match(project, /APS_ENVIRONMENT = production;/);
  }
});

test("native push and match-call permission recovery survives interrupted or returning flows", () => {
  const requestPush = read("apps/mobile/lib/requestPushPermissions.ts");
  const dashboardPrompt = read("apps/mobile/components/notifications/PushPermissionPrompt.tsx");
  const onboardingStep = read("apps/mobile/components/onboarding/steps/NotificationStep.tsx");
  const masterSwitch = read("apps/mobile/lib/pushMasterSwitch.ts");
  const matchCall = read("apps/mobile/lib/useMatchCall.tsx");
  const nativeMedia = read("apps/mobile/lib/nativeMediaPermissions.ts");
  const nativeOneSignal = read("apps/mobile/lib/onesignal.ts");

  assert.match(requestPush, /VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX/);
  assert.match(requestPush, /PUSH_PERMISSION_IN_FLIGHT_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(requestPush, /stale_in_flight_marker_recovered/);
  assert.match(requestPush, /outcome: 'request_failed'/);
  assert.match(dashboardPrompt, /markNativePushPermissionRequestInFlight/);
  assert.match(dashboardPrompt, /markNativePushPermissionAsked\('skipped'\)/);
  assert.match(onboardingStep, /markNativePushPermissionRequestInFlight/);
  assert.match(onboardingStep, /markNativePushPermissionAsked\('skipped'\)/);
  assert.match(onboardingStep, /onClose=\{\(\) => \{[\s\S]*onNext\(\);[\s\S]*\}\}/);

  assert.match(masterSwitch, /getStableOsPushPermissionState/);
  assert.match(masterSwitch, /osPermission !== 'granted'/);
  assert.match(masterSwitch, /Notifications are blocked in system settings/);
  assert.match(masterSwitch, /Allow notifications first, then turn on delivery/);
  assert.match(masterSwitch, /syncPushWithBackendIfPermissionGranted/);
  assert.match(masterSwitch, /!sync\.synced/);
  assert.match(masterSwitch, /!sync\.synced[\s\S]*disablePush\(true\)[\s\S]*throw new Error/);
  assert.match(requestPush, /const result = await syncPushSubscriptionToBackend\(userId\);[\s\S]*if \(!result\.synced\) \{[\s\S]*disablePush\(true\)[\s\S]*return result/);
  assert.ok(
    requestPush.indexOf("const result = await syncPushSubscriptionToBackend(userId);") <
      requestPush.indexOf("push_enabled: true"),
    "native push should not set push_enabled=true until the durable backend subscription sync succeeds",
  );

  assert.match(matchCall, /requestNativeMatchCallMediaPermission\(nextCallType\)/);
  assert.match(matchCall, /active_rejoin_media_preflight_blocked/);
  assert.match(matchCall, /showMatchCallPermissionRecovery\(mediaPreflight, \(\) => \{[\s\S]*joinActiveCall\(row\)/);
  assert.match(nativeMedia, /const isSettingsOnly =/);
  assert.match(nativeMedia, /permissionState = isSettingsOnly[\s\S]*\? 'denied'/);
  assert.match(nativeOneSignal, /register_onesignal_push_subscription/);
  assert.match(nativeOneSignal, /unregister_onesignal_push_subscription/);
  assert.doesNotMatch(nativeOneSignal, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(nativeOneSignal, /\.from\('notification_preferences'\)/);
});

test("web push uses subscription RPCs only and never sends users to fake browser settings", () => {
  const helper = read("src/lib/requestWebPushPermission.ts");
  const prefsHook = read("src/hooks/useNotificationPreferences.ts");
  const prompt = read("src/components/PushPermissionPrompt.tsx");
  const drawer = read("src/components/settings/NotificationsDrawer.tsx");
  const pushTypes = read("shared/pushDeliveryHealth.ts");

  assert.match(helper, /register_onesignal_push_subscription/);
  assert.match(helper, /unregister_onesignal_push_subscription/);
  assert.doesNotMatch(helper, /upsertLegacyWebPushPreference/);
  assert.doesNotMatch(helper, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(helper, /\.from\("notification_preferences"\)/);
  assert.match(helper, /syncResult\("unsupported_browser"\)/);
  assert.match(helper, /prompt_unavailable/);
  assert.doesNotMatch(prefsHook, /onesignal_player_id|onesignal_subscribed/);

  assert.match(pushTypes, /unsupported_browser/);
  assert.match(pushTypes, /prompt_unavailable/);
  assert.match(prompt, /Use your browser site settings/);
  assert.match(prompt, /Notification prompt did not open/);
  assert.doesNotMatch(prompt, /settingsLink/);
  assert.doesNotMatch(prompt, /settings\?drawer=notifications/);
  assert.match(drawer, /unsupported_browser/);
  assert.match(drawer, /prompt_unavailable/);
  assert.match(drawer, /Promise<PushSyncResult \| null>/);
  assert.match(drawer, /const result = await handleEnablePush\(\);[\s\S]*if \(!result\?\.synced\) \{[\s\S]*return;[\s\S]*\}[\s\S]*toggle\("push_enabled"\)/);
});

test("push delivery sanitizes links and targets only owned subscription rows", () => {
  const sendNotification = read("supabase/functions/send-notification/index.ts");
  const webTelemetry = read("src/lib/pushDeliveryTelemetry.ts");
  const nativeTelemetry = read("apps/mobile/lib/pushDeliveryTelemetry.ts");
  const nativeDeepLink = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
  const webOneSignal = read("src/lib/onesignal.ts");
  const collectIds = extractBetween(
    sendNotification,
    "async function collectOneSignalSubscriptionIds",
    "function eventDeepLink",
  );

  assert.match(sendNotification, /normalizePushDeepLinkPath\(eventLink\)/);
  assert.match(sendNotification, /normalizePushDeepLinkPath\(data\?\.url\)/);
  assert.match(sendNotification, /value\.startsWith\('\/\/'\) \|\| value\.includes/);
  assert.match(sendNotification, /PUSH_STATIC_APP_PATHS/);
  assert.match(sendNotification, /PUSH_DYNAMIC_SINGLE_SEGMENT_ROUTES/);
  assert.match(sendNotification, /function isAllowedPushAppPath/);
  assert.match(sendNotification, /'\/dashboard'/);
  assert.match(sendNotification, /'\/home'/);
  assert.doesNotMatch(sendNotification, /'\/\(tabs\)\/profile'/);
  assert.match(sendNotification, /const appPath = cleanPath \|\| '\/'/);
  assert.match(sendNotification, /const safePath = normalizePushDeepLinkPath\(value\)/);
  assert.match(sendNotification, /deeplink_route_class: routeClassForPath\(safePath\)/);
  assert.match(sendNotification, /normalizePushDeepLinkPath\(`\$\{url\.pathname \|\| '\/'\}\$\{url\.search\}\$\{url\.hash\}`\)/);
  assert.match(sendNotification, /deeplink_url_kind: 'external_url'[\s\S]*deeplink_route_class: 'unknown'/);
  assert.doesNotMatch(sendNotification, /deeplink_route_class: routeClassForPath\(value\)/);
  assert.doesNotMatch(sendNotification, /deeplink_route_class: routeClassForPath\(url\.pathname\)/);
  assert.match(sendNotification, /return normalizePushDeepLinkPath\(action\.url\)/);
  assert.match(sendNotification, /provider_response_body_snippet: null/);
  assert.match(sendNotification, /title: `\[\$\{category\}\]`/);
  assert.match(sendNotification, /body: delivered \? '\[delivered\]' : '\[suppressed\]'/);
  assert.match(collectIds, /\.from\('push_subscriptions'\)/);
  assert.doesNotMatch(collectIds, /prefs\.(?:one|mobile_one)signal/);
  assert.doesNotMatch(collectIds, /notification_preferences/);

  for (const source of [webTelemetry, nativeTelemetry]) {
    assert.match(source, /normalizePushDeepLinkHref/);
    assert.match(source, /value\.startsWith\(["']\/\/["']\) \|\| value\.includes/);
    assert.match(source, /normalizeNotificationAppPath/);
    assert.match(source, /return normalizePushAppPath\(value\)/);
    assert.match(source, /deeplink_url_kind: ['"]external_url['"][\s\S]*deeplink_route_class: ['"]unknown['"]/);
    assert.doesNotMatch(source, /deeplink_route_class: routeClassForPath\(url\.pathname\)/);
    assert.doesNotMatch(source, /if \(value\.startsWith\(["']\/["']\)\) return value/);
    assert.match(source, /return null/);
  }
  assert.match(webTelemetry, /normalizeNotificationAppPath\(rawPath, "web"\)/);
  assert.match(nativeTelemetry, /normalizeNotificationAppPath\(rawPath, 'native'\)/);
  assert.match(webOneSignal, /normalizePushDeepLinkHref\(url\)/);
  assert.match(webOneSignal, /window\.location\.href = safeHref/);
  assert.match(nativeDeepLink, /CANONICAL_NOTIFICATION_ORIGINS/);
  assert.match(nativeDeepLink, /NATIVE_NOTIFICATION_SCHEMES/);
  assert.match(nativeDeepLink, /!CANONICAL_NOTIFICATION_ORIGINS\.has\(u\.origin\)[\s\S]*return null/);
  assert.match(nativeDeepLink, /!NATIVE_NOTIFICATION_SCHEMES\.has\(scheme\)[\s\S]*return null/);
  assert.match(nativeDeepLink, /from '@clientShared\/notifications'/);
  assert.match(nativeDeepLink, /normalizeNotificationAppPath\(trimmed, 'native'\)/);
  assert.match(nativeDeepLink, /normalizeNotificationRouteSegment\(additionalData\?\.other_user_id\)/);
  assert.match(nativeDeepLink, /normalizeNotificationRouteSegment\(raw\?\.sender_id\)[\s\S]*normalizeNotificationRouteSegment\(raw\?\.other_user_id\)/);
  assert.match(nativeDeepLink, /const ticketId = normalizeNotificationRouteSegment\(data\.ticket_id\)/);
  assert.doesNotMatch(nativeDeepLink, /`\/settings\/ticket\/\$\{data\.ticket_id\}`/);
  assert.match(sendNotification, /safeNotificationRouteSegment\(data\.ticket_id\)/);
  assert.match(sendNotification, /safeNotificationRouteSegment\(data\?\.sender_id\)/);
  assert.match(sendNotification, /safeNotificationRouteSegment\(\s*typeof action\.otherUserId/);
});

test("Supabase migration enforces storage privacy, push ownership, location grants, and non-matchable warning readiness", () => {
  assert.match(permissionHardeningMigration, /UPDATE storage\.buckets[\s\S]+id IN \('chat-videos', 'profile-photos', 'vibe-videos'\)/);
  assert.match(permissionHardeningMigration, /DROP POLICY IF EXISTS "Anon can view chat videos for playback"/);
  assert.match(permissionHardeningMigration, /DROP POLICY IF EXISTS "Anyone can view vibe videos"/);
  assert.match(permissionHardeningMigration, /DROP POLICY IF EXISTS "Authenticated users can view vibe video intros"/);
  assert.match(permissionHardeningMigration, /CREATE POLICY "Match members can view chat videos"/);
  assert.match(permissionHardeningMigration, /m\.profile_id_1 = auth\.uid\(\)/);
  assert.match(permissionHardeningMigration, /CREATE POLICY "Users can view accessible profile photos"/);
  assert.match(permissionHardeningMigration, /can_view_profile_photo/);
  assert.match(permissionHardeningMigration, /CREATE POLICY "Users can upload their own vibe videos"/);
  assert.match(permissionHardeningMigration, /admin-review\|private\|flagged/);

  assert.match(permissionHardeningMigration, /REVOKE ALL ON FUNCTION public\.update_profile_location/);
  assert.match(permissionHardeningMigration, /TO authenticated, service_role/);
  assert.match(permissionHardeningMigration, /normalize_event_runtime_readiness_for_pairing/);
  assert.match(permissionHardeningMigration, /NEW\.readiness_status = 'warning'/);
  assert.match(permissionHardeningMigration, /NEW\.readiness_status := 'unchecked'/);
  assert.match(permissionHardeningMigration, /WHERE readiness_status = 'warning'/);
  assert.match(permissionHardeningMigration, /REVOKE ALL ON FUNCTION public\.normalize_event_runtime_readiness_for_pairing\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);

  assert.match(permissionHardeningMigration, /prevent_direct_onesignal_legacy_mirror_write/);
  assert.match(permissionHardeningMigration, /legacy OneSignal mirror columns are managed by push subscription RPCs/);
  assert.match(permissionHardeningMigration, /REVOKE ALL ON FUNCTION public\.prevent_direct_onesignal_legacy_mirror_write\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(permissionHardeningMigration, /set_config\('vibely\.onesignal_rpc_write', 'on', true\)/);
  assert.match(permissionHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.register_onesignal_push_subscription\(text, text, boolean\)[\s\S]+TO authenticated, service_role/);
  assert.match(permissionHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text\)[\s\S]+TO authenticated, service_role/);
});

test("trigger-only permission helpers are not exposed as callable RPCs", () => {
  assert.match(triggerGrantHardeningMigration, /REVOKE ALL ON FUNCTION public\.normalize_event_runtime_readiness_for_pairing\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(triggerGrantHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.normalize_event_runtime_readiness_for_pairing\(\)[\s\S]+TO service_role/);
  assert.match(triggerGrantHardeningMigration, /REVOKE ALL ON FUNCTION public\.prevent_direct_onesignal_legacy_mirror_write\(\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(triggerGrantHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.prevent_direct_onesignal_legacy_mirror_write\(\)[\s\S]+TO service_role/);
});

test("push subscription table grants keep ownership mutations behind RPCs", () => {
  assert.match(pushSubscriptionGrantHardeningMigration, /ALTER TABLE public\.push_subscriptions ENABLE ROW LEVEL SECURITY/);
  assert.match(pushSubscriptionGrantHardeningMigration, /REVOKE ALL ON TABLE public\.push_subscriptions[\s\S]+FROM anon/);
  assert.match(pushSubscriptionGrantHardeningMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+FROM authenticated/);
  assert.match(pushSubscriptionGrantHardeningMigration, /GRANT SELECT ON TABLE public\.push_subscriptions[\s\S]+TO authenticated/);
  assert.match(pushSubscriptionGrantHardeningMigration, /GRANT ALL ON TABLE public\.push_subscriptions[\s\S]+TO service_role/);
});

test("push subscription public grants are revoked in a cloud-applicable follow-up migration", () => {
  assert.match(pushSubscriptionPublicGrantHardeningMigration, /REVOKE ALL ON TABLE public\.push_subscriptions[\s\S]+FROM PUBLIC, anon/);
  assert.match(pushSubscriptionPublicGrantHardeningMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(pushSubscriptionPublicGrantHardeningMigration, /GRANT SELECT ON TABLE public\.push_subscriptions[\s\S]+TO authenticated/);
  assert.match(pushSubscriptionPublicGrantHardeningMigration, /GRANT ALL ON TABLE public\.push_subscriptions[\s\S]+TO service_role/);
});
