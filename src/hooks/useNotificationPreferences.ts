import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { isSubscribed as checkSubscribed } from "@/lib/onesignal";

export interface NotificationPreferences {
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
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_timezone: string;
  message_bundle_enabled: boolean;
  onesignal_player_id: string | null;
  onesignal_subscribed: boolean;
}

const DEFAULTS: NotificationPreferences = {
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
  quiet_hours_start: "22:00:00",
  quiet_hours_end: "08:00:00",
  quiet_hours_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  message_bundle_enabled: true,
  onesignal_player_id: null,
  onesignal_subscribed: false,
};

export function useNotificationPreferences() {
  const { user } = useUserProfile();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch on mount
  useEffect(() => {
    if (!user?.id) return;

    const fetch = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to fetch notification prefs:", error);
        setIsLoading(false);
        return;
      }

      if (!data) {
        // Insert defaults
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        await supabase.from("notification_preferences").insert({
          user_id: user.id,
          quiet_hours_timezone: tz,
        });
        setPrefs({ ...DEFAULTS, quiet_hours_timezone: tz });
      } else {
        setPrefs({
          push_enabled: data.push_enabled ?? true,
          paused_until: data.paused_until,
          notify_new_match: data.notify_new_match ?? true,
          notify_messages: data.notify_messages ?? true,
          notify_someone_vibed_you: data.notify_someone_vibed_you ?? true,
          notify_ready_gate: data.notify_ready_gate ?? true,
          notify_event_live: data.notify_event_live ?? true,
          notify_event_reminder: data.notify_event_reminder ?? true,
          notify_date_reminder: data.notify_date_reminder ?? true,
          notify_daily_drop: data.notify_daily_drop ?? false,
          notify_recommendations: data.notify_recommendations ?? false,
          notify_product_updates: data.notify_product_updates ?? false,
          notify_credits_subscription: data.notify_credits_subscription ?? true,
          sound_enabled: data.sound_enabled ?? true,
          quiet_hours_enabled: data.quiet_hours_enabled ?? false,
          quiet_hours_start: data.quiet_hours_start || "22:00:00",
          quiet_hours_end: data.quiet_hours_end || "08:00:00",
          quiet_hours_timezone: data.quiet_hours_timezone || "UTC",
          message_bundle_enabled: data.message_bundle_enabled ?? true,
          onesignal_player_id: data.onesignal_player_id,
          onesignal_subscribed: data.onesignal_subscribed ?? false,
        });
      }
      setIsLoading(false);
    };

    fetch();

    // Check push subscription
    checkSubscribed().then(setIsPushSubscribed);
  }, [user?.id]);

  // Debounced save
  const savePrefs = useCallback(
    (updated: Partial<NotificationPreferences>) => {
      if (!user?.id) return;

      setPrefs((prev) => ({ ...prev, ...updated }));

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setIsSaving(true);
        await supabase
          .from("notification_preferences")
          .update({ ...updated, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        setIsSaving(false);
      }, 500);
    },
    [user?.id]
  );

  const toggle = useCallback(
    (key: keyof NotificationPreferences) => {
      const current = prefs[key];
      if (typeof current === "boolean") {
        const next = !current;
        if (key === "quiet_hours_enabled" && next) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
          savePrefs({ [key]: next, quiet_hours_timezone: tz });
        } else {
          savePrefs({ [key]: next });
        }
      }
    },
    [prefs, savePrefs]
  );

  const setPauseUntil = useCallback(
    (until: string | null) => {
      savePrefs({ paused_until: until });
    },
    [savePrefs]
  );

  const isPaused = prefs.paused_until ? new Date(prefs.paused_until) > new Date() : false;

  return {
    prefs,
    isLoading,
    isSaving,
    isPushSubscribed,
    isPaused,
    toggle,
    savePrefs,
    setPauseUntil,
  };
}
