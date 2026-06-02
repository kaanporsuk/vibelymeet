import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePushDeliveryHealth } from './pushDeliveryHealth';

const base = {
  platform: 'web' as const,
  permission: 'granted' as const,
  sdk: 'ready' as const,
  sdkSubscribed: true,
  localPlayerId: null,
  backendPlayerId: null,
  backendSubscribed: false,
  syncInFlight: false,
  lastSyncResultCode: 'no_player_id_after_retry' as const,
};

assert.equal(resolvePushDeliveryHealth(base).backendDeliverable, false);
assert.equal(resolvePushDeliveryHealth(base).status, 'needs_sync');

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    backendPlayerId: 'player-web',
    backendSubscribed: true,
    localPlayerId: 'player-web',
  }).status,
  'enabled',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    lastSyncResultCode: 'upsert_failed',
  }).status,
  'needs_sync',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    sdk: 'init_failed',
    backendPlayerId: 'player-web',
    backendSubscribed: true,
    localPlayerId: 'player-web',
  }).status,
  'needs_sync',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    platform: 'native',
    sdkSubscribed: null,
    backendPlayerId: 'player-native',
    backendSubscribed: true,
    lastSyncResultCode: 'no_player_id_after_retry',
  }).status,
  'needs_sync',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    permission: 'denied',
    backendPlayerId: 'player-web',
    backendSubscribed: true,
    localPlayerId: 'player-web',
    lastSyncResultCode: 'permission_denied',
  }).status,
  'blocked',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    sdk: 'app_id_missing',
    lastSyncResultCode: 'app_id_missing',
  }).status,
  'unsupported',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    backendPlayerId: 'player-web',
    backendSubscribed: true,
    localPlayerId: 'player-web',
    preferencesEnabled: false,
  }).status,
  'preferences_disabled',
);

assert.equal(
  resolvePushDeliveryHealth({
    ...base,
    backendPlayerId: 'player-web',
    backendSubscribed: true,
    localPlayerId: 'player-web',
    pausedUntil: new Date(Date.now() + 60_000).toISOString(),
  }).status,
  'paused',
);

const sendNotificationSource = readFileSync(
  join(process.cwd(), 'supabase/functions/send-notification/index.ts'),
  'utf8',
);
assert.match(sendNotificationSource, /suppressed_reason: suppressedReason \|\| null/);
assert.match(sendNotificationSource, /push_delivery_diagnostic/);
assert.match(sendNotificationSource, /web_player_id_present/);
assert.match(sendNotificationSource, /mobile_player_id_present/);
assert.match(sendNotificationSource, /notification_category/);
assert.match(sendNotificationSource, /platform_targeted/);
assert.match(sendNotificationSource, /subscription_table_target_count/);
assert.match(sendNotificationSource, /provider_request_attempted/);
assert.match(sendNotificationSource, /provider_status/);
assert.match(sendNotificationSource, /provider_notification_id/);
assert.match(sendNotificationSource, /provider_response_body_snippet/);
assert.match(sendNotificationSource, /provider_response_content_type/);
assert.match(sendNotificationSource, /provider_accepted_at/);
assert.match(sendNotificationSource, /redactedProviderResponseSnippet/);
assert.match(sendNotificationSource, /deeplink_route_class/);
assert.match(sendNotificationSource, /canonical_origin_valid/);
assert.match(sendNotificationSource, /master_push_disabled/);
assert.match(sendNotificationSource, /category_disabled/);
assert.match(sendNotificationSource, /quiet_hours/);
assert.match(sendNotificationSource, /match_muted/);
assert.match(sendNotificationSource, /provider_failure/);
assert.match(sendNotificationSource, /onesignal_exception/);
assert.match(sendNotificationSource, /onesignal_empty_notification_id/);
assert.match(sendNotificationSource, /onesignal_errors_array/);
assert.match(sendNotificationSource, /onesignal_errors_object/);
assert.match(sendNotificationSource, /canonical_www_url/);
assert.match(sendNotificationSource, /non_canonical_apex_url/);
assert.match(sendNotificationSource, /external_url/);
assert.match(sendNotificationSource, /const safePath = normalizePushDeepLinkPath\(value\)/);
assert.match(sendNotificationSource, /normalizePushDeepLinkPath\(`\$\{url\.pathname \|\| '\/'\}\$\{url\.search\}\$\{url\.hash\}`\)/);
assert.doesNotMatch(sendNotificationSource, /deeplink_route_class: routeClassForPath\(value\)/);
assert.doesNotMatch(sendNotificationSource, /deeplink_route_class: routeClassForPath\(url\.pathname\)/);
assert.doesNotMatch(sendNotificationSource, /provider_raw_payload/);

const webOneSignalSource = readFileSync(join(process.cwd(), 'src/lib/onesignal.ts'), 'utf8');
assert.match(webOneSignalSource, /identityGeneration/);
assert.match(webOneSignalSource, /isCurrentOneSignalIdentity\(userId, generation\)/);
assert.match(webOneSignalSource, /push_notification_tap/);
assert.match(webOneSignalSource, /push_notification_deeplink_result/);

const nativeOneSignalSource = readFileSync(join(process.cwd(), 'apps/mobile/lib/onesignal.ts'), 'utf8');
assert.match(nativeOneSignalSource, /identityGeneration/);
assert.match(nativeOneSignalSource, /stale_identity/);
assert.match(nativeOneSignalSource, /EXPO_PUBLIC_ONESIGNAL_APP_ID \?\? ''/);
assert.doesNotMatch(nativeOneSignalSource, /97e52ea2-6a27-4486-a678-4dd8a0d49e94/);
assert.match(nativeOneSignalSource, /initAttemptedAppId/);
assert.match(nativeOneSignalSource, /runtimeState\.initAttemptedAppId === APP_ID/);
assert.match(nativeOneSignalSource, /if \(!ensureOneSignalInitialized\(\)\) return syncResult\('init_failed'\);/);
assert.doesNotMatch(nativeOneSignalSource, /ONESIGNAL_REST_API_KEY/);

const webPushTelemetrySource = readFileSync(join(process.cwd(), 'src/lib/pushDeliveryTelemetry.ts'), 'utf8');
assert.match(webPushTelemetrySource, /push_permission_prompt_result/);
assert.match(webPushTelemetrySource, /push_registration_sync_result/);
assert.match(webPushTelemetrySource, /push_delivery_health_observed/);
assert.match(webPushTelemetrySource, /ALLOWED_PUSH_TELEMETRY_PROPS/);
assert.doesNotMatch(webPushTelemetrySource, /playerId/);
assert.doesNotMatch(webPushTelemetrySource, /authorization/i);

const nativePushTelemetrySource = readFileSync(join(process.cwd(), 'apps/mobile/lib/pushDeliveryTelemetry.ts'), 'utf8');
assert.match(nativePushTelemetrySource, /push_permission_prompt_result/);
assert.match(nativePushTelemetrySource, /push_registration_sync_result/);
assert.match(nativePushTelemetrySource, /push_delivery_health_observed/);
assert.match(nativePushTelemetrySource, /ALLOWED_PUSH_TELEMETRY_PROPS/);
assert.doesNotMatch(nativePushTelemetrySource, /playerId/);
assert.doesNotMatch(nativePushTelemetrySource, /authorization/i);

console.log('pushDeliveryHealth tests passed');
