/**
 * After in-app prompt: OneSignal-safe native OS permission request + backend sync.
 * Backend sync is separate from requesting OS permission.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import {
  disablePush,
  getNativeOneSignalClientSnapshot,
  initOneSignal,
  requestOneSignalPushPermission,
  syncPushSubscriptionToBackend,
} from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';
import { recordPushDeliveryTelemetry } from '@/lib/pushDeliveryTelemetry';
import {
  getStableOsPushPermissionState,
  pushPermDevLog,
  type OsPushPermissionState,
} from '@/lib/osPushPermission';
import type { PushSyncResult } from '@clientShared/pushDeliveryHealth';

export const VIBELY_PUSH_PERMISSION_ASKED_KEY = 'vibely_push_permission_asked';
export const VIBELY_PUSH_PERMISSION_ASKED_KEY_PREFIX = 'vibely_push_permission_asked:';
export const VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX = 'in_flight:';
const PUSH_PERMISSION_IN_FLIGHT_TTL_MS = 10 * 60 * 1000;

const APP_ID = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '').trim();

function nativePushPermissionAskedKey(userId?: string | null): string {
  const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
  return cleanUserId ? `${VIBELY_PUSH_PERMISSION_ASKED_KEY_PREFIX}${cleanUserId}` : VIBELY_PUSH_PERMISSION_ASKED_KEY;
}

async function writePushPermissionMarker(key: string, value: string, context: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    pushPermDevLog('push_permission_marker_write_failed', {
      context,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function removePushPermissionMarker(key: string, context: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    pushPermDevLog('push_permission_marker_remove_failed', {
      context,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function markNativePushPermissionAsked(value: 'true' | 'skipped' = 'true', userId?: string | null): Promise<void> {
  await writePushPermissionMarker(nativePushPermissionAskedKey(userId), value, 'mark_asked');
}

export async function markNativePushPermissionRequestInFlight(userId?: string | null): Promise<void> {
  await writePushPermissionMarker(
    nativePushPermissionAskedKey(userId),
    `${VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX}${Date.now()}`,
    'mark_in_flight',
  );
}

export async function clearNativePushPermissionAskedMarker(userId?: string | null): Promise<void> {
  await removePushPermissionMarker(nativePushPermissionAskedKey(userId), 'clear_marker');
}

function parsePushPermissionInFlightStartedAt(value: string): number | null {
  if (!value.startsWith(VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX)) return null;
  const timestamp = Number(value.slice(VIBELY_PUSH_PERMISSION_IN_FLIGHT_PREFIX.length));
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export type PushPromptOsStatus = OsPushPermissionState | 'unknown';

export type DashboardPushPrepromptContext = {
  userId?: string | null;
  permissionStateHydrated: boolean;
  osStatus: PushPromptOsStatus;
  promptVisible?: boolean;
  osPermissionRequestInFlight?: boolean;
};

export type DashboardPushPrepromptDecision =
  | { offer: true }
  | { offer: false; reason: string };

const pushPromptSessionState = {
  activeUserId: null as string | null,
  prepromptScheduledThisSession: false,
  prepromptVisible: false,
  osPermissionRequestInFlight: false,
};

function normalizePromptUserId(userId?: string | null): string | null {
  const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
  return cleanUserId || null;
}

function syncPushPromptSessionUser(userId?: string | null): void {
  const nextUserId = normalizePromptUserId(userId);
  if (pushPromptSessionState.activeUserId === nextUserId) return;
  pushPromptSessionState.activeUserId = nextUserId;
  pushPromptSessionState.prepromptScheduledThisSession = false;
  pushPromptSessionState.prepromptVisible = false;
}

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
    syncPushPromptSessionUser(context.userId);

    if (!context.permissionStateHydrated) {
      logPrepromptSuppressed('permission_state_not_hydrated', {
        osStatus: context.osStatus,
      });
      return false;
    }
    if (!APP_ID) {
      logPrepromptSuppressed('app_id_missing');
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

    const promptMarkerKey = nativePushPermissionAskedKey(context.userId);
    const v = await AsyncStorage.getItem(promptMarkerKey);
    const inFlightStartedAt = v ? parsePushPermissionInFlightStartedAt(v) : null;
    if (inFlightStartedAt != null && Date.now() - inFlightStartedAt >= PUSH_PERMISSION_IN_FLIGHT_TTL_MS) {
      await removePushPermissionMarker(promptMarkerKey, 'recover_stale_in_flight_marker');
      logPrepromptSuppressed('stale_in_flight_marker_recovered', { storedValue: v });
    } else if (v != null && v !== '') {
      logPrepromptSuppressed('preprompt_already_answered_or_skipped', { storedValue: v });
      return false;
    }

    initOneSignal();
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
    syncPushPromptSessionUser(context.userId);

    if (!pushPromptSessionState.prepromptScheduledThisSession) {
      return { offer: false, reason: 'preprompt_not_scheduled' };
    }
    if (!APP_ID) {
      return { offer: false, reason: 'app_id_missing' };
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

    initOneSignal();
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
  | { outcome: 'granted'; sync: PushSyncResult }
  | { outcome: 'already_denied' }
  | { outcome: 'denied_after_sheet' }
  | { outcome: 'request_failed' }
  | { outcome: 'no_app_id' }
  | { outcome: 'stale_identity' };

function recordNativePushPromptResult(
  outcome: PushPromptResult['outcome'] | 'already_granted',
  permissionState: PushPromptOsStatus,
): void {
  recordPushDeliveryTelemetry('push_permission_prompt_result', {
    platform: 'native',
    surface: 'permission_request',
    permission_state: permissionState,
    sdk_status: getNativeOneSignalClientSnapshot().sdkStatus,
    sync_result_code: outcome,
  });
}

function recordNativePushSyncResult(result: PushSyncResult, surface: string, permissionState?: PushPromptOsStatus): void {
  recordPushDeliveryTelemetry('push_registration_sync_result', {
    platform: 'native',
    surface,
    permission_state: permissionState ?? 'unknown',
    sdk_status: getNativeOneSignalClientSnapshot().sdkStatus,
    sync_result_code: result.code,
    local_player_present: Boolean(result.playerId),
    backend_player_present: result.synced,
    backend_subscribed: result.synced,
  });
}

async function isActiveAuthUserForPush(userId: string, context: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  const currentUserId = data.session?.user?.id ?? null;
  const isActive = !error && currentUserId === userId;
  if (!isActive) {
    pushPermDevLog('prompt_suppressed', {
      reason: 'stale_identity',
      context,
      hasCurrentUser: Boolean(currentUserId),
      authReadFailed: Boolean(error),
    });
  }
  return isActive;
}

async function stalePromptIdentityResult(userId: string, context: string): Promise<PushPromptResult> {
  await clearNativePushPermissionAskedMarker(userId);
  pushPermDevLog('prompt_suppressed', { reason: 'stale_identity', context });
  recordNativePushPromptResult('stale_identity', 'unknown');
  return { outcome: 'stale_identity' };
}

/** Shared success path after OS permission is granted (prefs + OneSignal subscription; no prompts). */
export async function syncBackendAfterPushGrant(userId: string): Promise<PushSyncResult> {
  if (__DEV__) pushPermDevLog('syncBackendAfterPushGrant', { userId });
  if (!APP_ID) {
    const result = { code: 'app_id_missing', synced: false, playerId: null } satisfies PushSyncResult;
    recordNativePushSyncResult(result, 'permission_grant_sync');
    return result;
  }
  if (!(await isActiveAuthUserForPush(userId, 'permission_grant_sync'))) {
    const result = { code: 'stale_identity', synced: false, playerId: null } satisfies PushSyncResult;
    recordNativePushSyncResult(result, 'permission_grant_sync');
    return result;
  }
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  } catch (e) {
    pushPermDevLog('local_pause_state_read_failed', {
      context: 'permission_grant_sync',
      message: e instanceof Error ? e.message : String(e),
    });
  }
  const isPaused = !!(stored && new Date(stored) > new Date());
  if (!isPaused) {
    disablePush(false);
  }
  const result = await syncPushSubscriptionToBackend(userId);
  if (!result.synced) {
    if (!isPaused) {
      disablePush(true);
    }
    recordNativePushSyncResult(result, 'permission_grant_sync');
    return result;
  }
  if (!(await isActiveAuthUserForPush(userId, 'permission_grant_sync_before_preferences'))) {
    const result = { code: 'stale_identity', synced: false, playerId: null } satisfies PushSyncResult;
    recordNativePushSyncResult(result, 'permission_grant_sync');
    return result;
  }

  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: true },
    { onConflict: 'user_id' }
  );
  if (error) {
    if (!isPaused) {
      disablePush(true);
    }
    const result = { code: 'upsert_failed', synced: false, playerId: null, message: error.message } satisfies PushSyncResult;
    recordNativePushSyncResult(result, 'permission_grant_sync');
    return result;
  }
  recordNativePushSyncResult(result, 'permission_grant_sync');
  return result;
}

export async function requestPushPermissionsAfterPrompt(userId: string): Promise<PushPromptResult> {
  if (!APP_ID) {
    recordNativePushPromptResult('no_app_id', 'unknown');
    return { outcome: 'no_app_id' };
  }
  if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_start'))) {
    return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_start');
  }

  await markNativePushPermissionRequestInFlight(userId);
  initOneSignal();
  const os = await getPromptableOsState('request_push_permissions_after_prompt_before');
  if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_before'))) {
    return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_before');
  }
  if (!os) {
    await clearNativePushPermissionAskedMarker(userId);
    recordNativePushPromptResult('request_failed', 'unknown');
    return { outcome: 'request_failed' };
  }
  if (os === 'denied') {
    if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_denied'))) {
      return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_denied');
    }
    await markNativePushPermissionAsked('true', userId);
    await supabase.from('notification_preferences').upsert(
      { user_id: userId, push_enabled: false },
      { onConflict: 'user_id' }
    );
    recordNativePushPromptResult('already_denied', os);
    return { outcome: 'already_denied' };
  }
  if (os === 'granted') {
    if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_granted'))) {
      return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_granted');
    }
    await markNativePushPermissionAsked('true', userId);
    recordNativePushPromptResult('already_granted', os);
    const sync = await syncBackendAfterPushGrant(userId);
    if (sync.code === 'stale_identity') {
      return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_granted_sync');
    }
    return { outcome: 'granted', sync };
  }

  setDashboardPushOsPermissionRequestInFlight(true);
  try {
    const { granted } = await requestOneSignalPushPermission();
    if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_after_sheet'))) {
      return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_after_sheet');
    }
    if (granted) {
      await markNativePushPermissionAsked('true', userId);
      recordNativePushPromptResult('granted', 'granted');
      const sync = await syncBackendAfterPushGrant(userId);
      if (sync.code === 'stale_identity') {
        return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_after_sheet_sync');
      }
      return { outcome: 'granted', sync };
    }
  } catch {
    await clearNativePushPermissionAskedMarker(userId);
    recordNativePushPromptResult('request_failed', 'unknown');
    return { outcome: 'request_failed' };
  } finally {
    setDashboardPushOsPermissionRequestInFlight(false);
  }
  const after = await getPromptableOsState('request_push_permissions_after_prompt_after');
  if (!(await isActiveAuthUserForPush(userId, 'request_push_permissions_after_prompt_after_state'))) {
    return stalePromptIdentityResult(userId, 'request_push_permissions_after_prompt_after_state');
  }
  if (after !== 'denied') {
    await clearNativePushPermissionAskedMarker(userId);
    recordNativePushPromptResult('request_failed', after ?? 'unknown');
    return { outcome: 'request_failed' };
  }
  await markNativePushPermissionAsked('true', userId);
  await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: false },
    { onConflict: 'user_id' }
  );
  recordNativePushPromptResult('denied_after_sheet', 'denied');
  return { outcome: 'denied_after_sheet' };
}
