import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
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

  const refreshEntryState = useCallback(async () => {
    if (!currentUserId) {
      setEntryState(null);
      return null;
    }

    setEntryStateLoading(true);
    try {
      const nextEntryState = await resolveCurrentEntryState();
      setEntryState(nextEntryState);
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
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        const nextUserId = s?.user?.id ?? null;
        authUserIdRef.current = nextUserId;
        setEntryStateLoading(!!nextUserId);
        setSession(s);
        setUser(s?.user ?? null);
        if (!s?.user) {
          setEntryState(null);
          setEntryStateLoading(false);
        }
        setLoading(false);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        setEntryState(null);
        setEntryStateLoading(false);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      const nextUserId = s?.user?.id ?? null;
      const previousUserId = authUserIdRef.current;
      authUserIdRef.current = nextUserId;
      if (!nextUserId) {
        setEntryState(null);
        setEntryStateLoading(false);
      } else if (nextUserId !== previousUserId) {
        setEntryStateLoading(true);
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) {
        setEntryState(null);
        setEntryStateLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [refreshEntryState]);

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
    const { data: { session: current } } = await supabase.auth.getSession();
    const uid = current?.user?.id;
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
    await supabase.auth.signOut();
    setEntryState(null);
    setEntryStateLoading(false);
  }, []);

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
