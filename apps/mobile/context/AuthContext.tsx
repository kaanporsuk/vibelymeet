import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearNativeSupabaseAuthStorage } from '@/lib/authStorage';
import { getCachedSession, invalidateCachedSession } from '@/lib/nativeAuthSession';
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
  getAuthProvider,
  getEntryStateOnboardingStatus,
  type EntryStateResponse,
} from '@shared/entryState';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { clearPreparedVideoDateEntryCache } from '@clientShared/matching/videoDatePrepareEntry';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [entryState, setEntryState] = useState<EntryStateResponse | null>(null);
  const [entryStateLoading, setEntryStateLoading] = useState(false);
  const currentUserId = session?.user?.id ?? null;
  const currentAuthProvider = getAuthProvider(session?.user);
  const authUserIdRef = useRef<string | null>(null);

  const clearAuthState = useCallback(() => {
    clearPreparedVideoDateEntryCache();
    authUserIdRef.current = null;
    setSession(null);
    setUser(null);
    setEntryState(null);
    setEntryStateLoading(false);
  }, []);

  const applyAuthSession = useCallback((s: Session | null) => {
    const nextUserId = s?.user?.id ?? null;
    const previousUserId = authUserIdRef.current;
    authUserIdRef.current = nextUserId;
    if (!nextUserId) {
      clearPreparedVideoDateEntryCache();
      setEntryState(null);
      setEntryStateLoading(false);
    } else if (nextUserId !== previousUserId) {
      clearPreparedVideoDateEntryCache();
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
  }, []);

  const refreshEntryState = useCallback(async () => {
    if (!currentUserId) {
      setEntryState(null);
      return null;
    }

    setEntryStateLoading(true);
    try {
      const nextEntryState = await resolveCurrentEntryState();
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
    } finally {
      setEntryStateLoading(false);
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
        } = await supabase.auth.getSession();

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
      setEntryStateLoading(true);
      void refreshEntryState();
    } else {
      setEntryState(null);
      setEntryStateLoading(false);
    }
  }, [currentUserId, refreshEntryState]);

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
    const current = await getCachedSession();
    const uid = current?.user?.id;
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

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      if (isInvalidRefreshTokenError(signOutError) || isNoSessionError(signOutError)) {
        await recoverNativeAuthSession('sign-out', signOutError);
        invalidateCachedSession();
        clearAuthState();
        return;
      }
      throw signOutError;
    }

    const storageCleanup = await clearNativeSupabaseAuthStorage();
    if (__DEV__ && storageCleanup.failedKeys.length > 0) {
      console.warn('[signOut] auth storage purge incomplete:', storageCleanup.failedKeys);
    }

    clearAuthState();
  }, [clearAuthState]);

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
