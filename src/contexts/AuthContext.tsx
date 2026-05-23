import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  entryState: EntryStateResponse | null;
  entryStateLoading: boolean;
  isOfflineAtBoot: boolean;
  onboardingStatus: 'complete' | 'incomplete' | 'unknown';
  onboardingComplete: boolean | null;
  refreshEntryState: () => Promise<EntryStateResponse | null>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
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
  const [entryState, setEntryState] = useState<EntryStateResponse | null>(null);
  const [entryStateLoading, setEntryStateLoading] = useState(false);
  const [isOfflineAtBoot, setIsOfflineAtBoot] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const currentUserId = session?.user?.id ?? null;
  const currentAuthProvider = getAuthProvider(session?.user);
  const authUserIdRef = useRef<string | null>(null);
  const sessionUserRef = useRef<SupabaseUser | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const nextUserId = session?.user?.id ?? null;
        const previousUserId = authUserIdRef.current;
        setSession(session);
        authUserIdRef.current = nextUserId;
        sessionUserRef.current = session?.user ?? null;
        if (!nextUserId) {
          clearPreparedVideoDateEntryCache();
          clearMyLocationDataCache();
          void clearFeatureFlagState();
          setEntryState(null);
          setEntryStateLoading(false);
          return;
        }
        if (nextUserId !== previousUserId) {
          clearPreparedVideoDateEntryCache();
          clearMyLocationDataCache();
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
    ).then(({ data: { session } }) => {
      if (cancelled) return;
      const nextUserId = session?.user?.id ?? null;
      authUserIdRef.current = nextUserId;
      sessionUserRef.current = session?.user ?? null;
      setSession(session);
      setEntryStateLoading(!!nextUserId);
      if (!session?.user && !navigator.onLine) {
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
  }, [clearFeatureFlagState]);

  useEffect(() => {
    authUserIdRef.current = currentUserId;
  }, [currentUserId]);

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

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const logout = async () => {
    const userId = currentUserId;
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
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
