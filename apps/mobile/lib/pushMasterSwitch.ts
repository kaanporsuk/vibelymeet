/**
 * Master "All Notifications" switch — only touches push_enabled + OneSignal opt-in/out.
 * Never modifies category toggles or paused_until.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { disablePush } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';

export async function applyMasterPushEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: enabled },
    { onConflict: 'user_id' }
  );
  if (error) throw error;

  if (!enabled) {
    disablePush(true);
    return;
  }

  const stored = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  const isPaused = !!(stored && new Date(stored) > new Date());
  if (!isPaused) {
    disablePush(false);
  }
}
