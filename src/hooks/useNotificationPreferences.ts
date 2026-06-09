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
};

const NOTIFICATION_PREFERENCES_SELECT =
  "push_enabled, paused_until, notify_new_match, notify_messages, notify_someone_vibed_you, notify_ready_gate, notify_event_live, notify_event_reminder, notify_date_reminder, notify_daily_drop, notify_recommendations, notify_product_updates, notify_credits_subscription, sound_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, message_bundle_enabled";

type NotificationPreferencesRow = Partial<Record<keyof NotificationPreferences, unknown>>;

function normalizeNotificationPreferencesRow(row: NotificationPreferencesRow | null | undefined): NotificationPreferences {
  if (!row) return { ...DEFAULTS };
  const bool = (key: keyof NotificationPreferences, fallback: boolean) =>
    typeof row[key] === "boolean" ? row[key] : fallback;
  return {
    push_enabled: bool("push_enabled", true),
    paused_until: (row.paused_until as string | null | undefined) ?? null,
    notify_new_match: bool("notify_new_match", true),
    notify_messages: bool("notify_messages", true),
    notify_someone_vibed_you: bool("notify_someone_vibed_you", true),
    notify_ready_gate: bool("notify_ready_gate", true),
    notify_event_live: bool("notify_event_live", true),
    notify_event_reminder: bool("notify_event_reminder", true),
    notify_date_reminder: bool("notify_date_reminder", true),
    notify_daily_drop: bool("notify_daily_drop", false),
    notify_recommendations: bool("notify_recommendations", false),
    notify_product_updates: bool("notify_product_updates", false),
    notify_credits_subscription: bool("notify_credits_subscription", true),
    sound_enabled: bool("sound_enabled", true),
    quiet_hours_enabled: bool("quiet_hours_enabled", false),
    quiet_hours_start: (row.quiet_hours_start as string | null | undefined) || "22:00:00",
    quiet_hours_end: (row.quiet_hours_end as string | null | undefined) || "08:00:00",
    quiet_hours_timezone: (row.quiet_hours_timezone as string | null | undefined) || "UTC",
    message_bundle_enabled: bool("message_bundle_enabled", true),
  };
}

export function useNotificationPreferences() {
  const { user } = useUserProfile();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingPatchRef = useRef<Partial<NotificationPreferences>>({});
  const flushInFlightRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const prefsRef = useRef<NotificationPreferences>(DEFAULTS);
  const persistedPrefsRef = useRef<NotificationPreferences>(DEFAULTS);

  const applyPrefs = useCallback((next: NotificationPreferences) => {
    prefsRef.current = next;
    if (mountedRef.current) setPrefs(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    const currentUserId = user?.id ?? null;
    activeUserIdRef.current = currentUserId;
    pendingPatchRef.current = {};
    setSaveError(null);
    setIsSaving(false);

    if (!currentUserId) {
      applyPrefs(DEFAULTS);
      persistedPrefsRef.current = DEFAULTS;
      setIsLoading(false);
      setIsPushSubscribed(false);
      return;
    }

    const loadingDefaults = {
      ...DEFAULTS,
      quiet_hours_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    applyPrefs(loadingDefaults);
    persistedPrefsRef.current = loadingDefaults;
    setIsLoading(true);

    const fetch = async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(NOTIFICATION_PREFERENCES_SELECT)
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (cancelled || activeUserIdRef.current !== currentUserId) return;

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
            user_id: currentUserId,
            quiet_hours_timezone: tz,
          },
          { onConflict: "user_id" }
        );
        if (cancelled || activeUserIdRef.current !== currentUserId) return;
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
    checkSubscribed()
      .then((subscribed) => {
        if (!cancelled && activeUserIdRef.current === currentUserId) setIsPushSubscribed(subscribed);
      })
      .catch(() => {
        if (!cancelled && activeUserIdRef.current === currentUserId) setIsPushSubscribed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyPrefs, user?.id]);

  const flushPendingPrefs = useCallback(async (userId: string) => {
    if (flushInFlightRef.current) return;
    if (!Object.keys(pendingPatchRef.current).length) return;
    flushInFlightRef.current = true;
    if (mountedRef.current) setIsSaving(true);

    try {
      while (activeUserIdRef.current === userId && Object.keys(pendingPatchRef.current).length) {
        const patch = pendingPatchRef.current;
        const patchKeys = Object.keys(patch) as Array<keyof NotificationPreferences>;
        pendingPatchRef.current = {};

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

        if (activeUserIdRef.current !== userId) break;

        if (error) {
          console.error("Failed to save notification prefs:", error);
          if (mountedRef.current) setSaveError(error.message);
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
          if (mountedRef.current) setSaveError(null);
        }
      }
    } finally {
      flushInFlightRef.current = false;
      const activeUserId = activeUserIdRef.current;
      if (activeUserId && Object.keys(pendingPatchRef.current).length) {
        void flushPendingPrefs(activeUserId);
      } else {
        if (mountedRef.current) setIsSaving(false);
      }
    }
  }, [applyPrefs]);

  const savePrefs = useCallback(
    (updated: Partial<NotificationPreferences>) => {
      if (!user?.id) return;
      const userId = user.id;
      const entries = Object.entries(updated).filter(([, value]) => value !== undefined);
      if (!entries.length) return;
      const nextPatch = Object.fromEntries(entries) as Partial<NotificationPreferences>;

      setSaveError(null);
      setIsSaving(true);
      pendingPatchRef.current = { ...pendingPatchRef.current, ...nextPatch };
      setPrefs((prev) => {
        const next = { ...prev, ...nextPatch };
        prefsRef.current = next;
        return next;
      });

      if (activeUserIdRef.current === userId) {
        void flushPendingPrefs(userId);
      }
    },
    [flushPendingPrefs, user?.id]
  );

  useEffect(() => {
    return () => {
      const activeUserId = activeUserIdRef.current;
      if (activeUserId && Object.keys(pendingPatchRef.current).length) {
        void flushPendingPrefs(activeUserId);
      }
    };
  }, [flushPendingPrefs]);

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
