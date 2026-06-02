import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { isSubscribed as checkSubscribed } from "@/lib/onesignal";

export interface NotificationPreferences {
  push_enabled: boolean;
  paused_until: string | null;
  notify_new_match: boolean;
  notify_messages: boolean;
  /** Incoming voice/video calls from matches (separate from DM push bucket). */
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
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_timezone: string;
  message_bundle_enabled: boolean;
}

const DEFAULTS: NotificationPreferences = {
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
  quiet_hours_start: "22:00:00",
  quiet_hours_end: "08:00:00",
  quiet_hours_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  message_bundle_enabled: true,
};

const NOTIFICATION_PREFERENCES_SELECT =
  "push_enabled, paused_until, notify_new_match, notify_messages, notify_match_calls, notify_someone_vibed_you, notify_ready_gate, notify_event_live, notify_event_reminder, notify_date_reminder, notify_daily_drop, notify_recommendations, notify_product_updates, notify_credits_subscription, sound_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, message_bundle_enabled";

type NotificationPreferencesRow = Partial<Record<keyof NotificationPreferences, unknown>>;

function normalizeNotificationPreferencesRow(row: NotificationPreferencesRow | null | undefined): NotificationPreferences {
  if (!row) return { ...DEFAULTS };
  return {
    push_enabled: row.push_enabled ?? true,
    paused_until: (row.paused_until as string | null | undefined) ?? null,
    notify_new_match: row.notify_new_match ?? true,
    notify_messages: row.notify_messages ?? true,
    notify_match_calls: row.notify_match_calls ?? row.notify_messages ?? true,
    notify_someone_vibed_you: row.notify_someone_vibed_you ?? true,
    notify_ready_gate: row.notify_ready_gate ?? true,
    notify_event_live: row.notify_event_live ?? true,
    notify_event_reminder: row.notify_event_reminder ?? true,
    notify_date_reminder: row.notify_date_reminder ?? true,
    notify_daily_drop: row.notify_daily_drop ?? false,
    notify_recommendations: row.notify_recommendations ?? false,
    notify_product_updates: row.notify_product_updates ?? false,
    notify_credits_subscription: row.notify_credits_subscription ?? true,
    sound_enabled: row.sound_enabled ?? true,
    quiet_hours_enabled: row.quiet_hours_enabled ?? false,
    quiet_hours_start: (row.quiet_hours_start as string | null | undefined) || "22:00:00",
    quiet_hours_end: (row.quiet_hours_end as string | null | undefined) || "08:00:00",
    quiet_hours_timezone: (row.quiet_hours_timezone as string | null | undefined) || "UTC",
    message_bundle_enabled: row.message_bundle_enabled ?? true,
  } as NotificationPreferences;
}

export function useNotificationPreferences() {
  const { user } = useUserProfile();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<NotificationPreferences>>({});
  const prefsRef = useRef<NotificationPreferences>(DEFAULTS);
  const persistedPrefsRef = useRef<NotificationPreferences>(DEFAULTS);

  const applyPrefs = useCallback((next: NotificationPreferences) => {
    prefsRef.current = next;
    setPrefs(next);
  }, []);

  // Fetch on mount
  useEffect(() => {
    pendingPatchRef.current = {};
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveError(null);

    if (!user?.id) {
      applyPrefs(DEFAULTS);
      persistedPrefsRef.current = DEFAULTS;
      setIsLoading(false);
      setIsPushSubscribed(false);
      return;
    }

    const fetch = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(NOTIFICATION_PREFERENCES_SELECT)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to fetch notification prefs:", error);
        setIsLoading(false);
        return;
      }

      if (!data) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const next = { ...DEFAULTS, quiet_hours_timezone: tz };
        const { error: insertError } = await supabase.from("notification_preferences").upsert(
          {
            user_id: user.id,
            quiet_hours_timezone: tz,
          },
          { onConflict: "user_id" }
        );
        if (insertError) {
          console.error("Failed to create notification prefs:", insertError);
          setSaveError(insertError.message);
        } else {
          persistedPrefsRef.current = next;
        }
        applyPrefs(next);
      } else {
        const next = normalizeNotificationPreferencesRow(data as NotificationPreferencesRow);
        persistedPrefsRef.current = next;
        applyPrefs(next);
      }
      setIsLoading(false);
    };

    fetch();

    // Check push subscription
    checkSubscribed().then(setIsPushSubscribed);
  }, [applyPrefs, user?.id]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flushPendingPrefs = useCallback(async (userId: string) => {
    const patch = pendingPatchRef.current;
    const patchKeys = Object.keys(patch) as Array<keyof NotificationPreferences>;
    if (!patchKeys.length) return;

    pendingPatchRef.current = {};
    setIsSaving(true);

    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: userId,
          ...patch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select(NOTIFICATION_PREFERENCES_SELECT)
      .single();

    if (error) {
      console.error("Failed to save notification prefs:", error);
      setSaveError(error.message);
      const pendingKeys = new Set(Object.keys(pendingPatchRef.current));
      const rollback = patchKeys.reduce<Partial<NotificationPreferences>>((acc, key) => {
        if (pendingKeys.has(key)) return acc;
        acc[key] = persistedPrefsRef.current[key] as never;
        return acc;
      }, {});
      applyPrefs({ ...prefsRef.current, ...rollback });
    } else {
      const next = normalizeNotificationPreferencesRow(data as NotificationPreferencesRow);
      const pendingPatch = pendingPatchRef.current;
      persistedPrefsRef.current = next;
      applyPrefs(Object.keys(pendingPatch).length ? { ...next, ...pendingPatch } : next);
      setSaveError(null);
    }

    setIsSaving(Object.keys(pendingPatchRef.current).length > 0);
  }, [applyPrefs]);

  // Debounced save
  const savePrefs = useCallback(
    (updated: Partial<NotificationPreferences>) => {
      if (!user?.id) return;
      const userId = user.id;

      setSaveError(null);
      pendingPatchRef.current = { ...pendingPatchRef.current, ...updated };
      setPrefs((prev) => {
        const next = { ...prev, ...updated };
        prefsRef.current = next;
        return next;
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void flushPendingPrefs(userId);
      }, 500);
    },
    [flushPendingPrefs, user?.id]
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
    saveError,
    isPushSubscribed,
    isPaused,
    toggle,
    savePrefs,
    setPauseUntil,
  };
}
