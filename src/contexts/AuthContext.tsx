import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";
import { trackEvent } from "@/lib/analytics";
import {
  getFallbackEntryState,
  getAuthProvider,
  getEntryStateOnboardingStatus,
  resolveEntryState,
  type EntryStateResponse,
} from "@shared/entryState";
import { clearPreparedVideoDateEntryCache } from "@clientShared/matching/videoDatePrepareEntry";
import { clearMyLocationDataCache } from "@/services/myLocationData";
import { recordBrowserEvent, removeAllRealtimeChannels } from "@/lib/browserDiagnostics";
import { queryClient } from "@/lib/queryClient";
import {
  CLIENT_FEATURE_FLAG_QUERY_KEY,
  clearClientFeatureFlagCache,
  clientFeatureFlagQueryKey,
  hydrateClientFeatureFlagsForWeb,
  prefetchClientFeatureFlagsForUser,
} from "@/lib/clientFeatureFlags";
import {
  markMediaSdkForegroundReconcile,
  shouldRunMediaSdkForegroundReconcile,
} from "@clientShared/media-sdk";
import {
  AUTH_REFRESH_LEAD_MS,
  AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS,
  applyManagedAuthRefreshSession,
  authRefreshDebugInfo,
  classifyAuthRefreshError,
  isNewerAuthRefreshSession,
  nextAuthRefreshDelayMs,
  requestManagedAuthRefresh,
  shouldRefreshSessionSoon,
} from "@clientShared/authRefreshPolicy";

interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  age: number | null;
  gender: string | null;
  location: string | null;
  hasPhotos: boolean;
  isPremium: boolean;
  subscriptionTier: string | null;
  isVerified: boolean;
  isPaused: boolean;
  pauseUntil: Date | null;
}

interface SessionContextType {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isProfileLoading: boolean;
  authRedirectReason: "session_expired" | null;
  entryState: EntryStateResponse | null;
  entryStateLoading: boolean;
  isOfflineAtBoot: boolean;
  onboardingStatus: 'complete' | 'incomplete' | 'unknown';
  onboardingComplete: boolean | null;
  refreshEntryState: () => Promise<EntryStateResponse | null>;
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
}

interface ProfileContextType {
  user: User | null;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);
const ProfileContext = createContext<ProfileContextType | undefined>(undefined);
const BOOT_TIMEOUT_MS = 9_000;
const AUTH_SESSION_TIMEOUT_MS = 5_000;
const AUTH_SCOPED_EVENT_QUERY_KEYS = [
  ["event-details"],
  ["event-deck"],
  ["events"],
  ["visible-events"],
  ["events-discover"],
  ["other-city-events"],
  ["next-event"],
  ["next-registered-event"],
  ["event-registration-check"],
  ["event-attendees"],
  ["event-attendee-preview"],
  ["event-vibes-sent"],
  ["event-vibes-received"],
  ["registered-events-for-reminders"],
  ["registered-upcoming-events-invite"],
  ["user-registrations"],
] as const;

function clearAuthScopedEventQueries() {
  for (const queryKey of AUTH_SCOPED_EVENT_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [...queryKey] });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withBootTimeout<T>(
  promise: PromiseLike<T>,
  operation: string,
  timeoutMs = BOOT_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      recordBrowserEvent("browser.boot_timeout", {
        operation,
        timeout_ms: timeoutMs,
      });
      reject(new Error(`${operation}_timeout`));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function transformSupabaseUser(supabaseUser: SupabaseUser, profileData?: Record<string, unknown>): User {
  const untilIso =
    (profileData?.paused_until as string | null | undefined) ||
    (profileData?.account_paused_until as string | null | undefined) ||
    null;
  return {
    id: supabaseUser.id,
    name: (profileData?.name as string) || supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'User',
    email: supabaseUser.email || '',
    avatarUrl: (profileData?.avatar_url as string) || supabaseUser.user_metadata?.avatar_url || '',
    age: (profileData?.age as number) ?? null,
    gender: (profileData?.gender as string) ?? null,
    location: (profileData?.location as string) ?? null,
    hasPhotos: (((profileData?.photos as string[] | null) ?? []).length || 0) > 0,
    isPremium: (profileData?.is_premium as boolean) || false,
    subscriptionTier: (profileData?.subscription_tier as string) ?? null,
    isVerified: (profileData?.photo_verified as boolean) || false,
    isPaused: !!(profileData?.is_paused || profileData?.account_paused),
    pauseUntil: untilIso ? new Date(untilIso) : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [authRedirectReason, setAuthRedirectReason] = useState<"session_expired" | null>(null);
  const [entryState, setEntryState] = useState<EntryStateResponse | null>(null);
  const [entryStateLoading, setEntryStateLoading] = useState(false);
  const [isOfflineAtBoot, setIsOfflineAtBoot] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const currentUserId = session?.user?.id ?? null;
  const currentAuthProvider = getAuthProvider(session?.user);
  const authUserIdRef = useRef<string | null>(null);
  const sessionUserRef = useRef<SupabaseUser | null>(null);
  const managedRefreshFailureCountRef = useRef(0);
  const managedRefreshInFlightRef = useRef(false);

  const clearFeatureFlagState = useCallback(async () => {
    await clearClientFeatureFlagCache();
    queryClient.removeQueries({ queryKey: [CLIENT_FEATURE_FLAG_QUERY_KEY] });
  }, []);

  const warmFeatureFlags = useCallback((userId: string) => {
    void hydrateClientFeatureFlagsForWeb()
      .then(() => prefetchClientFeatureFlagsForUser(userId))
      .then((cacheAcceptedEvaluations) => {
        for (const evaluation of cacheAcceptedEvaluations) {
          queryClient.setQueryData(clientFeatureFlagQueryKey(evaluation.flag, userId), evaluation);
        }
      })
      .catch(() => undefined);
  }, []);

  const reconcileMediaUploadQueues = useCallback((reason: string) => {
    void Promise.all([
      import("@/lib/mediaSdk/webVideoUploads").then(({ reconcileWebVideoMediaSdkQueue }) =>
        reconcileWebVideoMediaSdkQueue(reason),
      ),
      import("@/lib/mediaSdk/webStorageUploads").then(({ reconcileWebStorageMediaSdkQueue }) =>
        reconcileWebStorageMediaSdkQueue(reason),
      ),
    ]).catch(() => undefined);
  }, []);

  const clearLocalAuthSession = useCallback(async (reason: string, error: unknown) => {
    recordBrowserEvent("browser.auth_refresh_invalid_session", {
      reason,
      error: authRefreshDebugInfo(error),
    });
    const invalidatedUserId = authUserIdRef.current ?? sessionUserRef.current?.id ?? null;
    managedRefreshFailureCountRef.current = 0;
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    removeAllRealtimeChannels(supabase, "auth_refresh_invalid_session");
    if (invalidatedUserId) {
      await withBootTimeout(
        import("@/lib/requestWebPushPermission").then(({ disconnectWebPushForLogout }) =>
          disconnectWebPushForLogout(invalidatedUserId),
        ),
        "web_push.invalid_session_clear",
        2_500,
      ).catch(() => undefined);
    }
    void import("@/lib/onesignal").then(({ removeExternalUserId }) => {
      removeExternalUserId();
    });
    await withBootTimeout(
      supabase.auth.signOut({ scope: "local" }),
      "auth.signOut.local",
      AUTH_SESSION_TIMEOUT_MS,
    ).catch(() => undefined);
    await clearFeatureFlagState();
    sessionUserRef.current = null;
    authUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setAuthRedirectReason("session_expired");
    setEntryState(null);
    setEntryStateLoading(false);
  }, [clearFeatureFlagState]);

  const refreshBootstrapSessionIfNeeded = useCallback(async (bootSession: Session | null) => {
    if (!bootSession?.refresh_token || typeof bootSession.expires_at !== "number") {
      return bootSession;
    }
    if (!shouldRefreshSessionSoon(bootSession, Date.now())) {
      return bootSession;
    }

    try {
      const refreshResponse = await requestManagedAuthRefresh({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        refreshToken: bootSession.refresh_token,
      });
      const refreshedSession = await applyManagedAuthRefreshSession(supabase.auth, bootSession, refreshResponse);
      return refreshedSession ?? bootSession;
    } catch (error) {
      const kind = classifyAuthRefreshError(error);
      recordBrowserEvent("browser.auth_bootstrap_refresh_failed", {
        kind,
        error: authRefreshDebugInfo(error),
      });
      if (kind === "invalid_session" || bootSession.expires_at * 1000 <= Date.now()) {
        await clearLocalAuthSession(`bootstrap_refresh_${kind}`, error);
        return null;
      }
      return bootSession;
    }
  }, [clearLocalAuthSession]);

  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const nextUserId = session?.user?.id ?? null;
        const previousUserId = authUserIdRef.current;
        setSession(session);
        authUserIdRef.current = nextUserId;
        sessionUserRef.current = session?.user ?? null;
        if (nextUserId) {
          setAuthRedirectReason(null);
        }
        if (!nextUserId) {
          clearPreparedVideoDateEntryCache();
          clearMyLocationDataCache();
          clearAuthScopedEventQueries();
          void clearFeatureFlagState();
          setEntryState(null);
          setEntryStateLoading(false);
          return;
        }
        if (nextUserId !== previousUserId) {
          clearPreparedVideoDateEntryCache();
          clearMyLocationDataCache();
          clearAuthScopedEventQueries();
          if (previousUserId) {
            void clearFeatureFlagState();
          } else {
            queryClient.removeQueries({ queryKey: [CLIENT_FEATURE_FLAG_QUERY_KEY] });
          }
          // Drop prior user's entry decision immediately so routing cannot use it
          // while the new session is already active (see currentUserId effect refresh).
          setEntryState(null);
          setEntryStateLoading(true);
        }
      }
    );

    withBootTimeout(
      supabase.auth.getSession(),
      "auth.getSession",
      AUTH_SESSION_TIMEOUT_MS,
    ).then(async ({ data: { session } }) => {
      if (cancelled) return;
      const readySession = await refreshBootstrapSessionIfNeeded(session);
      if (cancelled) return;
      const nextUserId = readySession?.user?.id ?? null;
      authUserIdRef.current = nextUserId;
      sessionUserRef.current = readySession?.user ?? null;
      setSession(readySession);
      if (nextUserId) {
        setAuthRedirectReason(null);
      }
      setEntryStateLoading(!!nextUserId);
      if (!readySession?.user && !navigator.onLine) {
        setIsOfflineAtBoot(true);
      }
    }).catch(() => {
      if (cancelled) return;
      sessionUserRef.current = null;
      if (!navigator.onLine) {
        setIsOfflineAtBoot(true);
      }
      setEntryStateLoading(false);
    }).finally(() => {
      if (cancelled) return;
      setIsLoading(false);
    });

    // Clear offline-at-boot flag when connectivity returns
    const handleOnline = () => setIsOfflineAtBoot(false);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
    };
  }, [clearFeatureFlagState, refreshBootstrapSessionIfNeeded]);

  useEffect(() => {
    authUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    if (!session?.refresh_token || typeof session.expires_at !== "number") {
      managedRefreshFailureCountRef.current = 0;
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSession = session;
    const sessionUserId = session.user.id;
    managedRefreshFailureCountRef.current = 0;

    const clearRefreshTimer = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const canRefreshNow = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      return true;
    };

    const scheduleRetry = (reason: string, delayMs: number) => {
      clearRefreshTimer();
      if (cancelled || !canRefreshNow()) return;
      refreshTimer = setTimeout(() => {
        void attemptRefresh(`retry:${reason}`);
      }, delayMs);
    };

    const scheduleNext = (reason: string) => {
      clearRefreshTimer();
      if (
        cancelled ||
        !canRefreshNow() ||
        !activeSession.refresh_token ||
        typeof activeSession.expires_at !== "number"
      ) return;
      const failureCount = managedRefreshFailureCountRef.current;
      const delayMs = failureCount > 0
        ? nextAuthRefreshDelayMs(failureCount)
        : Math.max(0, activeSession.expires_at * 1000 - Date.now() - AUTH_REFRESH_LEAD_MS);
      refreshTimer = setTimeout(() => {
        void attemptRefresh(`timer:${reason}`);
      }, delayMs);
    };

    async function recoverFromStaleRefreshRace(attemptedSession: Session, reason: string) {
      for (const delayMs of AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS) {
        if (cancelled) return true;
        if (delayMs > 0) await sleep(delayMs);
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
        const latestSession = data.session;
        if (!isNewerAuthRefreshSession(latestSession, attemptedSession)) {
          continue;
        }

        activeSession = latestSession;
        sessionUserRef.current = latestSession.user;
        setSession(latestSession);
        managedRefreshFailureCountRef.current = 0;
        recordBrowserEvent("browser.auth_refresh_stale_attempt_recovered", { reason });
        scheduleNext("stale_attempt_recovered");
        return true;
      }
      return false;
    }

    async function handleRefreshFailure(error: unknown, reason: string, attemptedSession: Session = activeSession) {
      const kind = classifyAuthRefreshError(error);
      if (kind === "invalid_session") {
        if (await recoverFromStaleRefreshRace(attemptedSession, reason)) {
          return;
        }
        await clearLocalAuthSession(reason, error);
        return;
      }

      const failureCount = managedRefreshFailureCountRef.current + 1;
      managedRefreshFailureCountRef.current = failureCount;
      const delayMs = nextAuthRefreshDelayMs(failureCount);
      recordBrowserEvent("browser.auth_refresh_retry_scheduled", {
        reason,
        failure_count: failureCount,
        delay_ms: delayMs,
        error: authRefreshDebugInfo(error),
      });
      scheduleRetry(reason, delayMs);
    }

    async function attemptRefresh(reason: string) {
      if (cancelled) return;
      if (managedRefreshInFlightRef.current) {
        scheduleRetry(reason, 1_000);
        return;
      }
      if (!canRefreshNow()) {
        scheduleNext(reason);
        return;
      }
      if (!shouldRefreshSessionSoon(activeSession, Date.now()) && managedRefreshFailureCountRef.current === 0) {
        scheduleNext(reason);
        return;
      }

      const refreshSession = activeSession;
      managedRefreshInFlightRef.current = true;
      try {
        const refreshResponse = await requestManagedAuthRefresh({
          supabaseUrl: SUPABASE_URL,
          publishableKey: SUPABASE_PUBLISHABLE_KEY,
          refreshToken: refreshSession.refresh_token,
        });
        const nextSession = await applyManagedAuthRefreshSession(supabase.auth, refreshSession, refreshResponse, {
          shouldApply: () =>
            !cancelled &&
            authUserIdRef.current === sessionUserId &&
            activeSession.refresh_token === refreshSession.refresh_token,
        });
        if (cancelled) return;
        if (!nextSession) return;
        if (authUserIdRef.current !== sessionUserId || nextSession.user.id !== sessionUserId) {
          return;
        }

        const recoveredAfterFailures = managedRefreshFailureCountRef.current;
        managedRefreshFailureCountRef.current = 0;
        activeSession = nextSession;
        sessionUserRef.current = nextSession.user;
        setSession(nextSession);
        if (recoveredAfterFailures > 0) {
          recordBrowserEvent("browser.auth_refresh_succeeded", {
            reason,
            recovered_after_failures: recoveredAfterFailures,
          });
        }
        scheduleNext("success");
      } catch (error) {
        if (!cancelled) {
          await handleRefreshFailure(error, reason, refreshSession);
        }
      } finally {
        managedRefreshInFlightRef.current = false;
      }
    }

    const resumeRefresh = (reason: string) => {
      if (shouldRefreshSessionSoon(activeSession, Date.now()) || managedRefreshFailureCountRef.current > 0) {
        void attemptRefresh(reason);
        return;
      }
      scheduleNext(reason);
    };

    const handleOnline = () => resumeRefresh("online");
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        resumeRefresh("visible");
      }
    };

    scheduleNext("session");
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      clearRefreshTimer();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [clearLocalAuthSession, session]);

  const refreshProfile = useCallback(async () => {
    if (!currentUserId) {
      setUser(null);
      return;
    }

    setIsProfileLoading(true);
    const userId = currentUserId;

    const profileSelect =
      "id, name, age, gender, location, avatar_url, photos, is_premium, subscription_tier, photo_verified, is_paused, paused_until, account_paused, account_paused_until";

    try {
      let { data: profile } = await withBootTimeout(
        supabase
          .from("profiles")
          .select(profileSelect)
          .eq("id", userId)
          .maybeSingle(),
        "profiles.bootstrap_select",
      );

      // Web auto-expiry: timed account pause ended — align DB with native clearExpiredAccountPauseIfNeeded
      if (profile?.account_paused && profile.account_paused_until) {
        const until = new Date(profile.account_paused_until as string);
        if (until <= new Date()) {
          await withBootTimeout(
            supabase
              .from("profiles")
              .update(END_ACCOUNT_BREAK_PROFILE_UPDATE)
              .eq("id", userId),
            "profiles.pause_clear",
            4_000,
          );
          const { data: refreshed } = await withBootTimeout(
            supabase
              .from("profiles")
              .select(profileSelect)
              .eq("id", userId)
              .maybeSingle(),
            "profiles.pause_refresh",
          );
          profile = refreshed ?? profile;
        }
      }

      const supabaseUser =
        sessionUserRef.current ??
        (await withBootTimeout(
          supabase.auth.getUser(),
          "auth.getUser",
          AUTH_SESSION_TIMEOUT_MS,
        )).data.user;
      if (supabaseUser && authUserIdRef.current === userId) {
        setUser(transformSupabaseUser(supabaseUser, profile || undefined));
      }
    } catch (error) {
      const supabaseUser = sessionUserRef.current;
      if (supabaseUser && authUserIdRef.current === userId) {
        setUser(transformSupabaseUser(supabaseUser));
      }
      if (import.meta.env.DEV) {
        console.warn("[auth] profile bootstrap failed:", error);
      }
    } finally {
      setIsProfileLoading(false);
    }
  }, [currentUserId]);

  const refreshEntryState = useCallback(async () => {
    if (!currentUserId) {
      setEntryState(null);
      return null;
    }

    setEntryStateLoading(true);
    const userId = currentUserId;
    try {
      const nextEntryState = await withBootTimeout(
        resolveEntryState(supabase),
        "resolve_entry_state",
      );
      if (authUserIdRef.current !== userId) return null;
      setEntryState(nextEntryState);
      trackEvent("entry_state_resolved", {
        state: nextEntryState.state,
        reason_code: nextEntryState.reason_code,
        platform: "web",
        provider: currentAuthProvider,
        evaluation_version: nextEntryState.evaluation_version,
      });
      return nextEntryState;
    } catch (error) {
      const fallbackEntryState = getFallbackEntryState("resolver_exception");
      if (authUserIdRef.current !== userId) return null;
      setEntryState(fallbackEntryState);
      trackEvent("entry_state_resolved", {
        state: fallbackEntryState.state,
        reason_code: fallbackEntryState.reason_code,
        platform: "web",
        provider: currentAuthProvider,
        evaluation_version: fallbackEntryState.evaluation_version,
        fallback: true,
      });
      if (import.meta.env.DEV) {
        console.warn("[auth] entry state bootstrap failed:", error);
      }
      return fallbackEntryState;
    } finally {
      if (authUserIdRef.current === userId) setEntryStateLoading(false);
    }
  }, [currentAuthProvider, currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      warmFeatureFlags(currentUserId);
      markMediaSdkForegroundReconcile(`web:${currentUserId}`);
      reconcileMediaUploadQueues("auth_session_start");
      void refreshProfile();
      setEntryStateLoading(true);
      void refreshEntryState();
    } else {
      setUser(null);
      setEntryState(null);
      setEntryStateLoading(false);
    }
  }, [currentUserId, reconcileMediaUploadQueues, refreshEntryState, refreshProfile, warmFeatureFlags]);

  useEffect(() => {
    if (!currentUserId || typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        shouldRunMediaSdkForegroundReconcile(`web:${currentUserId}`)
      ) {
        reconcileMediaUploadQueues("visibility_active");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [currentUserId, reconcileMediaUploadQueues]);

  const signIn = async (email: string, password: string, captchaToken?: string | null): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    if (!error) setAuthRedirectReason(null);
    return { error };
  };

  const logout = async () => {
    const userId = currentUserId;
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    clearAuthScopedEventQueries();
    removeAllRealtimeChannels(supabase, "logout");
    if (userId) {
      try {
        await withBootTimeout(
          import("@/lib/requestWebPushPermission").then(({ disconnectWebPushForLogout }) =>
            disconnectWebPushForLogout(userId),
          ),
          "web_push.logout_clear",
          4_000,
        );
      } catch {
        /* don't block logout */
      }
    }
    void import("@/lib/onesignal").then(({ removeExternalUserId }) => {
      removeExternalUserId();
    });
    await withBootTimeout(supabase.auth.signOut(), "auth.signOut", AUTH_SESSION_TIMEOUT_MS).catch(() => undefined);
    await clearFeatureFlagState();
    setAuthRedirectReason(null);
    sessionUserRef.current = null;
    authUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setEntryState(null);
    setEntryStateLoading(false);
  };

  const onboardingStatus = getEntryStateOnboardingStatus(entryState);

  return (
    <SessionContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        isProfileLoading,
        authRedirectReason,
        entryState,
        entryStateLoading,
        isOfflineAtBoot,
        onboardingStatus,
        onboardingComplete: onboardingStatus === 'complete' ? true : onboardingStatus === 'incomplete' ? false : null,
        refreshEntryState,
        signIn,
        logout,
      }}
    >
      <ProfileContext.Provider
        value={{
          user,
          refreshProfile,
        }}
      >
        {children}
      </ProfileContext.Provider>
    </SessionContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export function useUserProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useUserProfile must be used within an AuthProvider");
  }
  return ctx;
}
