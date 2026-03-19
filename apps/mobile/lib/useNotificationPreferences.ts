/**
 * Notification preferences — fetch and update notification_preferences.
 * Uses 8 toggle groups (pref_*) per design spec; legacy notify_* columns remain for web.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type NotificationPrefKey =
  | 'pref_messages'
  | 'pref_matches'
  | 'pref_events'
  | 'pref_daily_drop'
  | 'pref_video_dates'
  | 'pref_vibes_social'
  | 'pref_marketing'
  | 'pref_account_safety';

export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

const PREF_COLUMNS: NotificationPrefKey[] = [
  'pref_messages',
  'pref_matches',
  'pref_events',
  'pref_daily_drop',
  'pref_video_dates',
  'pref_vibes_social',
  'pref_marketing',
  'pref_account_safety',
];

const DEFAULTS: NotificationPrefs = {
  pref_messages: true,
  pref_matches: true,
  pref_events: true,
  pref_daily_drop: true,
  pref_video_dates: true,
  pref_vibes_social: true,
  pref_marketing: false,
  pref_account_safety: true,
};

export function useNotificationPreferences(userId: string | null | undefined) {
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: async (): Promise<NotificationPrefs> => {
      if (!userId) return DEFAULTS;
      const { data, error } = await supabase
        .from('notification_preferences')
        .select(PREF_COLUMNS.join(', '))
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULTS;
      const row = data as unknown as Record<string, boolean | null>;
      return {
        pref_messages: row.pref_messages ?? DEFAULTS.pref_messages,
        pref_matches: row.pref_matches ?? DEFAULTS.pref_matches,
        pref_events: row.pref_events ?? DEFAULTS.pref_events,
        pref_daily_drop: row.pref_daily_drop ?? DEFAULTS.pref_daily_drop,
        pref_video_dates: row.pref_video_dates ?? DEFAULTS.pref_video_dates,
        pref_vibes_social: row.pref_vibes_social ?? DEFAULTS.pref_vibes_social,
        pref_marketing: row.pref_marketing ?? DEFAULTS.pref_marketing,
        pref_account_safety: row.pref_account_safety ?? DEFAULTS.pref_account_safety,
      };
    },
    enabled: !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: NotificationPrefKey; value: boolean }) => {
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

  const updatePref = (key: NotificationPrefKey, value: boolean) => {
    updateMutation.mutate({ key, value });
  };

  const toggle = (key: NotificationPrefKey) => {
    const current = prefs?.[key] ?? DEFAULTS[key];
    updateMutation.mutate({ key, value: !current });
  };

  return {
    prefs: prefs ?? DEFAULTS,
    isLoading,
    toggle,
    updatePref,
    isUpdating: updateMutation.isPending,
  };
}
