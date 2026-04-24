/**
 * Pause/resume notification delivery: Supabase notification_preferences, AsyncStorage cache,
 * and OneSignal disablePush (optOut/optIn — see onesignal.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { disablePush } from '@/lib/onesignal';
import { getCachedUserId } from '@/lib/nativeAuthSession';

/** Current key — also migrate legacy `notifications_paused_until` on read. */
export const PAUSED_UNTIL_KEY = 'vibely_notifications_paused_until';
const LEGACY_PAUSED_UNTIL_KEY = 'notifications_paused_until';

export const PAUSE_KIND_KEY = 'notifications_pause_kind';

export type PauseKind = 'm30' | 'h1' | 'h8' | 'd1' | 'w1' | 'manual';

const MANUAL_UNTIL_ISO = '2099-12-31T23:59:59.999Z';

async function migrateLegacyPausedUntilKey(): Promise<void> {
  const legacy = await AsyncStorage.getItem(LEGACY_PAUSED_UNTIL_KEY);
  const next = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  if (legacy && !next) {
    await AsyncStorage.setItem(PAUSED_UNTIL_KEY, legacy);
    await AsyncStorage.removeItem(LEGACY_PAUSED_UNTIL_KEY);
  }
}

export function computePausedUntil(kind: PauseKind): Date {
  const now = Date.now();
  switch (kind) {
    case 'm30':
      return new Date(now + 30 * 60 * 1000);
    case 'h1':
      return new Date(now + 60 * 60 * 1000);
    case 'h8':
      return new Date(now + 8 * 60 * 60 * 1000);
    case 'd1':
      return new Date(now + 24 * 60 * 60 * 1000);
    case 'w1':
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case 'manual':
      return new Date(MANUAL_UNTIL_ISO);
    default:
      return new Date(now + 60 * 60 * 1000);
  }
}

export function inferPauseKindFromUntil(iso: string | null | undefined): PauseKind | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() >= 2095) return 'manual';
  return null;
}

export async function applyPause(kind: PauseKind, userId: string): Promise<void> {
  const pausedUntil = computePausedUntil(kind);
  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, paused_until: pausedUntil.toISOString() },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
  await AsyncStorage.setItem(PAUSED_UNTIL_KEY, pausedUntil.toISOString());
  await AsyncStorage.removeItem(LEGACY_PAUSED_UNTIL_KEY);
  await AsyncStorage.setItem(PAUSE_KIND_KEY, kind);
  disablePush(true);
}

export async function applyResume(userId: string): Promise<void> {
  await resumeNotifications(userId);
}

/** Full resume: DB + local storage + OneSignal (re-enable only if master push is still on). */
export async function resumeNotifications(userId: string): Promise<void> {
  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, paused_until: null },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
  await AsyncStorage.removeItem(PAUSED_UNTIL_KEY);
  await AsyncStorage.removeItem(LEGACY_PAUSED_UNTIL_KEY);
  await AsyncStorage.removeItem(PAUSE_KIND_KEY);

  const { data: row } = await supabase
    .from('notification_preferences')
    .select('push_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  const pushEnabled = row?.push_enabled !== false;
  disablePush(!pushEnabled);
}

/** Align SDK opt-in/out with server + AsyncStorage (call after login). */
export async function syncNativePushSuppressionWithBackend(userId: string): Promise<void> {
  await migrateLegacyPausedUntilKey();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('paused_until, push_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn('[notificationPause] sync fetch failed:', error.message);
    return;
  }
  const pausedUntilIso = (data?.paused_until as string | null) ?? null;
  const pushEnabled = (data as { push_enabled?: boolean } | null)?.push_enabled !== false;
  const now = new Date();
  if (pausedUntilIso && new Date(pausedUntilIso) > now) {
    await AsyncStorage.setItem(PAUSED_UNTIL_KEY, pausedUntilIso);
    disablePush(true);
  } else {
    await AsyncStorage.multiRemove([PAUSED_UNTIL_KEY, LEGACY_PAUSED_UNTIL_KEY, PAUSE_KIND_KEY]);
    if (pausedUntilIso && new Date(pausedUntilIso) <= now) {
      await supabase.from('notification_preferences').upsert(
        { user_id: userId, paused_until: null },
        { onConflict: 'user_id' }
      );
    }
    disablePush(!pushEnabled);
  }
}

/** When pause window expires (foreground): clear DB, storage, re-enable push. */
export async function clearExpiredPauseIfNeeded(): Promise<void> {
  await migrateLegacyPausedUntilKey();
  const stored =
    (await AsyncStorage.getItem(PAUSED_UNTIL_KEY)) ??
    (await AsyncStorage.getItem(LEGACY_PAUSED_UNTIL_KEY));
  if (!stored) return;
  const pausedUntil = new Date(stored);
  if (pausedUntil > new Date()) return;

  const userId = await getCachedUserId();
  if (userId) {
    await resumeNotifications(userId);
  } else {
    disablePush(false);
    await AsyncStorage.multiRemove([PAUSED_UNTIL_KEY, LEGACY_PAUSED_UNTIL_KEY, PAUSE_KIND_KEY]);
  }
}

export async function clearLocalPauseKeys(): Promise<void> {
  await AsyncStorage.multiRemove([PAUSED_UNTIL_KEY, LEGACY_PAUSED_UNTIL_KEY, PAUSE_KIND_KEY]);
}
