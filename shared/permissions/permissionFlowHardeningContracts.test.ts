import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function gitTrackedFiles(path: string): string[] {
  return execFileSync("git", ["ls-files", path], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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
const pushSubscriptionExpectedUserHardeningMigration = read(
  "supabase/migrations/20260602120000_push_subscription_expected_user_hardening.sql",
);

test("permission-adjacent provider exchanges have bounded fetch timeouts", () => {
  const providerFetch = read("supabase/functions/_shared/provider-fetch.ts");
  const geocode = read("supabase/functions/geocode/index.ts");
  const phoneVerify = read("supabase/functions/phone-verify/index.ts");
  const emailVerification = read("supabase/functions/email-verification/index.ts");
  const createChatClip = read("supabase/functions/create-chat-vibe-clip-upload/index.ts");
  const completeChatClip = read("supabase/functions/complete-chat-vibe-clip-upload/index.ts");
  const getChatMediaUrl = read("supabase/functions/get-chat-media-url/index.ts");
  const bunnyMedia = read("supabase/functions/_shared/bunny-media.ts");
  const syncChatClip = read("supabase/functions/sync-chat-vibe-clip-status/index.ts");
  const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
  const dailyDropHealth = read("supabase/functions/check-daily-drop-health/index.ts");

  assert.match(providerFetch, /export async function fetchWithProviderTimeout/);
  assert.match(providerFetch, /AbortController/);
  assert.match(providerFetch, /ProviderFetchTimeoutError/);
  assert.match(providerFetch, /providerFetchTimeoutMs/);
  assert.match(providerFetch, /includeBody\?: boolean/);
  assert.match(providerFetch, /response\.body\.getReader\(\)/);
  assert.match(providerFetch, /new ProviderFetchTimeoutError\(options\.provider, options\.operation, timeoutMs\)/);

  assert.match(geocode, /fetchWithProviderTimeout/);
  assert.match(geocode, /provider: 'nominatim'/);
  assert.match(geocode, /fallback/);

  assert.match(phoneVerify, /provider: "twilio"/);
  assert.match(phoneVerify, /operation: "lookup_phone"/);
  assert.match(phoneVerify, /operation: "verify_send"/);
  assert.match(phoneVerify, /operation: "verify_check"/);
  assert.match(phoneVerify, /twilio_send_fetch_failed/);
  assert.match(phoneVerify, /twilio_verify_fetch_failed/);

  assert.match(emailVerification, /provider: "resend"/);
  assert.match(emailVerification, /operation: "email_send"/);
  assert.match(emailVerification, /resend_fetch_failed/);

  assert.match(createChatClip, /provider: "bunny_stream"/);
  assert.match(createChatClip, /operation: "video_create"/);
  assert.match(createChatClip, /operation: "video_delete"/);
  assert.match(completeChatClip, /operation: "video_status"/);
  assert.match(getChatMediaUrl, /provider: "bunny_storage"/);
  assert.match(getChatMediaUrl, /operation: "proxy_fetch"/);
  assert.match(bunnyMedia, /from "\.\/provider-fetch\.ts"/);
  assert.match(bunnyMedia, /fetchWithProviderTimeout/);
  assert.match(bunnyMedia, /operation: "video_delete"/);
  assert.match(bunnyMedia, /operation: "file_delete"/);
  assert.match(bunnyMedia, /operation: "archive_read"/);
  assert.match(bunnyMedia, /operation: "archive_write"/);
  assert.match(bunnyMedia, /includeBody: true/);
  assert.match(bunnyMedia, /providerFetchTimeoutMs\("bunny_storage", "archive_read", 30_000\)/);
  assert.match(bunnyMedia, /providerFetchTimeoutMs\("bunny_storage", "archive_write", 30_000\)/);
  assert.match(syncChatClip, /fetchWithProviderTimeout/);
  assert.match(syncChatClip, /provider: "bunny_stream"/);
  assert.match(syncChatClip, /operation: "video_status"/);
  assert.match(uploadEventCover, /fetchWithProviderTimeout/);
  assert.match(uploadEventCover, /operation: "event_cover_upload"/);
  assert.match(dailyDropHealth, /fetchWithProviderTimeout/);
  assert.match(dailyDropHealth, /provider: "resend"/);
  assert.match(dailyDropHealth, /operation: "daily_drop_health_alert"/);
});

test("native permission metadata matches the shipped runtime prompts", () => {
  const appConfig = read("apps/mobile/app.base.json");
  const appConfigJson = JSON.parse(appConfig) as {
    expo?: {
      android?: {
        permissions?: string[];
        blockedPermissions?: string[];
      };
    };
  };
  assert.equal(
    existsSync(join(root, "apps/mobile/ios/mobile/Info.plist")),
    false,
    "stale unreferenced ios/mobile/Info.plist must not be checked in",
  );
  assert.deepEqual(
    gitTrackedFiles("apps/mobile/ios"),
    [],
    "Expo managed config is the iOS source of truth; do not commit a partial generated ios directory",
  );

  const androidManifestPath = "apps/mobile/android/app/src/main/AndroidManifest.xml";
  const androidPermissions = appConfigJson.expo?.android?.permissions ?? [];
  const androidBlockedPermissions = appConfigJson.expo?.android?.blockedPermissions ?? [];
  assert.equal(
    existsSync(join(root, androidManifestPath)),
    false,
    "Android native manifest is not checked in; Expo config must remain the source of truth",
  );
  for (const permission of [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
  ]) {
    assert.ok(androidPermissions.includes(permission), `missing Android runtime permission ${permission}`);
    assert.ok(!androidBlockedPermissions.includes(permission), `runtime permission must not be blocked ${permission}`);
  }
  for (const permission of [
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  ]) {
    assert.ok(androidBlockedPermissions.includes(permission), `broad media permission must stay blocked ${permission}`);
    assert.ok(!androidPermissions.includes(permission), `broad media permission must not be requested ${permission}`);
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
  assert.match(appConfig, /"UIBackgroundModes": \[/);
  assert.match(appConfig, /"remote-notification"/);
  assert.match(appConfig, /"audio"/);
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
  const nativeAuth = read("apps/mobile/context/AuthContext.tsx");
  const nativePrefsHook = read("apps/mobile/lib/useNotificationPreferences.ts");
  const nativeSettings = read("apps/mobile/app/settings/notifications.tsx");

  assert.match(requestPush, /VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX/);
  assert.match(requestPush, /VIBELY_PUSH_PERMISSION_ASKED_KEY_PREFIX/);
  assert.match(requestPush, /function nativePushPermissionAskedKey/);
  assert.match(requestPush, /activeUserId: null as string \| null/);
  assert.match(requestPush, /function syncPushPromptSessionUser/);
  assert.match(requestPush, /syncPushPromptSessionUser\(context\.userId\)/);
  assert.match(requestPush, /function isActiveAuthUserForPush/);
  assert.match(requestPush, /supabase\.auth\.getSession\(\)/);
  assert.match(requestPush, /code: 'stale_identity'/);
  assert.match(requestPush, /async function writePushPermissionMarker/);
  assert.match(requestPush, /async function removePushPermissionMarker/);
  assert.match(requestPush, /push_permission_marker_write_failed/);
  assert.match(requestPush, /recover_stale_in_flight_marker/);
  assert.match(requestPush, /local_pause_state_read_failed/);
  assert.match(requestPush, /permission_grant_sync_before_preferences/);
  assert.match(requestPush, /if \(!os\) \{[\s\S]*recordNativePushPromptResult\('request_failed', 'unknown'\)/);
  assert.match(requestPush, /stalePromptIdentityResult\(userId, 'request_push_permissions_after_prompt_after_sheet'\)/);
  assert.match(requestPush, /stalePromptIdentityResult\(userId, 'request_push_permissions_after_prompt_granted_sync'\)/);
  assert.match(requestPush, /stalePromptIdentityResult\(userId, 'request_push_permissions_after_prompt_after_sheet_sync'\)/);
  assert.match(requestPush, /nativePushPermissionAskedKey\(context\.userId\)/);
  assert.match(requestPush, /PUSH_PERMISSION_IN_FLIGHT_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(requestPush, /stale_in_flight_marker_recovered/);
  assert.match(requestPush, /outcome: 'request_failed'/);
  assert.match(dashboardPrompt, /activeUserIdRef/);
  assert.match(dashboardPrompt, /mountedRef/);
  assert.match(dashboardPrompt, /function isActivePromptUser|const isActivePromptUser/);
  assert.match(dashboardPrompt, /mountedRef\.current && \(promptUserId \?\? null\) === activeUserIdRef\.current/);
  assert.match(dashboardPrompt, /const promptUserId = userId/);
  assert.match(dashboardPrompt, /onOpenSettings=\{\(\) => \{[\s\S]*const promptUserId = userId[\s\S]*isActivePromptUser\(promptUserId\)[\s\S]*openSettings\(\)/);
  assert.match(dashboardPrompt, /grantedBaselineRef\.current = null/);
  assert.match(dashboardPrompt, /terminalSyncAttemptKeyRef/);
  assert.match(dashboardPrompt, /if \(isDenied\) \{[\s\S]*setPhase\('deniedRecovery'\)/);
  assert.match(dashboardPrompt, /reason: 'permission_state_read_failed'[\s\S]*setSetupRecoveryMessage\('We could not check notification permissions/);
  assert.match(dashboardPrompt, /function isActivePromptUser|const isActivePromptUser/);
  assert.match(dashboardPrompt, /completeIfSynced/);
  assert.match(dashboardPrompt, /if \(!sync\.synced\) \{[\s\S]*setSetupRecoveryMessage/);
  assert.match(dashboardPrompt, /requestPushPermissionsAfterPrompt\(promptUserId\)/);
  assert.match(dashboardPrompt, /const result = await requestPushPermissionsAfterPrompt\(promptUserId\);[\s\S]*if \(result\.outcome === 'stale_identity'\) return;[\s\S]*if \(result\.outcome === 'granted'\) \{[\s\S]*completeIfSynced\(promptUserId, result\.sync\)/);
  assert.match(dashboardPrompt, /const sync = await syncBackendAfterPushGrant\(promptUserId\);[\s\S]*completeIfSynced\(promptUserId, sync\)/);
  assert.match(dashboardPrompt, /markNativePushPermissionRequestInFlight\(promptUserId\)/);
  assert.match(dashboardPrompt, /markNativePushPermissionAsked\('skipped', promptUserId\)/);
  assert.match(onboardingStep, /activeUserIdRef/);
  assert.match(onboardingStep, /mountedRef/);
  assert.match(onboardingStep, /recoveryUserIdRef/);
  assert.match(onboardingStep, /mountedRef\.current && activeUserIdRef\.current === promptUserId/);
  assert.match(onboardingStep, /const promptUserId = userId/);
  assert.match(onboardingStep, /if \(!isActivePromptUser\(promptUserId\)\) return/);
  assert.match(onboardingStep, /requestPushPermissionsAfterPrompt\(promptUserId\)/);
  assert.doesNotMatch(onboardingStep, /const result = await requestPermission\(\)/);
  assert.match(onboardingStep, /syncBackendAfterPushGrant\(promptUserId\)/);
  assert.match(onboardingStep, /setupRecoveryMessage/);
  assert.match(onboardingStep, /if \(sync\.code === 'stale_identity'\) return;[\s\S]*if \(!sync\.synced\) \{[\s\S]*setSetupRecoveryMessage/);
  assert.match(onboardingStep, /result\.outcome === 'granted' && !result\.sync\.synced/);
  assert.match(onboardingStep, /recoveryUserIdRef\.current = promptUserId/);
  assert.match(onboardingStep, /const promptUserId = recoveryUserIdRef\.current \?\? userId/);
  assert.match(onboardingStep, /markNativePushPermissionAsked\('skipped', promptUserId\)/);
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
  assert.match(nativeOneSignal, /function isActiveSupabaseUserForPushSync/);
  assert.match(nativeOneSignal, /supabase\.auth\.getSession\(\)/);
  assert.match(nativeOneSignal, /push_subscription_sync_start/);
  assert.match(nativeOneSignal, /push_subscription_sync_before_register/);
  assert.match(nativeOneSignal, /p_expected_user_id: userId/);
  assert.doesNotMatch(nativeOneSignal, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(nativeOneSignal, /\.from\('notification_preferences'\)/);
  assert.match(nativeAuth, /markSessionExpired[\s\S]*disconnectOneSignalForLogout\(uid \?\? null\)/);
  assert.match(nativeAuth, /markSessionExpired[\s\S]*clearRevenueCatUser\(\)/);

  assert.match(nativePrefsHook, /pendingPatchRef/);
  assert.match(nativePrefsHook, /activeUserIdRef/);
  assert.match(nativePrefsHook, /mountedRef/);
  assert.match(nativePrefsHook, /persistedPrefsRef/);
  assert.match(nativePrefsHook, /flushInFlightRef/);
  assert.match(nativePrefsHook, /qc\.getQueryData<NotificationPrefs>\(notificationPreferencesQueryKey\(currentUserId\)\)/);
  assert.match(nativePrefsHook, /while \(activeUserIdRef\.current === targetUserId && Object\.keys\(pendingPatchRef\.current\)\.length\)/);
  assert.match(nativePrefsHook, /setIsUpdating\(true\);[\s\S]*pendingPatchRef\.current =/);
  assert.match(nativePrefsHook, /const previous = persistedPrefsRef\.current/);
  assert.match(nativePrefsHook, /persistedPrefsRef\.current = next/);
  assert.match(nativePrefsHook, /void flushPendingPrefs\(userId\);/);
  assert.doesNotMatch(nativePrefsHook, /setTimeout|debounceRef/);
  assert.match(nativePrefsHook, /updated_at: new Date\(\)\.toISOString\(\)/);
  assert.match(nativeSettings, /const \{ prefs, updatePref, updatePrefs, isLoading, isUpdating, saveError \}/);
  assert.match(nativeSettings, /requestPushPermissionsAfterPrompt\(user\.id\)/);
  assert.match(nativeSettings, /syncBackendAfterPushGrant/);
  assert.match(nativeSettings, /const sync = await syncBackendAfterPushGrant\(user\.id\)/);
  assert.match(nativeSettings, /if \(result\.outcome === 'granted' && !result\.sync\.synced\)/);
  assert.match(nativeSettings, /Notification setup needs a retry/);
  assert.doesNotMatch(nativeSettings, /requestPermission\(\)/);
  assert.match(nativeSettings, /const providerControlsBusy = preferencesBusy \|\| masterBusy/);
  assert.match(nativeSettings, /const categoryControlsBusy = preferencesBusy/);
  assert.doesNotMatch(nativeSettings, /categoryControls\w+ = preferencesBusy \|\| !prefs\.push_enabled \|\| isPaused/);
  assert.match(nativeSettings, /if \(Platform\.OS !== 'ios' && preferencesBusy\) return/);
  assert.match(nativeSettings, /disabled=\{providerControlsBusy\}/);
  assert.match(nativeSettings, /const saveQuietHoursPatch = useCallback\([\s\S]*updatePrefs\(patch\)/);
  assert.match(nativeSettings, /if \(Platform\.OS !== 'ios' && preferencesBusy\) return;[\s\S]*quiet_hours_start/);
  assert.match(nativeSettings, /if \(Platform\.OS !== 'ios' && preferencesBusy\) return;[\s\S]*quiet_hours_end/);
  assert.match(nativeSettings, /Category choices below are still saved and will apply when notifications resume/);
  assert.match(nativeSettings, /Category choices below are still saved and will apply when you turn this back on/);
  assert.doesNotMatch(nativeSettings, /\.upsert\(\{ user_id: user\.id/);
});

test("web push uses subscription RPCs only and never sends users to fake browser settings", () => {
  const helper = read("src/lib/requestWebPushPermission.ts");
  const prefsHook = read("src/hooks/useNotificationPreferences.ts");
  const prompt = read("src/components/PushPermissionPrompt.tsx");
  const drawer = read("src/components/settings/NotificationsDrawer.tsx");
  const pushTypes = read("shared/pushDeliveryHealth.ts");
  const webAuth = read("src/contexts/AuthContext.tsx");

  assert.match(helper, /register_onesignal_push_subscription/);
  assert.match(helper, /unregister_onesignal_push_subscription/);
  assert.match(helper, /p_expected_user_id: userId/);
  assert.match(helper, /async function isActiveAuthUserForWebPush\(userId: string, context: string\)/);
  assert.match(helper, /supabase\.auth\.getSession\(\)/);
  assert.match(helper, /return syncResult\("stale_identity"\)/);
  assert.match(helper, /sync_before_identity_bind/);
  assert.match(helper, /sync_before_register/);
  assert.match(helper, /sync_before_cached_result/);
  assert.match(helper, /function forgetBackendSyncCacheForUser\(userId: string\)/);
  assert.match(helper, /lastBackendSyncBySignature\.delete\(key\)/);
  assert.match(helper, /WEB_PUSH_BACKEND_SYNC_CACHE_KEY/);
  assert.match(helper, /finally \{[\s\S]*forgetRememberedWebPushSubscriptionId\(userId\);[\s\S]*forgetBackendSyncCacheForUser\(userId\);[\s\S]*syncInFlightByUser\.delete\(userId\);[\s\S]*\}/);
  assert.doesNotMatch(helper, /upsertLegacyWebPushPreference/);
  assert.doesNotMatch(helper, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(helper, /\.from\("notification_preferences"\)/);
  assert.match(helper, /syncResult\("unsupported_browser"\)/);
  assert.match(helper, /prompt_unavailable/);
  assert.doesNotMatch(prefsHook, /onesignal_player_id|onesignal_subscribed/);
  assert.match(prefsHook, /pendingPatchRef/);
  assert.match(prefsHook, /let cancelled = false/);
  assert.match(prefsHook, /if \(cancelled \|\| activeUserIdRef\.current !== currentUserId\) return/);
  assert.match(prefsHook, /if \(!cancelled && activeUserIdRef\.current === currentUserId\) setIsPushSubscribed\(subscribed\)/);
  assert.match(prefsHook, /\.catch\(\(\) => \{[\s\S]*setIsPushSubscribed\(false\)/);
  assert.match(prefsHook, /const bool = \(key: keyof NotificationPreferences, fallback: boolean\)/);
  assert.match(prefsHook, /mountedRef/);
  assert.match(prefsHook, /return \(\) => \{[\s\S]*cancelled = true;[\s\S]*\}/);
  assert.match(prefsHook, /const loadingDefaults = \{/);
  assert.match(prefsHook, /applyPrefs\(loadingDefaults\);[\s\S]*persistedPrefsRef\.current = loadingDefaults;[\s\S]*setIsLoading\(true\);/);
  assert.match(prefsHook, /flushInFlightRef/);
  assert.match(prefsHook, /activeUserIdRef/);
  assert.match(prefsHook, /if \(flushInFlightRef\.current\) return/);
  assert.match(prefsHook, /while \(activeUserIdRef\.current === userId && Object\.keys\(pendingPatchRef\.current\)\.length\)/);
  assert.match(prefsHook, /persistedPrefsRef/);
  assert.match(prefsHook, /message_bundle_enabled: bool\("message_bundle_enabled", true\)/);
  assert.match(prefsHook, /\.upsert\(/);
  assert.match(prefsHook, /setIsSaving\(true\);[\s\S]*pendingPatchRef\.current =/);
  assert.match(prefsHook, /Object\.entries\(updated\)\.filter\(\(\[, value\]\) => value !== undefined\)/);
  assert.match(prefsHook, /void flushPendingPrefs\(userId\);/);
  assert.match(prefsHook, /finally \{[\s\S]*flushInFlightRef\.current = false;[\s\S]*setIsSaving\(false\);[\s\S]*\}/);
  assert.doesNotMatch(prefsHook, /setTimeout|debounceRef/);
  assert.doesNotMatch(prefsHook, /\.update\(\{ \.\.\.updated/);

  assert.match(pushTypes, /unsupported_browser/);
  assert.match(pushTypes, /prompt_unavailable/);
  assert.match(prompt, /Use your browser site settings/);
  assert.match(prompt, /PROMPTED_KEY_PREFIX/);
  assert.match(prompt, /function promptedKeyForUser/);
  assert.match(prompt, /promptedKeyForUser\(user\.id\)/);
  assert.match(prompt, /activeUserIdRef/);
  assert.match(prompt, /const promptUserId = user\.id/);
  assert.match(prompt, /activeUserIdRef\.current === promptUserId/);
  assert.match(prompt, /requestWebPushPermissionAndSync\(promptUserId\)/);
  assert.match(prompt, /result\.code === "stale_identity"[\s\S]*localStorage\.removeItem\(promptedKeyForUser\(promptUserId\)\)/);
  assert.match(prompt, /user_id: promptUserId/);
  assert.match(prompt, /setOpen\(false\);\s*setBusy\(false\);\s*setRecovery\(null\);/);
  assert.match(prompt, /lastEligibilityCountsRef\.current = \{ matchCount: null, regCount: null \}/);
  assert.match(prompt, /let cancelled = false/);
  assert.match(prompt, /window\.clearTimeout\(promptTimer\)/);
  assert.match(prompt, /Notification prompt did not open/);
  assert.match(webAuth, /web_push\.invalid_session_clear/);
  assert.match(webAuth, /removeExternalUserId/);
  assert.doesNotMatch(prompt, /settingsLink/);
  assert.doesNotMatch(prompt, /settings\?drawer=notifications/);
  assert.match(drawer, /unsupported_browser/);
  assert.match(drawer, /prompt_unavailable/);
  assert.match(drawer, /result\?\.code === "stale_identity"/);
  assert.match(drawer, /Promise<PushSyncResult \| null>/);
  assert.match(drawer, /const providerSetupBusyRef = useRef\(false\)/);
  assert.match(drawer, /if \(providerSetupBusyRef\.current\) return/);
  assert.match(drawer, /providerSetupBusyRef\.current = true/);
  assert.match(drawer, /const result = await handleEnablePush\(\{ setupBusyAlreadySet: true \}\);[\s\S]*if \(!result\?\.synced\) \{[\s\S]*return;[\s\S]*\}[\s\S]*savePrefs\(\{ push_enabled: nextEnabled \}\)/);
  assert.match(drawer, /const providerControlsBusy = isLoading \|\| isSaving \|\| isSyncing \|\| masterToggleBusy/);
  assert.match(drawer, /const categoryControlsBusy = isLoading \|\| isSaving/);
  assert.doesNotMatch(drawer, /const disabled = isLoading \|\| !prefs\.push_enabled \|\| isPaused/);
  assert.match(drawer, /Category choices below are still saved and will apply when notifications resume/);
  assert.match(drawer, /Category choices below will apply when you turn this back on/);
  assert.match(drawer, /disabled=\{providerControlsBusy\}/);
  assert.match(drawer, /checked=\{prefs\.quiet_hours_enabled\}[\s\S]*disabled=\{isLoading \|\| isSaving\}/);
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

  assert.doesNotMatch(sendNotification, /function jwtPayloadRole/);
  assert.doesNotMatch(sendNotification, /atob\(/);
  assert.match(sendNotification, /const isRawServiceRoleKey = token === serviceKey/);
  assert.match(sendNotification, /await anonClient\.auth\.getClaims\(token\)/);
  assert.match(sendNotification, /const role = typeof claims\?\.claims\?\.role === 'string'/);
  assert.match(sendNotification, /isServiceRole = role === 'service_role'/);
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
  assert.match(webOneSignal, /resolveNotificationActionRoute\(data\?\.action\)/);
  assert.match(webOneSignal, /settingsDrawerActionRoute = actionRoute === "\/settings\?drawer=notifications"/);
  assert.match(webOneSignal, /if \(settingsDrawerActionRoute\) \{[\s\S]*window\.location\.href = settingsDrawerActionRoute;[\s\S]*return;/);
  assert.match(webOneSignal, /normalizePushDeepLinkHref\(actionRoute \?\? payloadUrl\)/);
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
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /p_expected_user_id uuid DEFAULT NULL/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /p_expected_user_id IS NOT NULL AND p_expected_user_id <> v_user_id/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /register_onesignal_push_subscription user mismatch/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /unregister_onesignal_push_subscription user mismatch/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /DROP FUNCTION IF EXISTS public\.register_onesignal_push_subscription\(text, text, boolean\)/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /DROP FUNCTION IF EXISTS public\.unregister_onesignal_push_subscription\(text, text\)/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.register_onesignal_push_subscription\(text, text, boolean, uuid\)[\s\S]+TO authenticated, service_role/);
  assert.match(pushSubscriptionExpectedUserHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text, uuid\)[\s\S]+TO authenticated, service_role/);
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
