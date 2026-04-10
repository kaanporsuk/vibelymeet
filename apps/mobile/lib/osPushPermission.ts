/**
 * Canonical OS-level push permission (expo-notifications).
 * OneSignal getPermissionAsync conflates undetermined and denied when both are false.
 */
import * as Notifications from 'expo-notifications';
import { PermissionStatus } from 'expo-modules-core';

export type OsPushPermissionState = 'undetermined' | 'granted' | 'denied';

export async function getOsPushPermissionState(): Promise<OsPushPermissionState> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === PermissionStatus.GRANTED) return 'granted';
    if (status === PermissionStatus.DENIED) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}
