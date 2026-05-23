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
const nativeNotificationPause = read("apps/mobile/lib/notificationPause.ts");
const nativePushMasterSwitch = read("apps/mobile/lib/pushMasterSwitch.ts");
const nativeDeepLink = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const nativeAppConfig = read("apps/mobile/app.config.js");
const pushSubscriptionOwnershipMigration = read("supabase/migrations/20260523184500_onesignal_push_subscription_ownership.sql");
const pushSubscriptionRpcGrantMigration = read("supabase/migrations/20260523193000_restrict_onesignal_push_subscription_rpc_grants.sql");
const branchDelta = read("docs/branch-deltas/fix-onesignal-provider-operational-qa.md");

test("web OneSignal initialization is env-backed and root-worker aware", () => {
  assert.match(read("index.html"), /OneSignalSDK\.page\.js/);
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
  assert.match(appBootstrap, /const userId = session\?\.user\?\.id \?\? null/);
  assert.match(appBootstrap, /setExternalUserId\(userId\)/);
  assert.match(appBootstrap, /syncWebPushRegistrationToBackend\(userId\)/);
  assert.match(webOneSignal, /lastLoggedInUserId/);
  assert.match(webOneSignal, /if \(lastLoggedInUserId === userId\) return generation/);
  assert.match(webOneSignal, /OneSignal\.login\(userId\)/);
  assert.match(webOneSignal, /OneSignal\.logout\(\)/);
});

test("web player-id and subscription sync writes notification_preferences safely", () => {
  assert.match(webPushSync, /getPlayerId\(/);
  assert.match(webPushSync, /WEB_PLAYER_ID_LOGOUT_LOOKUP/);
  assert.match(webPushSync, /const playerId = await getPlayerId\(WEB_PLAYER_ID_LOGOUT_LOOKUP\)/);
  assert.match(webPushSync, /p_subscription_id:\s*playerId/);
  assert.match(webPushSync, /isSubscribed\(\)/);
  assert.match(webPushSync, /register_onesignal_push_subscription/);
  assert.match(webPushSync, /unregister_onesignal_push_subscription/);
  assert.match(webPushSync, /\.from\(["']notification_preferences["']\)\.upsert/);
  assert.match(webPushSync, /onesignal_player_id:\s*playerId/);
  assert.match(webPushSync, /onesignal_subscribed:\s*subscribed/);
  assert.match(webPushSync, /push_enabled:\s*true/);
  assert.match(webPushHealth, /\.select\(["']onesignal_player_id, onesignal_subscribed, push_enabled, paused_until["']\)/);
  assert.match(webPushHealth, /vibely-onesignal-subscription-changed/);
  assert.match(pushPermissionPrompt, /requestWebPushPermissionAndSync\(user\.id\)/);
  assert.match(notificationsDrawer, /requestWebPushPermissionAndSync\(user\.id\)/);
});

test("native OneSignal identity and subscription sync mirror the backend contract", () => {
  assert.match(nativeOneSignal, /EXPO_PUBLIC_ONESIGNAL_APP_ID/);
  assert.match(nativeOneSignal, /react-native-onesignal/);
  assert.match(nativeOneSignal, /lastLoggedInUserId/);
  assert.match(nativeOneSignal, /if \(lastLoggedInUserId === userId\) return generation/);
  assert.match(nativeOneSignal, /OneSignal\.login\(userId\)/);
  assert.match(nativeOneSignal, /OneSignal\.logout\(\)/);
  assert.match(nativeOneSignal, /ensureOneSignalInitialized\(\)/);
  assert.match(nativeOneSignal, /register_onesignal_push_subscription/);
  assert.match(nativeOneSignal, /unregister_onesignal_push_subscription/);
  assert.match(nativeOneSignal, /OneSignal\.User\.pushSubscription\.optOut\(\)/);
  assert.match(nativeOneSignal, /mobile_onesignal_player_id:\s*subscriptionId/);
  assert.match(nativeOneSignal, /mobile_onesignal_subscribed:\s*subscribed/);
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
  assert.match(nativePushRegistration, /bindOneSignalExternalUser\(user\.id\)/);
  assert.match(nativePushRegistration, /syncNativePushDeliveryOnForeground\(user\.id/);
  assert.match(nativeAppConfig, /onesignal-expo-plugin/);
  assert.match(nativeAppConfig, /mode:\s*oneSignalMode/);
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
  assert.match(sendNotification, /prefs\.onesignal_subscribed/);
  assert.match(sendNotification, /prefs\.onesignal_player_id/);
  assert.match(sendNotification, /prefs\.mobile_onesignal_subscribed/);
  assert.match(sendNotification, /prefs\.mobile_onesignal_player_id/);
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
