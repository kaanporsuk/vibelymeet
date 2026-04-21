/**
 * After in-app prompt: expo OS state + single requestOsPushPermission path (no OneSignal.requestPermission).
 * Backend sync is separate from requesting OS permission.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { disablePush, syncPushSubscriptionToBackend } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';
import {
  getStableOsPushPermissionState,
  pushPermDevLog,
  requestOsPushPermission,
  type OsPushPermissionState,
} from '@/lib/osPushPermission';

export const VIBELY_PUSH_PERMISSION_ASKED_KEY = 'vibely_push_permission_asked';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

export type PushPromptOsStatus = OsPushPermissionState | 'unknown';

export type DashboardPushPrepromptContext = {
  permissionStateHydrated: boolean;
  osStatus: PushPromptOsStatus;
  promptVisible?: boolean;
  osPermissionRequestInFlight?: boolean;
};

export type DashboardPushPrepromptDecision =
  | { offer: true }
  | { offer: false; reason: string };

const pushPromptSessionState = {
  prepromptScheduledThisSession: false,
  prepromptVisible: false,
  osPermissionRequestInFlight: false,
};

function logPrepromptSuppressed(reason: string, extra?: Record<string, unknown>): void {
  pushPermDevLog('preprompt_suppressed', { reason, ...extra });
}

export function setDashboardPushPrepromptVisible(visible: boolean): void {
  if (pushPromptSessionState.prepromptVisible === visible) return;
  pushPromptSessionState.prepromptVisible = visible;
  pushPermDevLog('preprompt_visible_state_changed', { visible });
}

export function setDashboardPushOsPermissionRequestInFlight(inFlight: boolean): void {
  if (pushPromptSessionState.osPermissionRequestInFlight === inFlight) return;
  pushPromptSessionState.osPermissionRequestInFlight = inFlight;
  pushPermDevLog('preprompt_os_request_state_changed', { inFlight });
}

/**
 * Dashboard preprompt: only when user has never completed this wizard (no AsyncStorage value)
 * and OS permission is still undetermined. Denied/granted users must never get the auto modal.
 */
export async function shouldOfferDashboardPushPreprompt(
  context: DashboardPushPrepromptContext,
): Promise<boolean> {
  try {
    if (!context.permissionStateHydrated) {
      logPrepromptSuppressed('permission_state_not_hydrated', {
        osStatus: context.osStatus,
      });
      return false;
    }
    if (context.osStatus !== 'undetermined') {
      logPrepromptSuppressed('hydrated_os_state_not_promptable', {
        osStatus: context.osStatus,
      });
      return false;
    }
    if (pushPromptSessionState.prepromptScheduledThisSession) {
      logPrepromptSuppressed('preprompt_scheduled_this_session');
      return false;
    }
    if (pushPromptSessionState.prepromptVisible || context.promptVisible) {
      logPrepromptSuppressed('preprompt_already_visible');
      return false;
    }
    if (pushPromptSessionState.osPermissionRequestInFlight || context.osPermissionRequestInFlight) {
      logPrepromptSuppressed('os_permission_request_in_flight');
      return false;
    }

    const v = await AsyncStorage.getItem(VIBELY_PUSH_PERMISSION_ASKED_KEY);
    if (v != null && v !== '') {
      logPrepromptSuppressed('preprompt_already_answered_or_skipped', { storedValue: v });
      return false;
    }

    const liveOsStatus = await getStableOsPushPermissionState('dashboard_preprompt_offer');
    if (liveOsStatus !== 'undetermined') {
      logPrepromptSuppressed('live_os_state_not_promptable', { liveOsStatus });
      return false;
    }

    pushPromptSessionState.prepromptScheduledThisSession = true;
    pushPermDevLog('preprompt_scheduled', {
      osStatus: context.osStatus,
      liveOsStatus,
      permissionStateHydrated: context.permissionStateHydrated,
    });
    return true;
  } catch (e) {
    logPrepromptSuppressed('permission_state_read_failed', {
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function shouldShowDashboardPushPreprompt(
  context: DashboardPushPrepromptContext,
): Promise<DashboardPushPrepromptDecision> {
  try {
    if (!pushPromptSessionState.prepromptScheduledThisSession) {
      return { offer: false, reason: 'preprompt_not_scheduled' };
    }
    if (!context.permissionStateHydrated) {
      return { offer: false, reason: 'permission_state_not_hydrated' };
    }
    if (context.osStatus !== 'undetermined') {
      return { offer: false, reason: 'hydrated_os_state_not_promptable' };
    }
    if (pushPromptSessionState.prepromptVisible || context.promptVisible) {
      return { offer: false, reason: 'preprompt_already_visible' };
    }
    if (pushPromptSessionState.osPermissionRequestInFlight || context.osPermissionRequestInFlight) {
      return { offer: false, reason: 'os_permission_request_in_flight' };
    }

    const liveOsStatus = await getStableOsPushPermissionState('dashboard_preprompt_show');
    if (liveOsStatus !== 'undetermined') {
      return { offer: false, reason: `live_os_state_${liveOsStatus}` };
    }

    pushPromptSessionState.prepromptVisible = true;
    pushPermDevLog('preprompt_shown', {
      osStatus: context.osStatus,
      liveOsStatus,
      permissionStateHydrated: context.permissionStateHydrated,
    });
    return { offer: true };
  } catch (e) {
    return {
      offer: false,
      reason: e instanceof Error ? `permission_state_read_failed:${e.message}` : 'permission_state_read_failed',
    };
  }
}

export function logDashboardPushPrepromptSuppressed(reason: string, extra?: Record<string, unknown>): void {
  logPrepromptSuppressed(reason, extra);
}

export function isDashboardPushOsPermissionRequestInFlight(): boolean {
  return pushPromptSessionState.osPermissionRequestInFlight;
}

async function getPromptableOsState(context: string): Promise<OsPushPermissionState | null> {
  try {
    return await getStableOsPushPermissionState(context);
  } catch (e) {
    pushPermDevLog('prompt_suppressed', {
      reason: 'permission_state_read_failed',
      context,
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export type PushPromptResult =
  | { outcome: 'granted' }
  | { outcome: 'already_denied' }
  | { outcome: 'denied_after_sheet' }
  | { outcome: 'no_app_id' };

/** Shared success path after OS permission is granted (prefs + OneSignal subscription; no prompts). */
export async function syncBackendAfterPushGrant(userId: string): Promise<void> {
  if (__DEV__) pushPermDevLog('syncBackendAfterPushGrant', { userId });
  const stored = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  const isPaused = !!(stored && new Date(stored) > new Date());
  if (!isPaused) {
    disablePush(false);
  }
  await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: true },
    { onConflict: 'user_id' }
  );
  await syncPushSubscriptionToBackend(userId);
}

export async function requestPushPermissionsAfterPrompt(userId: string): Promise<PushPromptResult> {
  await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
  if (!APP_ID) {
    return { outcome: 'no_app_id' };
  }

  const os = await getPromptableOsState('request_push_permissions_after_prompt_before');
  if (!os) {
    return { outcome: 'denied_after_sheet' };
  }
  if (os === 'denied') {
    await supabase.from('notification_preferences').upsert(
      { user_id: userId, push_enabled: false },
      { onConflict: 'user_id' }
    );
    return { outcome: 'already_denied' };
  }
  if (os === 'granted') {
    await syncBackendAfterPushGrant(userId);
    return { outcome: 'granted' };
  }

  setDashboardPushOsPermissionRequestInFlight(true);
  try {
    const { granted } = await requestOsPushPermission();
    if (granted) {
      await syncBackendAfterPushGrant(userId);
      return { outcome: 'granted' };
    }
  } finally {
    setDashboardPushOsPermissionRequestInFlight(false);
  }
  await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: false },
    { onConflict: 'user_id' }
  );
  return { outcome: 'denied_after_sheet' };
}
