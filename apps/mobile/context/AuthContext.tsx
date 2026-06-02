import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import { Session, User } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';
import { clearNativeSupabaseAuthStorage } from '@/lib/authStorage';
import { invalidateCachedSession, primeCachedSession } from '@/lib/nativeAuthSession';
import {
  isInvalidRefreshTokenError,
  isNoSessionError,
  isRecoverableNativeAuthError,
  recoverNativeAuthSession,
} from '@/lib/nativeAuthRecovery';
import { resetAnalytics, trackEvent } from '@/lib/analytics';
import { disconnectOneSignalForLogout } from '@/lib/onesignal';
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
import { markMediaSdkForegroundReconcile } from '@clientShared/media-sdk';
import {
  applyManagedAuthRefreshSession,
  authRefreshDebugInfo,
  classifyAuthRefreshError,
  requestManagedAuthRefresh,
  shouldRefreshSessionSoon,
} from '@clientShared/authRefreshPolicy';

type AuthRedirectReason = 'session_expired' | null;

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authRedirectReason: AuthRedirectReason;
  entryState: EntryStateResponse | null;
  entryStateLoading: boolean;
  profilePresence: 'present' | 'missing' | 'unknown';
  onboardingStatus: OnboardingStatus;
  onboardingComplete: boolean | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshEntryState: () => Promise<EntryStateResponse | null>;
  refreshOnboarding: () => Promise<void>;
  markSessionExpired: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_SESSION_TIMEOUT_MS = 5_000;
const ENTRY_STATE_TIMEOUT_MS = 9_000;
const AUTH_SCOPED_EVENT_QUERY_KEYS = [
  ['event-details'],
  ['event-deck'],
  ['events-discover'],
  ['other-city-events'],
  ['next-registered-event'],
  ['event-registration-check'],
  ['event-attendees'],
  ['event-attendee-preview'],
  ['event-vibes-sent'],
  ['event-vibes-received'],
  ['video-date-queue-hint'],
  ['registered-upcoming-events-invite'],
  ['user-registered-event-ids'],
  ['user-registrations'],
] as const;

function clearAuthScopedEventQueries() {
  for (const queryKey of AUTH_SCOPED_EVENT_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [...queryKey] });
  }
}

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
  const [authRedirectReason, setAuthRedirectReason] = useState<AuthRedirectReason>(null);
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
      .then((cacheAcceptedEvaluations) => {
        for (const evaluation of cacheAcceptedEvaluations) {
          queryClient.setQueryData(clientFeatureFlagQueryKey(evaluation.flag, userId), evaluation);
        }
      })
      .catch(() => undefined);
  }, []);

  const reconcileMediaUploadQueues = useCallback((reason: string) => {
    void Promise.all([
      import('@/lib/mediaSdk/nativeVideoUploads').then(({ reconcileNativeVideoMediaSdkQueue }) =>
        reconcileNativeVideoMediaSdkQueue(reason),
      ),
      import('@/lib/mediaSdk/nativeStorageUploads').then(({ reconcileNativeStorageMediaSdkQueue }) =>
        reconcileNativeStorageMediaSdkQueue(reason),
      ),
    ]).catch(() => undefined);
  }, []);

  const clearAuthState = useCallback((redirectReason: AuthRedirectReason = null) => {
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    clearAuthScopedEventQueries();
    removeAllRealtimeChannels(supabase, redirectReason === 'session_expired' ? 'auth_session_expired' : 'auth_state_clear');
    void clearFeatureFlagState();
    authUserIdRef.current = null;
    setSession(null);
    setUser(null);
    setAuthRedirectReason(redirectReason);
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
      clearAuthScopedEventQueries();
      void clearFeatureFlagState();
      setEntryState(null);
      setEntryStateLoading(false);
    } else if (nextUserId !== previousUserId) {
      clearPreparedVideoDateEntryCache();
      clearMyLocationDataCache();
      clearAuthScopedEventQueries();
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
    if (s?.user) {
      setAuthRedirectReason(null);
    }
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

  const refreshBootstrapSessionIfNeeded = useCallback(async (bootSession: Session | null) => {
    if (!bootSession?.refresh_token || typeof bootSession.expires_at !== 'number') {
      return bootSession;
    }
    if (!shouldRefreshSessionSoon(bootSession, Date.now())) {
      primeCachedSession(bootSession);
      return bootSession;
    }

    try {
      const refreshResponse = await requestManagedAuthRefresh({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        refreshToken: bootSession.refresh_token,
      });
      const refreshedSession = await applyManagedAuthRefreshSession(supabase.auth, bootSession, refreshResponse);
      primeCachedSession(refreshedSession ?? bootSession);
      return refreshedSession ?? bootSession;
    } catch (error) {
      const kind = classifyAuthRefreshError(error);
      rcBreadcrumb(RC_CATEGORY.authBoot, 'bootstrap_refresh_failed', {
        kind,
        error: authRefreshDebugInfo(error),
      });
      if (__DEV__) {
        console.warn('[auth] bootstrap refresh failed:', authRefreshDebugInfo(error));
      }
      if (kind === 'invalid_session' || bootSession.expires_at * 1000 <= Date.now()) {
        await recoverNativeAuthSession('bootstrap', error);
        invalidateCachedSession();
        return null;
      }
      primeCachedSession(bootSession);
      return bootSession;
    }
  }, []);

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
          clearAuthState(isRecoverableNativeAuthError(error) ? 'session_expired' : null);
          setLoading(false);
          subscribeAfterBootstrap();
          return;
        }

        const readySession = await refreshBootstrapSessionIfNeeded(s);
        if (!isMounted) return;
        if (readySession?.user?.id) {
          await hydrateNativeClientFeatureFlagCache();
        }
        applyAuthSession(readySession);
        if (!readySession && s) {
          clearAuthState('session_expired');
        }
        setLoading(false);
      } catch (error) {
        if (isRecoverableNativeAuthError(error)) {
          await recoverNativeAuthSession('bootstrap', error);
        } else if (__DEV__) {
          console.warn('[auth] getSession threw during bootstrap:', error);
        }
        if (!isMounted) return;
        invalidateCachedSession();
        clearAuthState(isRecoverableNativeAuthError(error) ? 'session_expired' : null);
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
  }, [applyAuthSession, clearAuthState, refreshBootstrapSessionIfNeeded]);

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
      markMediaSdkForegroundReconcile(`native:${currentUserId}`);
      reconcileMediaUploadQueues('auth_session_start');
      setEntryStateLoading(true);
      void refreshEntryState();
    } else {
      setEntryState(null);
      setEntryStateLoading(false);
    }
  }, [currentUserId, reconcileMediaUploadQueues, refreshEntryState, warmFeatureFlags]);

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string | null) => {
    const result = await signInWithEmail(email, password, captchaToken);
    if (!result.ok) {
      return { error: toError(result.error) };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    resetAnalytics();
    clearPreparedVideoDateEntryCache();
    clearMyLocationDataCache();
    clearAuthScopedEventQueries();
    removeAllRealtimeChannels(supabase, 'sign_out');
    const uid = currentUserId;
    invalidateCachedSession();
    void clearLocalPauseKeys();
    if (uid) {
      await withNativeAuthTimeout(
        disconnectOneSignalForLogout(uid),
        'onesignal.logout_clear',
        3_000,
      ).catch((error) => {
        if (__DEV__) console.warn('[signOut] onesignal.logout_clear:', error);
      });
    } else {
      await disconnectOneSignalForLogout(null).catch(() => undefined);
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

  const markSessionExpired = useCallback(() => {
    const uid = currentUserId;
    void disconnectOneSignalForLogout(uid ?? null).catch((error) => {
      if (__DEV__) console.warn('[markSessionExpired] onesignal.logout_clear:', error);
    });
    void clearRevenueCatUser();
    clearAuthState('session_expired');
  }, [clearAuthState, currentUserId]);

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
    authRedirectReason,
    entryState,
    entryStateLoading,
    profilePresence,
    onboardingStatus,
    onboardingComplete: onboardingStatus === 'complete' ? true : onboardingStatus === 'incomplete' ? false : null,
    signIn,
    signOut,
    refreshEntryState,
    refreshOnboarding,
    markSessionExpired,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
