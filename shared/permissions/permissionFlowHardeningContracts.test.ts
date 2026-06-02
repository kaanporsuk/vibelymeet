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

test("native iOS permission metadata matches the shipped runtime prompts", () => {
  const plistPaths = [
    "apps/mobile/ios/Vibely/Info.plist",
    "apps/mobile/ios/mobile/Info.plist",
  ].filter((path) => existsSync(join(root, path)));
  assert.ok(plistPaths.length > 0, "expected at least one checked-in iOS Info.plist");
  const entitlements = read("apps/mobile/ios/Vibely/Vibely.entitlements");
  const project = read("apps/mobile/ios/Vibely.xcodeproj/project.pbxproj");

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

  assert.match(entitlements, /<key>aps-environment<\/key>\s*<string>\$\(APS_ENVIRONMENT\)<\/string>/);
  assert.match(project, /APS_ENVIRONMENT = development;/);
  assert.match(project, /APS_ENVIRONMENT = production;/);
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

  assert.match(pushTypes, /unsupported_browser/);
  assert.match(pushTypes, /prompt_unavailable/);
  assert.match(prompt, /Use your browser site settings/);
  assert.match(prompt, /Notification prompt did not open/);
  assert.doesNotMatch(prompt, /settingsLink/);
  assert.doesNotMatch(prompt, /settings\?drawer=notifications/);
  assert.match(drawer, /unsupported_browser/);
  assert.match(drawer, /prompt_unavailable/);
});

test("push delivery sanitizes links and targets only owned subscription rows", () => {
  const sendNotification = read("supabase/functions/send-notification/index.ts");
  const webTelemetry = read("src/lib/pushDeliveryTelemetry.ts");
  const nativeTelemetry = read("apps/mobile/lib/pushDeliveryTelemetry.ts");
  const webOneSignal = read("src/lib/onesignal.ts");
  const collectIds = extractBetween(
    sendNotification,
    "async function collectOneSignalSubscriptionIds",
    "function eventDeepLink",
  );

  assert.match(sendNotification, /normalizePushDeepLinkPath\(eventLink\)/);
  assert.match(sendNotification, /normalizePushDeepLinkPath\(data\?\.url\)/);
  assert.match(sendNotification, /if \(!value \|\| value\.startsWith\('\/\/'\)\) return null/);
  assert.match(sendNotification, /provider_response_body_snippet: null/);
  assert.match(sendNotification, /title: `\[\$\{category\}\]`/);
  assert.match(sendNotification, /body: delivered \? '\[delivered\]' : '\[suppressed\]'/);
  assert.match(collectIds, /\.from\('push_subscriptions'\)/);
  assert.doesNotMatch(collectIds, /prefs\.(?:one|mobile_one)signal/);
  assert.doesNotMatch(collectIds, /notification_preferences/);

  for (const source of [webTelemetry, nativeTelemetry]) {
    assert.match(source, /normalizePushDeepLinkHref/);
    assert.match(source, /value\.startsWith\(["']\/\/["']\)/);
    assert.match(source, /return null/);
  }
  assert.match(webOneSignal, /normalizePushDeepLinkHref\(url\)/);
  assert.match(webOneSignal, /window\.location\.href = safeHref/);
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
