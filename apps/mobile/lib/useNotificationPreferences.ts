/**
 * Notification preferences — fetch/update notification_preferences (parity with web).
 * Columns match public.notification_preferences (see supabase migrations).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const SELECT_COLUMNS =
  'push_enabled, paused_until, notify_new_match, notify_messages, notify_someone_vibed_you, notify_ready_gate, notify_event_live, notify_event_reminder, notify_date_reminder, notify_daily_drop, notify_recommendations, notify_product_updates, notify_credits_subscription, sound_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, message_bundle_enabled';

export type NotificationPrefs = {
  push_enabled: boolean;
  paused_until: string | null;
  notify_new_match: boolean;
  notify_messages: boolean;
  notify_someone_vibed_you: boolean;
  notify_ready_gate: boolean;
  notify_event_live: boolean;
  notify_event_reminder: boolean;
  notify_date_reminder: boolean;
  notify_daily_drop: boolean;
  notify_recommendations: boolean;
  notify_product_updates: boolean;
  notify_credits_subscription: boolean;
  sound_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
  message_bundle_enabled: boolean;
};

export const NOTIFICATION_PREFS_DEFAULTS: NotificationPrefs = {
  push_enabled: true,
  paused_until: null,
  notify_new_match: true,
  notify_messages: true,
  notify_someone_vibed_you: true,
  notify_ready_gate: true,
  notify_event_live: true,
  notify_event_reminder: true,
  notify_date_reminder: true,
  notify_daily_drop: false,
  notify_recommendations: false,
  notify_product_updates: false,
  notify_credits_subscription: true,
  sound_enabled: true,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  quiet_hours_timezone: 'UTC',
  message_bundle_enabled: true,
};

type NotificationPrefsPatch = Partial<NotificationPrefs>;

function mergeRow(row: Record<string, unknown> | null): NotificationPrefs {
  if (!row) return { ...NOTIFICATION_PREFS_DEFAULTS };
  const b = (k: string, def: boolean) => (row[k] === null || row[k] === undefined ? def : Boolean(row[k]));
  return {
    push_enabled: b('push_enabled', NOTIFICATION_PREFS_DEFAULTS.push_enabled),
    paused_until: (row.paused_until as string) ?? null,
    notify_new_match: b('notify_new_match', true),
    notify_messages: b('notify_messages', true),
    notify_someone_vibed_you: b('notify_someone_vibed_you', true),
    notify_ready_gate: b('notify_ready_gate', true),
    notify_event_live: b('notify_event_live', true),
    notify_event_reminder: b('notify_event_reminder', true),
    notify_date_reminder: b('notify_date_reminder', true),
    notify_daily_drop: b('notify_daily_drop', false),
    notify_recommendations: b('notify_recommendations', false),
    notify_product_updates: b('notify_product_updates', false),
    notify_credits_subscription: b('notify_credits_subscription', true),
    sound_enabled: b('sound_enabled', true),
    quiet_hours_enabled: b('quiet_hours_enabled', false),
    quiet_hours_start: (row.quiet_hours_start as string) ?? NOTIFICATION_PREFS_DEFAULTS.quiet_hours_start,
    quiet_hours_end: (row.quiet_hours_end as string) ?? NOTIFICATION_PREFS_DEFAULTS.quiet_hours_end,
    quiet_hours_timezone: (row.quiet_hours_timezone as string) ?? NOTIFICATION_PREFS_DEFAULTS.quiet_hours_timezone,
    message_bundle_enabled: b('message_bundle_enabled', true),
  };
}

function notificationPreferencesQueryKey(userId: string) {
  return ['notification-preferences', userId] as const;
}

export function useNotificationPreferences(userId: string | null | undefined) {
  const qc = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeUserIdRef = useRef<string | null>(userId ?? null);
  const mountedRef = useRef(true);
  const pendingPatchRef = useRef<NotificationPrefsPatch>({});
  const flushInFlightRef = useRef(false);
  const persistedPrefsRef = useRef<NotificationPrefs>({ ...NOTIFICATION_PREFS_DEFAULTS });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const currentUserId = userId ?? null;
    activeUserIdRef.current = currentUserId;
    pendingPatchRef.current = {};
    persistedPrefsRef.current = currentUserId
      ? qc.getQueryData<NotificationPrefs>(notificationPreferencesQueryKey(currentUserId)) ?? {
          ...NOTIFICATION_PREFS_DEFAULTS,
        }
      : { ...NOTIFICATION_PREFS_DEFAULTS };
    if (mountedRef.current) {
      setSaveError(null);
      setIsUpdating(false);
    }
  }, [qc, userId]);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: async (): Promise<NotificationPrefs> => {
      if (!userId) return { ...NOTIFICATION_PREFS_DEFAULTS };
      const { data, error } = await supabase
        .from('notification_preferences')
        .select(SELECT_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      const next = mergeRow(data as Record<string, unknown> | null);
      if (activeUserIdRef.current === userId) {
        persistedPrefsRef.current = next;
      }
      return next;
    },
    enabled: !!userId,
  });

  const flushPendingPrefs = useCallback(async (targetUserId: string) => {
    if (flushInFlightRef.current) return;
    if (!Object.keys(pendingPatchRef.current).length) return;
    flushInFlightRef.current = true;
    if (mountedRef.current) setIsUpdating(true);

    try {
      while (activeUserIdRef.current === targetUserId && Object.keys(pendingPatchRef.current).length) {
        const patch = pendingPatchRef.current;
        const patchKeys = Object.keys(patch) as Array<keyof NotificationPrefs>;
        const queryKey = notificationPreferencesQueryKey(targetUserId);
        const previous = persistedPrefsRef.current;
        pendingPatchRef.current = {};

        const { data, error } = await supabase
          .from('notification_preferences')
          .upsert({ user_id: targetUserId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
          .select(SELECT_COLUMNS)
          .single();

        if (activeUserIdRef.current !== targetUserId) break;

        if (error) {
          if (mountedRef.current) setSaveError(error.message);
          const pendingKeys = new Set(Object.keys(pendingPatchRef.current));
          qc.setQueryData<NotificationPrefs>(queryKey, (current) => {
            const rollback = patchKeys.reduce<NotificationPrefsPatch>((acc, key) => {
              if (pendingKeys.has(key)) return acc;
              acc[key] = previous[key] as never;
              return acc;
            }, {});
            return { ...(current ?? previous), ...rollback };
          });
        } else {
          if (mountedRef.current) setSaveError(null);
          const next = mergeRow(data as Record<string, unknown> | null);
          const pendingPatch = pendingPatchRef.current;
          persistedPrefsRef.current = next;
          qc.setQueryData(
            queryKey,
            Object.keys(pendingPatch).length ? { ...next, ...pendingPatch } : next
          );
        }
      }
    } finally {
      flushInFlightRef.current = false;
      const activeUserId = activeUserIdRef.current;
      if (activeUserId && Object.keys(pendingPatchRef.current).length) {
        void flushPendingPrefs(activeUserId);
      } else {
        if (mountedRef.current) setIsUpdating(false);
      }
    }
  }, [qc]);

  const updatePrefs = useCallback(
    (patch: NotificationPrefsPatch) => {
      if (!userId) return;
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
      if (!entries.length) return;
      const nextPatch = Object.fromEntries(entries) as NotificationPrefsPatch;
      const queryKey = notificationPreferencesQueryKey(userId);

      if (mountedRef.current) {
        setSaveError(null);
        setIsUpdating(true);
      }
      pendingPatchRef.current = { ...pendingPatchRef.current, ...nextPatch };
      qc.setQueryData<NotificationPrefs>(queryKey, (current) => ({
        ...(current ?? NOTIFICATION_PREFS_DEFAULTS),
        ...nextPatch,
      }));

      if (activeUserIdRef.current === userId) {
        void flushPendingPrefs(userId);
      }
    },
    [flushPendingPrefs, qc, userId]
  );

  const updatePref = useCallback(
    <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
      updatePrefs({ [key]: value } as NotificationPrefsPatch);
    },
    [updatePrefs]
  );

  return {
    prefs: prefs ?? NOTIFICATION_PREFS_DEFAULTS,
    isLoading,
    updatePref,
    updatePrefs,
    isUpdating,
    saveError,
  };
}
