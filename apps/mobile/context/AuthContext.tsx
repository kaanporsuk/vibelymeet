import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearNativeSupabaseAuthStorage } from '@/lib/authStorage';
import { invalidateCachedSession } from '@/lib/nativeAuthSession';
import {
  isInvalidRefreshTokenError,
  isNoSessionError,
  isRecoverableNativeAuthError,
  recoverNativeAuthSession,
} from '@/lib/nativeAuthRecovery';
import { resetAnalytics, trackEvent } from '@/lib/analytics';
import { logoutOneSignal } from '@/lib/onesignal';
import { clearLocalPauseKeys } from '@/lib/notificationPause';
import { clearRevenueCatUser } from '@/lib/revenuecat';
import { resolveEntryState as resolveCurrentEntryState, signInWithEmail, type OnboardingStatus } from '@/lib/authApi';
import { toError } from '@/lib/contractErrors';
import {
  getFallbackEntryState,
  getAuthProvider,
  getEntryStateOnboardingStatus,
  type EntryStateResponse,
} from '@shared/entryState';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { clearPreparedVideoDateEntryCache } from '@clientShared/matching/videoDatePrepareEntry';
import { removeAllRealtimeChannels } from '@/lib/realtimeLifecycle';
import { clearMyLocationDataCache } from '@/lib/myLocationData';
import { queryClient } from '@/lib/queryClient';
import {
  CLIENT_FEATURE_FLAG_QUERY_KEY,
  clearClientFeatureFlagCache,
  clientFeatureFlagQueryKey,
  hydrateNativeClientFeatureFlagCache,
  prefetchClientFeatureFlagsForUser,
} from '@/lib/clientFeatureFlags';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  entryState: EntryStateResponse | null;
  entryStateLoading: boolean;
  profilePresence: 'present' | 'missing' | 'unknown';
  onboardingStatus: OnboardingStatus;
  onboardingComplete: boolean | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshEntryState: () => Promise<EntryStateResponse | null>;
  refreshOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_SESSION_TIMEOUT_MS = 5_000;
const ENTRY_STATE_TIMEOUT_MS = 9_000;

function withNativeAuthTimeout<T>(
  promise: PromiseLike<T>,
  operation: string,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${operation}_timeout`)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [entryState, setEntryState] = useState<EntryStateResponse | null>(null);
  const [entryStateLoading, setEntryStateLoading] = useState(false);
  const currentUserId = session?.user?.id ?? null;
  const currentAuthProvider = getAuthProvider(session?.user);
  const authUserIdRef = useRef<string | null>(null);

  const clearFeatureFlagState = useCallback(async () => {
    await clearClientFeatureFlagCache();
    queryClient.removeQueries({ queryKey: [CLIENT_FEATURE_FLAG_QUERY_KEY] });
  }, []);

  const warmFeatureFlags = useCallback((userId: string) => {
    void hydrateNativeClientFeatureFlagCache()
      .then(() => prefetchClientFeatureFlagsForUser(userId))
      .then((evaluations) => {
        for (const evaluation of evaluations) {
          queryClient.setQueryData(clientFeatureFlagQueryKey(evaluation.flag, userId), evaluation);
        }
      })
      .catch(() => undefined);
  }, []);

  const clearAuthState = useCallback(() => {
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    void clearFeatureFlagState();
    authUserIdRef.current = null;
    setSession(null);
    setUser(null);
    setEntryState(null);
    setEntryStateLoading(false);
  }, [clearFeatureFlagState]);

  const applyAuthSession = useCallback((s: Session | null) => {
    const nextUserId = s?.user?.id ?? null;
    const previousUserId = authUserIdRef.current;
    authUserIdRef.current = nextUserId;
    if (!nextUserId) {
      clearPreparedVideoDateEntryCache();
      clearMyLocationDataCache();
      void clearFeatureFlagState();
      setEntryState(null);
      setEntryStateLoading(false);
    } else if (nextUserId !== previousUserId) {
      clearPreparedVideoDateEntryCache();
      clearMyLocationDataCache();
      if (previousUserId) {
        void clearFeatureFlagState();
      } else {
        queryClient.removeQueries({ queryKey: [CLIENT_FEATURE_FLAG_QUERY_KEY] });
      }
      // Clear stale entry state before session/user update so the new user is never
      // routed using the previous account's resolve_entry_state result.
      setEntryState(null);
      setEntryStateLoading(true);
    }
    setSession(s);
    setUser(s?.user ?? null);
    if (!s?.user) {
      setEntryState(null);
      setEntryStateLoading(false);
    }
  }, [clearFeatureFlagState]);

  const refreshEntryState = useCallback(async () => {
    if (!currentUserId) {
      setEntryState(null);
      return null;
    }

    setEntryStateLoading(true);
    const userId = currentUserId;
    try {
      const nextEntryState = await withNativeAuthTimeout(
        resolveCurrentEntryState(),
        'resolve_entry_state',
        ENTRY_STATE_TIMEOUT_MS,
      );
      if (authUserIdRef.current !== userId) return null;
      setEntryState(nextEntryState);
      rcBreadcrumb(RC_CATEGORY.authEntryState, 'entry_state_resolved', {
        state: nextEntryState.state,
        reason_code: nextEntryState.reason_code ?? null,
        evaluation_version: nextEntryState.evaluation_version ?? null,
      });
      trackEvent('entry_state_resolved', {
        state: nextEntryState.state,
        reason_code: nextEntryState.reason_code,
        platform: 'native',
        provider: currentAuthProvider,
        evaluation_version: nextEntryState.evaluation_version,
      });
      return nextEntryState;
    } catch (error) {
      const fallbackEntryState = getFallbackEntryState('resolver_exception');
      if (authUserIdRef.current !== userId) return null;
      setEntryState(fallbackEntryState);
      rcBreadcrumb(RC_CATEGORY.authEntryState, 'entry_state_resolved', {
        state: fallbackEntryState.state,
        reason_code: fallbackEntryState.reason_code ?? null,
        evaluation_version: fallbackEntryState.evaluation_version ?? null,
        fallback: true,
      });
      trackEvent('entry_state_resolved', {
        state: fallbackEntryState.state,
        reason_code: fallbackEntryState.reason_code,
        platform: 'native',
        provider: currentAuthProvider,
        evaluation_version: fallbackEntryState.evaluation_version,
        fallback: true,
      });
      if (__DEV__) {
        console.warn('[auth] entry state bootstrap failed:', error);
      }
      return fallbackEntryState;
    } finally {
      if (authUserIdRef.current === userId) setEntryStateLoading(false);
    }
  }, [currentAuthProvider, currentUserId]);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const subscribeAfterBootstrap = () => {
      const {
        data: { subscription: nextSubscription },
      } = supabase.auth.onAuthStateChange((_event, s) => {
        if (!isMounted) return;
        invalidateCachedSession();
        applyAuthSession(s);
      });
      subscription = nextSubscription;
    };

    const bootstrapAuth = async () => {
      try {
        const {
          data: { session: s },
          error,
        } = await withNativeAuthTimeout(
          supabase.auth.getSession(),
          'auth.getSession',
          AUTH_SESSION_TIMEOUT_MS,
        );

        if (error) {
          if (isRecoverableNativeAuthError(error)) {
            await recoverNativeAuthSession('bootstrap', error);
          } else if (__DEV__) {
            console.warn('[auth] getSession failed during bootstrap:', error.message);
          }

          if (!isMounted) return;
          invalidateCachedSession();
          clearAuthState();
          setLoading(false);
          subscribeAfterBootstrap();
          return;
        }

        if (!isMounted) return;
        if (s?.user?.id) {
          await hydrateNativeClientFeatureFlagCache();
        }
        applyAuthSession(s);
        setLoading(false);
      } catch (error) {
        if (isRecoverableNativeAuthError(error)) {
          await recoverNativeAuthSession('bootstrap', error);
        } else if (__DEV__) {
          console.warn('[auth] getSession threw during bootstrap:', error);
        }
        if (!isMounted) return;
        invalidateCachedSession();
        clearAuthState();
        setLoading(false);
      }

      if (!isMounted) return;
      subscribeAfterBootstrap();
    };

    void bootstrapAuth();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [applyAuthSession, clearAuthState]);

  useEffect(() => {
    authUserIdRef.current = currentUserId;
  }, [currentUserId]);

  // Sentry user context — parity with web `useAppBootstrap` (stable session user id only).
  useEffect(() => {
    if (loading) return;
    if (!currentUserId) {
      Sentry.setUser(null);
      return;
    }
    Sentry.setUser({ id: currentUserId });
  }, [loading, currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      warmFeatureFlags(currentUserId);
      setEntryStateLoading(true);
      void refreshEntryState();
    } else {
      setEntryState(null);
      setEntryStateLoading(false);
    }
  }, [currentUserId, refreshEntryState, warmFeatureFlags]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInWithEmail(email, password);
    if (!result.ok) {
      return { error: toError(result.error) };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    resetAnalytics();
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    removeAllRealtimeChannels(supabase, 'sign_out');
    const uid = currentUserId;
    invalidateCachedSession();
    void clearLocalPauseKeys();
    logoutOneSignal();
    if (uid) {
      void supabase
        .from('notification_preferences')
        .update({
          mobile_onesignal_player_id: null,
          mobile_onesignal_subscribed: false,
        })
        .eq('user_id', uid)
        .then(({ error }) => {
          if (error && __DEV__) console.warn('[signOut] notification_preferences:', error.message);
        });
    }
    void clearRevenueCatUser();

    const { error: signOutError } = await withNativeAuthTimeout(
      supabase.auth.signOut(),
      'auth.signOut',
      AUTH_SESSION_TIMEOUT_MS,
    ).catch((error) => ({ error }));
    if (signOutError) {
      if (isInvalidRefreshTokenError(signOutError) || isNoSessionError(signOutError)) {
        await recoverNativeAuthSession('sign-out', signOutError);
        invalidateCachedSession();
        await clearFeatureFlagState();
        clearAuthState();
        return;
      }
      if (__DEV__) {
        console.warn('[signOut] auth signOut failed; clearing local session:', signOutError);
      }
    }

    const storageCleanup = await clearNativeSupabaseAuthStorage();
    if (__DEV__ && storageCleanup.failedKeys.length > 0) {
      console.warn('[signOut] auth storage purge incomplete:', storageCleanup.failedKeys);
    }

    await clearFeatureFlagState();
    clearAuthState();
  }, [clearAuthState, clearFeatureFlagState, currentUserId]);

  const refreshOnboarding = useCallback(async () => {
    await refreshEntryState();
  }, [refreshEntryState]);

  const onboardingStatus = getEntryStateOnboardingStatus(entryState);
  const profilePresence =
    entryState?.state === 'missing_profile'
      ? 'missing'
      : entryState
        ? 'present'
        : 'unknown';

  const value: AuthContextValue = {
    user,
    session,
    loading,
    entryState,
    entryStateLoading,
    profilePresence,
    onboardingStatus,
    onboardingComplete: onboardingStatus === 'complete' ? true : onboardingStatus === 'incomplete' ? false : null,
    signIn,
    signOut,
    refreshEntryState,
    refreshOnboarding,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
