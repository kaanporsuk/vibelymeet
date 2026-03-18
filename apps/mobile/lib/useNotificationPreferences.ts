/**
 * Notification preferences — fetch and update notification_preferences (parity with web).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type NotificationPrefs = {
  notify_new_match: boolean;
  notify_messages: boolean;
  notify_date_reminder: boolean;
  notify_event_reminder: boolean;
  notify_ready_gate: boolean;
  notify_daily_drop: boolean;
  notify_product_updates: boolean;
};

const DEFAULTS: NotificationPrefs = {
  notify_new_match: true,
  notify_messages: true,
  notify_date_reminder: true,
  notify_event_reminder: true,
  notify_ready_gate: true,
  notify_daily_drop: false,
  notify_product_updates: false,
};

export function useNotificationPreferences(userId: string | null | undefined) {
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: async (): Promise<NotificationPrefs> => {
      if (!userId) return DEFAULTS;
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('notify_new_match, notify_messages, notify_date_reminder, notify_event_reminder, notify_ready_gate, notify_daily_drop, notify_product_updates')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULTS;
      return {
        notify_new_match: (data as Record<string, boolean>).notify_new_match ?? true,
        notify_messages: (data as Record<string, boolean>).notify_messages ?? true,
        notify_date_reminder: (data as Record<string, boolean>).notify_date_reminder ?? true,
        notify_event_reminder: (data as Record<string, boolean>).notify_event_reminder ?? true,
        notify_ready_gate: (data as Record<string, boolean>).notify_ready_gate ?? true,
        notify_daily_drop: (data as Record<string, boolean>).notify_daily_drop ?? false,
        notify_product_updates: (data as Record<string, boolean>).notify_product_updates ?? false,
      };
    },
    enabled: !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: keyof NotificationPrefs; value: boolean }) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: userId, [key]: value }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-preferences', userId] });
    },
  });

  const toggle = (key: keyof NotificationPrefs) => {
    const current = prefs?.[key] ?? DEFAULTS[key];
    updateMutation.mutate({ key, value: !current });
  };

  return { prefs: prefs ?? DEFAULTS, isLoading, toggle, isUpdating: updateMutation.isPending };
}
