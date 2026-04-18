/**
 * Notification preferences — fetch/update notification_preferences (parity with web).
 * Columns match public.notification_preferences (see supabase migrations).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const SELECT_COLUMNS =
  'push_enabled, paused_until, notify_new_match, notify_messages, notify_match_calls, notify_someone_vibed_you, notify_ready_gate, notify_event_live, notify_event_reminder, notify_date_reminder, notify_daily_drop, notify_recommendations, notify_product_updates, notify_credits_subscription, sound_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, message_bundle_enabled';

export type NotificationPrefs = {
  push_enabled: boolean;
  paused_until: string | null;
  notify_new_match: boolean;
  notify_messages: boolean;
  notify_match_calls: boolean;
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
  notify_match_calls: true,
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

function mergeRow(row: Record<string, unknown> | null): NotificationPrefs {
  if (!row) return { ...NOTIFICATION_PREFS_DEFAULTS };
  const b = (k: string, def: boolean) => (row[k] === null || row[k] === undefined ? def : Boolean(row[k]));
  return {
    push_enabled: b('push_enabled', NOTIFICATION_PREFS_DEFAULTS.push_enabled),
    paused_until: (row.paused_until as string) ?? null,
    notify_new_match: b('notify_new_match', true),
    notify_messages: b('notify_messages', true),
    notify_match_calls:
      row.notify_match_calls !== null && row.notify_match_calls !== undefined
        ? Boolean(row.notify_match_calls)
        : b('notify_messages', true),
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

export function useNotificationPreferences(userId: string | null | undefined) {
  const qc = useQueryClient();

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
      return mergeRow(data as Record<string, unknown> | null);
    },
    enabled: !!userId,
  });

  const mutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: userId, [key]: value }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });

  const updatePref = (key: string, value: unknown) => {
    mutation.mutate({ key, value });
  };

  return {
    prefs: prefs ?? NOTIFICATION_PREFS_DEFAULTS,
    isLoading,
    updatePref,
    isUpdating: mutation.isPending,
  };
}
