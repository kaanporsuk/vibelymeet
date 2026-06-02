export type PushPlatform = 'web' | 'native';

export type PushPermissionHealth =
  | 'granted'
  | 'denied'
  | 'default'
  | 'undetermined'
  | 'unsupported'
  | 'unknown';

export type PushSdkHealth =
  | 'ready'
  | 'pending'
  | 'init_failed'
  | 'unsupported_host'
  | 'app_id_missing'
  | 'unknown';

export type PushDeliveryStatus =
  | 'enabled'
  | 'allowed_finishing_setup'
  | 'needs_sync'
  | 'blocked'
  | 'unsupported'
  | 'preferences_disabled'
  | 'paused'
  | 'disabled';

export type PushSyncResultCode =
  | 'synced'
  | 'permission_denied'
  | 'unsupported_browser'
  | 'prompt_unavailable'
  | 'sdk_not_ready'
  | 'init_failed'
  | 'no_player_id_after_retry'
  | 'upsert_failed'
  | 'app_id_missing'
  | 'stale_identity';

export type PushSyncResult = {
  code: PushSyncResultCode;
  synced: boolean;
  playerId: string | null;
  message?: string;
};

export type PushDeliveryHealthInput = {
  platform: PushPlatform;
  permission: PushPermissionHealth;
  sdk: PushSdkHealth;
  sdkSubscribed: boolean | null;
  localPlayerId: string | null;
  backendPlayerId: string | null;
  backendSubscribed: boolean | null;
  preferencesEnabled?: boolean | null;
  pausedUntil?: string | null;
  syncInFlight?: boolean;
  lastSyncResultCode?: PushSyncResultCode | null;
};

export type PushDeliveryHealth = PushDeliveryHealthInput & {
  backendDeliverable: boolean;
  status: PushDeliveryStatus;
  label: string;
  description: string;
  canRetrySync: boolean;
};

export function isPushBackendDeliverable(
  backendPlayerId: string | null | undefined,
  backendSubscribed: boolean | null | undefined,
  preferencesEnabled: boolean | null | undefined = true,
  pausedUntil: string | null | undefined = null,
): boolean {
  const paused = Boolean(pausedUntil && new Date(pausedUntil).getTime() > Date.now());
  return Boolean(backendPlayerId && backendSubscribed === true && preferencesEnabled !== false && !paused);
}

export function resolvePushDeliveryHealth(input: PushDeliveryHealthInput): PushDeliveryHealth {
  const backendDeliverable = isPushBackendDeliverable(
    input.backendPlayerId,
    input.backendSubscribed,
    input.preferencesEnabled,
    input.pausedUntil,
  );

  if (
    input.permission === 'unsupported' ||
    input.sdk === 'unsupported_host' ||
    input.sdk === 'app_id_missing'
  ) {
    return {
      ...input,
      backendDeliverable,
      status: 'unsupported',
      label: 'Unsupported',
      description: 'Push is not available in this app environment.',
      canRetrySync: false,
    };
  }

  if (input.permission === 'denied') {
    return {
      ...input,
      backendDeliverable,
      status: 'blocked',
      label: 'Blocked',
      description: 'Notifications are blocked in system or browser settings.',
      canRetrySync: false,
    };
  }

  if (input.preferencesEnabled === false) {
    return {
      ...input,
      backendDeliverable,
      status: 'preferences_disabled',
      label: 'Paused in settings',
      description: 'Push delivery is turned off in notification settings.',
      canRetrySync: false,
    };
  }

  if (input.pausedUntil && new Date(input.pausedUntil).getTime() > Date.now()) {
    return {
      ...input,
      backendDeliverable,
      status: 'paused',
      label: 'Paused',
      description: 'Push delivery is temporarily paused.',
      canRetrySync: false,
    };
  }

  const currentDeviceDeliverable =
    backendDeliverable &&
    input.permission === 'granted' &&
    input.sdk === 'ready' &&
    input.sdkSubscribed === true &&
    Boolean(input.localPlayerId) &&
    input.localPlayerId === input.backendPlayerId;

  if (currentDeviceDeliverable) {
    return {
      ...input,
      backendDeliverable,
      status: 'enabled',
      label: 'Enabled',
      description: 'This device is registered for backend push delivery.',
      canRetrySync: false,
    };
  }

  if (input.permission === 'granted') {
    if (
      input.syncInFlight ||
      input.sdk === 'pending' ||
      input.lastSyncResultCode === null ||
      input.lastSyncResultCode === undefined
    ) {
      return {
        ...input,
        backendDeliverable,
        status: 'allowed_finishing_setup',
        label: 'Allowed, finishing setup',
        description: 'Permission is allowed while Vibely finishes registering this device.',
        canRetrySync: true,
      };
    }

    return {
      ...input,
      backendDeliverable,
      status: 'needs_sync',
      label: 'Needs sync',
      description: 'Permission is allowed, but this device is not registered for backend push delivery yet.',
      canRetrySync: true,
    };
  }

  return {
    ...input,
    backendDeliverable,
    status: 'disabled',
    label: 'Disabled',
    description: 'Turn on notifications to receive push alerts.',
    canRetrySync: input.permission === 'unknown',
  };
}
