import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const webOneSignal = read("src/lib/onesignal.ts");
const appBootstrap = read("src/hooks/useAppBootstrap.ts");
const webPushSync = read("src/lib/requestWebPushPermission.ts");
const webPushHealth = read("src/hooks/usePushDeliveryHealth.ts");
const pushPermissionPrompt = read("src/components/PushPermissionPrompt.tsx");
const notificationsDrawer = read("src/components/settings/NotificationsDrawer.tsx");
const sendNotification = read("supabase/functions/send-notification/index.ts");
const pushWebhook = read("supabase/functions/push-webhook/index.ts");
const nativeOneSignal = read("apps/mobile/lib/onesignal.ts");
const nativePushRegistration = read("apps/mobile/components/PushRegistration.tsx");
const nativePushForegroundSync = read("apps/mobile/lib/nativePushForegroundSync.ts");
const nativePushHealth = read("apps/mobile/lib/usePushDeliveryHealth.ts");
const nativePushPermission = read("apps/mobile/lib/usePushPermission.ts");
const nativePermissionSettings = read("apps/mobile/lib/permissionSettings.ts");
const nativeNotificationPause = read("apps/mobile/lib/notificationPause.ts");
const nativePushMasterSwitch = read("apps/mobile/lib/pushMasterSwitch.ts");
const nativeDeepLink = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const nativeAppConfig = read("apps/mobile/app.config.js");
const nativeIosBuildSettingsPlugin = read("apps/mobile/plugins/withIosNativeBuildSettings.js");
const pushSubscriptionOwnershipMigration = read("supabase/migrations/20260523184500_onesignal_push_subscription_ownership.sql");
const pushSubscriptionRpcGrantMigration = read("supabase/migrations/20260523193000_restrict_onesignal_push_subscription_rpc_grants.sql");
const reviewFollowupsMigration = read("supabase/migrations/20260523201000_review_comment_followups_1019_1026.sql");
const unregisterNullCleanupMigration = read("supabase/migrations/20260527221500_onesignal_unregister_null_subscription_cleanup.sql");
const reviewComments1086To1100Migration = read("supabase/migrations/20260527234117_review_comments_1086_1100_followups.sql");
const reviewComments1099To1106Migration = read("supabase/migrations/20260528130000_review_comments_1099_1106_followups.sql");
const branchDelta = read("docs/branch-deltas/fix-onesignal-provider-operational-qa.md");

test("web OneSignal initialization is env-backed and root-worker aware", () => {
  assert.match(read("index.html"), /OneSignalSDK\.page\.js/);
  assert.match(webOneSignal, /const ONESIGNAL_SDK_SRC = "https:\/\/cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.page\.js"/);
  assert.match(webOneSignal, /ONESIGNAL_INIT_FALLBACK_TIMEOUT_MS = 12_000/);
  assert.match(webOneSignal, /existingScript instanceof HTMLScriptElement/);
  assert.match(webOneSignal, /script\.onerror = handleOneSignalSdkScriptError/);
  assert.match(webOneSignal, /import\.meta\.env\.VITE_ONESIGNAL_APP_ID/);
  assert.match(webOneSignal, /OneSignal\.init\(\{[\s\S]{0,240}appId/);
  assert.match(webOneSignal, /serviceWorkerParam:\s*\{ scope:\s*["']\/["'] \}/);
  assert.match(webOneSignal, /vibely-onesignal-subscription-changed/);
  assert.doesNotMatch(webOneSignal, /appId:\s*["'][0-9a-f]{8}-[0-9a-f-]{20,}["']/i);
});

test("root-served OneSignal service worker assets are represented and distinct from app-owned sw.js", () => {
  for (const path of ["public/OneSignalSDK.sw.js", "public/OneSignalSDKWorker.js", "public/sw.js"]) {
    assert.ok(existsSync(join(root, path)), `${path} should exist`);
  }
  assert.match(read("public/OneSignalSDK.sw.js"), /OneSignalSDK\.sw\.js/);
  assert.match(read("public/OneSignalSDK.sw.js"), /cdn\.onesignal\.com\/sdks\/web\/v16/);
  assert.match(read("public/OneSignalSDKWorker.js"), /OneSignalSDK\.sw\.js/);
  assert.match(read("public/OneSignalSDKWorker.js"), /cdn\.onesignal\.com\/sdks\/web\/v16/);
  assert.match(read("public/sw.js"), /Legacy custom service worker shim/);
  assert.doesNotMatch(read("public/sw.js"), /OneSignalSDK|onesignal/i);
});

test("web identity binding and backend sync avoid token-refresh login spam", () => {
  assert.match(appBootstrap, /TOKEN_REFRESHED \/ session refresh/);
  assert.match(appBootstrap, /const \{ session, isLoading \} = useAuth\(\)/);
  assert.match(appBootstrap, /if \(isLoading\) return/);
  assert.match(appBootstrap, /const userId = session\?\.user\?\.id \?\? null/);
  assert.match(appBootstrap, /setExternalUserId\(userId\)/);
  assert.match(appBootstrap, /syncWebPushRegistrationToBackend\(userId\)/);
  assert.match(webOneSignal, /lastLoggedInUserId/);
  assert.match(webOneSignal, /loginInFlightUserId/);
  assert.match(webOneSignal, /settleOneSignalInitUnavailable/);
  assert.match(webOneSignal, /reason === "sdk_init_timeout"[\s\S]*initTimedOut = true;[\s\S]*resolveInit\?\.\(\);[\s\S]*dispatchInitSettled\(\);/);
  assert.match(webOneSignal, /function waitForActualInitSettled/);
  assert.match(webOneSignal, /await initFinished;\s*if \(!initResolvedFlag\) \{\s*await waitForActualInitSettled\(\);/s);
  assert.match(appBootstrap, /retrySyncOnLateOneSignalInit/);
  assert.match(webOneSignal, /function createDeferredSdkFallbackResolver/);
  assert.match(webOneSignal, /window\.addEventListener\("vibely-onesignal-init-settled", onInitSettled, \{ once: true \}\)/);
  assert.match(webOneSignal, /activeIdentityUserId = userId;\s*lastLoggedInUserId = null;\s*loginInFlightUserId = null/s);
  assert.match(webOneSignal, /if \(lastLoggedInUserId === userId\) return generation/);
  assert.match(webOneSignal, /if \(loginInFlightUserId === userId\) return generation/);
  assert.match(webOneSignal, /if \(initResolvedFlag && !sdkUsable\) return generation/);
  assert.match(webOneSignal, /loginInFlightUserId = userId/);
  assert.match(webOneSignal, /clearInFlightLoginIfInitFails\(userId\)/);
  assert.match(webOneSignal, /OneSignal\.login\(userId\)/);
  assert.match(webOneSignal, /if \(loginInFlightUserId === userId\) loginInFlightUserId = null/);
  assert.match(webOneSignal, /OneSignal\.logout\(\)/);
  assert.match(nativeOneSignal, /runtimeState\.activeIdentityUserId = nextUserId \|\| null;\s*runtimeState\.lastLoggedInUserId = null/s);
});

test("web player-id and subscription sync writes through subscription RPCs only", () => {
  assert.match(webPushSync, /getPlayerId\(/);
  assert.match(webPushSync, /WEB_PLAYER_ID_LOGOUT_LOOKUP/);
  assert.match(webPushSync, /WEB_PUSH_SUBSCRIPTION_ID_CACHE_KEY/);
  assert.match(webPushSync, /rememberWebPushSubscriptionId\(userId, playerId\)/);
  assert.match(webPushSync, /readRememberedWebPushSubscriptionId\(userId\)/);
  assert.match(webPushSync, /forgetRememberedWebPushSubscriptionId\(userId\)/);
  assert.match(webPushSync, /const livePlayerId = await getPlayerId\(WEB_PLAYER_ID_LOGOUT_LOOKUP\)/);
  assert.doesNotMatch(webPushSync, /playerId\s*\?\s*await pushSubscriptionRpc\(\)\.rpc\(["']unregister_onesignal_push_subscription["']/);
  assert.match(webPushSync, /p_subscription_id:\s*playerId/);
  assert.match(webPushSync, /isSubscribed\(\)/);
  assert.match(webPushSync, /register_onesignal_push_subscription/);
  assert.match(webPushSync, /unregister_onesignal_push_subscription/);
  assert.doesNotMatch(webPushSync, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(webPushSync, /upsertLegacyWebPushPreference/);
  assert.doesNotMatch(webPushSync, /\.from\(["']notification_preferences["']\)/);
  assert.match(webPushHealth, /\.from\(["']push_subscriptions["']\)/);
  assert.match(webPushHealth, /currentSubscriptionId = localId\?\.trim\(\) \|\| null/);
  assert.match(webPushHealth, /readBackendPushSubscription\(user\.id, currentSubscriptionId\)/);
  assert.doesNotMatch(webPushHealth, /legacyMatchesCurrentDevice/);
  assert.doesNotMatch(webPushHealth, /onesignal_player_id/);
  assert.doesNotMatch(webPushHealth, /onesignal_subscribed/);
  assert.doesNotMatch(webPushHealth, /Failed to read latest web push subscription row/);
  assert.doesNotMatch(webPushHealth, /\.order\(["']last_seen_at["']/);
  assert.match(webPushHealth, /\.select\(["']push_enabled, paused_until["']\)/);
  assert.match(webPushHealth, /vibely-onesignal-subscription-changed/);
  assert.match(pushPermissionPrompt, /requestWebPushPermissionAndSync\(user\.id\)/);
  assert.match(pushPermissionPrompt, /Notifications are blocked in your browser/);
  assert.match(pushPermissionPrompt, /Use your browser site settings/);
  assert.match(pushPermissionPrompt, /Notification prompt did not open/);
  assert.doesNotMatch(pushPermissionPrompt, /settingsLink/);
  assert.doesNotMatch(pushPermissionPrompt, /settings\?drawer=notifications/);
  assert.match(notificationsDrawer, /requestWebPushPermissionAndSync\(user\.id\)/);
});

test("native OneSignal identity and subscription sync mirror the backend contract", () => {
  assert.match(nativeOneSignal, /EXPO_PUBLIC_ONESIGNAL_APP_ID/);
  assert.match(nativeOneSignal, /react-native-onesignal/);
  assert.match(nativeOneSignal, /lastLoggedInUserId/);
  assert.match(nativeOneSignal, /runtimeState\.lastLoggedInUserId === nextUserId/);
  assert.match(nativeOneSignal, /OneSignal\.login\(nextUserId\)/);
  assert.match(nativeOneSignal, /OneSignal\.logout\(\)/);
  assert.match(nativeOneSignal, /ensureOneSignalInitialized\(\)/);
  assert.match(nativeOneSignal, /requestOneSignalPushPermission/);
  assert.match(nativeOneSignal, /initAttemptedAppId/);
  assert.match(nativeOneSignal, /register_onesignal_push_subscription/);
  assert.match(nativeOneSignal, /unregister_onesignal_push_subscription/);
  assert.match(nativeOneSignal, /OneSignal\.User\.pushSubscription\.optOut\(\)/);
  assert.match(nativeOneSignal, /NATIVE_PUSH_SUBSCRIPTION_ID_CACHE_KEY/);
  assert.match(nativeOneSignal, /rememberNativePushSubscriptionId\(userId, subscriptionId\)/);
  assert.match(nativeOneSignal, /readRememberedNativePushSubscriptionId\(userId\)/);
  assert.match(nativeOneSignal, /forgetRememberedNativePushSubscriptionId\(userId\)/);
  assert.match(nativePushPermission, /openPermissionSettings\('push_permission'\)/);
  assert.match(nativePermissionSettings, /Linking\.openSettings\(\)/);
  assert.match(nativePermissionSettings, /Linking\.openURL\('app-settings:'\)/);
  assert.match(nativePermissionSettings, /AppState\.addEventListener\('change'/);
  assert.doesNotMatch(nativeOneSignal, /isMissingPushSubscriptionRpc/);
  assert.doesNotMatch(nativeOneSignal, /\.from\(["']notification_preferences["']\)/);
  assert.match(
    nativePushForegroundSync,
    /await syncNativePushSuppressionWithBackend\(userId\);\s*await syncPushWithBackendIfPermissionGranted\(userId\);/,
  );
  assert.match(
    nativePushHealth,
    /await syncNativePushSuppressionWithBackend\(userId\);\s*const result = await syncPushWithBackendIfPermissionGranted\(userId\);/,
  );
  assert.match(nativeNotificationPause, /syncPushAfterRestoringDelivery\(userId\)/);
  assert.match(nativePushMasterSwitch, /syncPushAfterRestoringDelivery\(userId\)/);
  assert.match(nativePushRegistration, /const \{ user, onboardingComplete, loading \} = useAuth\(\)/);
  assert.match(nativePushRegistration, /if \(loading\) return/);
  assert.match(nativePushRegistration, /bindOneSignalExternalUser\(user\.id\)/);
  assert.match(nativePushRegistration, /syncNativePushDeliveryOnForeground\(user\.id/);
  assert.match(nativePushHealth, /\.from\(['"]push_subscriptions['"]\)/);
  assert.match(nativePushHealth, /currentSubscriptionId = localId\?\.trim\(\) \|\| null/);
  assert.match(nativePushHealth, /readBackendPushSubscription\(userId, currentSubscriptionId\)/);
  assert.doesNotMatch(nativePushHealth, /legacyMatchesCurrentDevice/);
  assert.doesNotMatch(nativePushHealth, /mobile_onesignal_player_id/);
  assert.doesNotMatch(nativePushHealth, /mobile_onesignal_subscribed/);
  assert.doesNotMatch(nativePushHealth, /Failed to read latest native push subscription row/);
  assert.doesNotMatch(nativePushHealth, /\.order\(['"]last_seen_at['"]/);
  assert.match(nativeAppConfig, /onesignal-expo-plugin/);
  assert.match(nativeAppConfig, /mode:\s*oneSignalMode/);
  assert.match(nativeAppConfig, /smallIcons:\s*\[\s*['"]\.\/assets\/onesignal\/ic_stat_onesignal_default\.png['"]\s*\]/);
  assert.match(nativeAppConfig, /largeIcons:\s*\[\s*['"]\.\/assets\/onesignal\/ic_onesignal_large_icon_default\.png['"]\s*\]/);
  assert.match(nativeAppConfig, /smallIconAccentColor:\s*['"]#8B5CF6['"]/);
  assert.ok(existsSync(join(root, "apps/mobile/assets/onesignal/ic_stat_onesignal_default.png")));
  assert.ok(existsSync(join(root, "apps/mobile/assets/onesignal/ic_onesignal_large_icon_default.png")));
  assert.match(nativeIosBuildSettingsPlugin, /isAppOrExtensionTarget/);
  assert.match(nativeIosBuildSettingsPlugin, /applyDeploymentTarget\(project, target\)/);
  assert.match(nativeIosBuildSettingsPlugin, /IOS_DEPLOYMENT_TARGET = ['"]15\.1['"]/);
  assert.match(nativeIosBuildSettingsPlugin, /IPHONEOS_DEPLOYMENT_TARGET/);
});

test("send-notification reads existing OneSignal secrets and logs safe suppression/provider outcomes", () => {
  assert.match(sendNotification, /Deno\.env\.get\(["']ONESIGNAL_APP_ID["']\)/);
  assert.match(sendNotification, /Deno\.env\.get\(["']ONESIGNAL_REST_API_KEY["']\)/);
  assert.match(sendNotification, /include_subscription_ids:\s*playerIds/);
  assert.match(sendNotification, /target_channel:\s*["']push["']/);
  assert.match(sendNotification, /Authorization["']:\s*`Key \$\{ONESIGNAL_REST_API_KEY\}`/);
  assert.match(sendNotification, /\.from\(["']push_subscriptions["']\)/);
  assert.match(sendNotification, /collectOneSignalSubscriptionIds\(user_id, prefs\)/);
  assert.match(sendNotification, /subscription_table_target_count/);
  assert.match(sendNotification, /notification_log/);
  assert.match(sendNotification, /push_delivery_diagnostic/);
  assert.match(sendNotification, /provider_request_attempted/);
  assert.match(sendNotification, /provider_status/);
  assert.match(sendNotification, /provider_http_status/);
  assert.match(sendNotification, /provider_notification_id/);
  assert.match(sendNotification, /provider_response_body_snippet/);
  assert.match(sendNotification, /provider_response_content_type/);
  assert.match(sendNotification, /provider_accepted_at/);
  assert.match(sendNotification, /console\.log\('OneSignal:', osResponse\.status/);
  assert.doesNotMatch(sendNotification, /console\.(?:log|warn|error)\([^)]*(ONESIGNAL_REST_API_KEY|Authorization|osPayload|osResponseText)[^)]*\)/);
});

test("send-notification preserves preference gates and no-player suppression", () => {
  for (const marker of [
    "blocked_pair",
    "no_preferences",
    "account_paused",
    "paused",
    "user_disabled",
    "unknown_category",
    "match_muted",
    "quiet_hours",
    "no_player_id",
    "onesignal_http_",
    "onesignal_exception",
  ]) {
    assert.match(sendNotification, new RegExp(marker));
  }
  assert.match(sendNotification, /prefs\?\.onesignal_subscribed/);
  assert.match(sendNotification, /prefs\?\.onesignal_player_id/);
  assert.match(sendNotification, /prefs\?\.mobile_onesignal_subscribed/);
  assert.match(sendNotification, /prefs\?\.mobile_onesignal_player_id/);
  assert.doesNotMatch(sendNotification, /addOneSignalSubscriptionId\(ids, prefs/);
  assert.match(sendNotification, /new Set<string>\(\)/);
  assert.match(sendNotification, /BYPASS_QUIET_HOURS/);
  assert.match(sendNotification, /CATEGORY_TO_COLUMN/);
});

test("OneSignal subscription ownership migration supports multi-device native delivery and account switching", () => {
  assert.match(pushSubscriptionOwnershipMigration, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/);
  assert.match(pushSubscriptionOwnershipMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_onesignal_subscription_unique/);
  assert.match(pushSubscriptionOwnershipMigration, /register_onesignal_push_subscription/);
  assert.match(pushSubscriptionOwnershipMigration, /unregister_onesignal_push_subscription/);
  assert.match(pushSubscriptionOwnershipMigration, /ON CONFLICT \(provider, subscription_id\) DO UPDATE/);
  assert.match(pushSubscriptionOwnershipMigration, /SELECT DISTINCT ON \(btrim\(onesignal_player_id\)\)/);
  assert.match(pushSubscriptionOwnershipMigration, /SELECT DISTINCT ON \(btrim\(mobile_onesignal_player_id\)\)/);
  assert.match(pushSubscriptionOwnershipMigration, /notification_preferences_onesignal_subscription_dedupe/);
  assert.match(pushSubscriptionOwnershipMigration, /platform IN \('web', 'ios', 'android', 'native', 'unknown'\)/);
  assert.match(pushSubscriptionOwnershipMigration, /IF v_subscription_id IS NOT NULL THEN[\s\S]*DELETE FROM public\.push_subscriptions/);
  assert.match(pushSubscriptionOwnershipMigration, /v_platform IN \('ios', 'android', 'native'\) AND platform IN \('ios', 'android', 'native'\)/);
  assert.match(reviewFollowupsMigration, /CREATE OR REPLACE FUNCTION public\.unregister_onesignal_push_subscription/);
  assert.match(reviewFollowupsMigration, /v_platform IN \('ios', 'android', 'native'\) AND platform IN \('ios', 'android', 'native'\)/);
  assert.match(unregisterNullCleanupMigration, /CREATE OR REPLACE FUNCTION public\.unregister_onesignal_push_subscription/);
  assert.match(unregisterNullCleanupMigration, /IF v_subscription_id IS NOT NULL THEN[\s\S]*DELETE FROM public\.push_subscriptions/);
  assert.doesNotMatch(unregisterNullCleanupMigration, /v_subscription_id IS NULL OR subscription_id = v_subscription_id/);
  assert.match(reviewComments1086To1100Migration, /IF v_subscription_id IS NOT NULL THEN[\s\S]*DELETE FROM public\.push_subscriptions/);
  assert.doesNotMatch(reviewComments1086To1100Migration, /v_subscription_id IS NULL OR subscription_id = v_subscription_id/);
  assert.match(reviewComments1099To1106Migration, /IF v_subscription_id IS NULL THEN[\s\S]*RETURN;/);
  assert.doesNotMatch(reviewComments1099To1106Migration, /v_subscription_id IS NULL OR (onesignal_player_id|mobile_onesignal_player_id|subscription_id)/);
  assert.match(unregisterNullCleanupMigration, /DELETE FROM public\.push_subscriptions/);
  assert.match(unregisterNullCleanupMigration, /GRANT EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text\) TO authenticated/);
  assert.match(unregisterNullCleanupMigration, /GRANT EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text\) TO service_role/);
  assert.match(pushSubscriptionOwnershipMigration, /GRANT EXECUTE ON FUNCTION public\.register_onesignal_push_subscription/);
  assert.match(pushSubscriptionOwnershipMigration, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(pushSubscriptionOwnershipMigration, /CREATE POLICY "Users can insert own push subscriptions"/);
  assert.doesNotMatch(pushSubscriptionOwnershipMigration, /CREATE POLICY "Users can update own push subscriptions"/);
  assert.doesNotMatch(pushSubscriptionOwnershipMigration, /CREATE POLICY "Users can delete own push subscriptions"/);
  assert.match(pushSubscriptionRpcGrantMigration, /REVOKE EXECUTE ON FUNCTION public\.register_onesignal_push_subscription\(text, text, boolean\) FROM anon/);
  assert.match(pushSubscriptionRpcGrantMigration, /REVOKE EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text\) FROM anon/);
  assert.match(pushSubscriptionRpcGrantMigration, /GRANT EXECUTE ON FUNCTION public\.register_onesignal_push_subscription\(text, text, boolean\) TO authenticated/);
  assert.match(pushSubscriptionRpcGrantMigration, /GRANT EXECUTE ON FUNCTION public\.unregister_onesignal_push_subscription\(text, text\) TO authenticated/);
});

test("notification deep-link payloads remain URL-based and native-compatible", () => {
  assert.match(sendNotification, /data && typeof data\.url === ['"]string['"]/);
  assert.match(sendNotification, /data && typeof data\.deep_link === ['"]string['"]/);
  assert.match(sendNotification, /osData\.deep_link = deepLink/);
  assert.match(sendNotification, /url:\s*webPath !== ['"]\/["'] \? `\$\{APP_URL\}\$\{webPath\}` : APP_URL/);
  assert.match(nativeDeepLink, /additionalData\.url/);
  assert.match(nativeDeepLink, /additionalData\.deep_link/);
  assert.match(nativeDeepLink, /additionalData\.deepLink/);
  assert.match(nativeDeepLink, /launchURL/);
  assert.match(nativeDeepLink, /resolveNotificationHref/);
  assert.match(nativeDeepLink, /reconcileHrefWithRegistration/);
  assert.match(nativeDeepLink, /notification_tap_reconcile_failed/);
  assert.doesNotMatch(nativeDeepLink, /reconcile failed; using resolved path/);
  assert.match(nativeDeepLink, /shouldControlDisplay = hasDispatchGroup \|\| shouldSuppressSameThread/);
  assert.match(nativeDeepLink, /if \(!shouldControlDisplay\) return;\s*notification\.display\(\)/);
  assert.match(nativeDeepLink, /router\.push/);
});

test("push-webhook is secret-gated receipt telemetry, not assumed OneSignal delivery truth", () => {
  assert.match(pushWebhook, /PUSH_WEBHOOK_SECRET/);
  assert.match(pushWebhook, /push_notification_events/);
  assert.match(pushWebhook, /provider: "fcm" \| "apns" \| "web"/);
  assert.doesNotMatch(pushWebhook, /OneSignal|ONESIGNAL/i);
  assert.match(branchDelta, /not proven wired to OneSignal delivery receipts/);
  assert.match(branchDelta, /`notification_log` remains the app-layer send\/suppression log/);
});

test("Stream 11 does not add env vars, migrations, native modules, or provider semantics", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("onesignal_provider_operational_qa")),
    false,
    "Stream 11 should not add a Supabase migration",
  );
  assert.equal(
    existsSync(join(root, "supabase/validation/onesignal_provider_operational_qa.sql")),
    false,
    "Stream 11 should not add validation SQL because no migration is expected",
  );
  for (const marker of [
    "VITE_ONESIGNAL_APP_ID",
    "EXPO_PUBLIC_ONESIGNAL_APP_ID",
    "ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
    "PUSH_WEBHOOK_SECRET",
  ]) {
    assert.match(webOneSignal + nativeOneSignal + sendNotification + pushWebhook, new RegExp(marker));
  }
  assert.match(branchDelta, /Environment variables: none/);
  assert.match(branchDelta, /Native modules: none/);
  assert.match(branchDelta, /No real production push smoke was run/);
  assert.doesNotMatch(read("apps/mobile/package.json"), /expo-av/);
});

test("Streams 1-10 artifacts remain present", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API uses canonical ready_gate_transition actions/);
  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency/);
  assert.match(read("shared/matching/realtimeSubscriptionTightening.test.ts"), /broad event-level video_sessions/);
  assert.match(read("supabase/migrations/20260501220000_premium_credits_observability.sql"), /stripe_webhook_events/);
  assert.match(read("shared/matching/nativeVideoDateContractRecovery.test.ts"), /native date route exists/);
});
