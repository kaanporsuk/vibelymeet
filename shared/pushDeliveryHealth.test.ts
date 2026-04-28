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

const sendNotificationSource = readFileSync(
  join(process.cwd(), 'supabase/functions/send-notification/index.ts'),
  'utf8',
);
assert.match(sendNotificationSource, /suppressed_reason: suppressedReason \|\| null/);
assert.match(sendNotificationSource, /push_delivery_diagnostic/);
assert.match(sendNotificationSource, /web_player_id_present/);
assert.match(sendNotificationSource, /mobile_player_id_present/);

const webOneSignalSource = readFileSync(join(process.cwd(), 'src/lib/onesignal.ts'), 'utf8');
assert.match(webOneSignalSource, /identityGeneration/);
assert.match(webOneSignalSource, /isCurrentOneSignalIdentity\(userId, generation\)/);

const nativeOneSignalSource = readFileSync(join(process.cwd(), 'apps/mobile/lib/onesignal.ts'), 'utf8');
assert.match(nativeOneSignalSource, /identityGeneration/);
assert.match(nativeOneSignalSource, /stale_identity/);

console.log('pushDeliveryHealth tests passed');
