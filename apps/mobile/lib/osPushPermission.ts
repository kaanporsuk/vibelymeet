/**
 * Canonical OS-level push permission (OneSignal native permission APIs).
 * This module must not register notification handlers/listeners; OneSignal owns delivery and click handling.
 */
import { OneSignal, OSNotificationPermission } from 'react-native-onesignal';

export type OsPushPermissionState = 'undetermined' | 'granted' | 'denied';

export type OsPushRequestResult = {
  granted: boolean;
  /** System already denied push — never call requestPermissionsAsync again; use open settings / recovery. */
  osDenied: boolean;
};

const UNDETERMINED_STABILITY_CONFIRM_MS = 320;

let osPermissionRequestInFlight: Promise<OsPushRequestResult> | null = null;

export function pushPermDevLog(message: string, extra?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (extra) {
    console.log(`[Vibely][push][os] ${message}`, extra);
  } else {
    console.log(`[Vibely][push][os] ${message}`);
  }
}

function mapOneSignalPermissionState(
  nativePermission: OSNotificationPermission,
  canRequestPermission: boolean,
): OsPushPermissionState {
  if (
    nativePermission === OSNotificationPermission.Authorized ||
    nativePermission === OSNotificationPermission.Provisional ||
    nativePermission === OSNotificationPermission.Ephemeral
  ) {
    return 'granted';
  }
  if (canRequestPermission) return 'undetermined';
  return 'denied';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOsPushPermissionState(): Promise<OsPushPermissionState> {
  try {
    const [nativePermission, canRequestPermission] = await Promise.all([
      OneSignal.Notifications.permissionNative(),
      OneSignal.Notifications.canRequestPermission(),
    ]);
    return mapOneSignalPermissionState(nativePermission, canRequestPermission);
  } catch (e) {
    pushPermDevLog('getOsPushPermissionState:transient_read_failed', {
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Treat an initial `undetermined` read as provisional. On native startup / focus,
 * permission state can briefly report as requestable before reconciling to the real
 * OS state; auto prompts must wait for the confirmation read.
 */
export async function getStableOsPushPermissionState(context: string): Promise<OsPushPermissionState> {
  const first = await getOsPushPermissionState();
  pushPermDevLog('permission_state_read', { context, first, stable: first !== 'undetermined' });
  if (first !== 'undetermined') return first;

  await sleep(UNDETERMINED_STABILITY_CONFIRM_MS);
  const second = await getOsPushPermissionState();
  pushPermDevLog('permission_state_confirmed', {
    context,
    first,
    second,
    transient: second !== first,
  });
  return second;
}

/**
 * Single OS permission request path: OneSignal native permission prompt only.
 * Does not sync the backend — call sync helpers after grant if needed.
 */
export async function requestOsPushPermission(): Promise<OsPushRequestResult> {
  if (osPermissionRequestInFlight) {
    pushPermDevLog('os_permission_request_joined_in_flight');
    return osPermissionRequestInFlight;
  }

  const requestPromise = (async () => {
    let before: OsPushPermissionState;
    try {
      before = await getStableOsPushPermissionState('request_os_permission_before');
    } catch (e) {
      pushPermDevLog('os_permission_request_suppressed', {
        reason: 'permission_state_unreadable',
        message: e instanceof Error ? e.message : String(e),
      });
      return { granted: false, osDenied: false };
    }

    pushPermDevLog('requestOsPushPermission:before', { before });
    if (before === 'denied') {
      pushPermDevLog('os_permission_request_suppressed', { reason: 'already_denied' });
      return { granted: false, osDenied: true };
    }
    if (before === 'granted') {
      pushPermDevLog('os_permission_request_suppressed', { reason: 'already_granted' });
      return { granted: true, osDenied: false };
    }

    pushPermDevLog('os_permission_request_started');
    try {
      const granted = await OneSignal.Notifications.requestPermission(false);
      const after = await getOsPushPermissionState();
      pushPermDevLog('os_permission_request_completed', { granted, after });
      return {
        granted: granted === true || after === 'granted',
        osDenied: after === 'denied',
      };
    } catch (e) {
      pushPermDevLog('os_permission_request_completed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return { granted: false, osDenied: false };
    }
  })().finally(() => {
    osPermissionRequestInFlight = null;
  });

  osPermissionRequestInFlight = requestPromise;
  return requestPromise;
}
