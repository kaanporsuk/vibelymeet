import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { resetAnalytics } from '@/lib/analytics';
import { logoutOneSignal } from '@/lib/onesignal';
import { clearLocalPauseKeys } from '@/lib/notificationPause';
import { clearRevenueCatUser } from '@/lib/revenuecat';
import { getOnboardingStatus, signInWithEmail, type OnboardingStatus } from '@/lib/authApi';
import { toError } from '@/lib/contractErrors';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profilePresence: 'present' | 'missing' | 'unknown';
  onboardingStatus: OnboardingStatus;
  onboardingComplete: boolean | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profilePresence, setProfilePresence] = useState<'present' | 'missing' | 'unknown'>('unknown');
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>('unknown');

  const resolveOnboarding = useCallback(async (userId: string) => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      setProfilePresence('unknown');
      setOnboardingStatus('unknown');
      return;
    }

    if (!profile) {
      setProfilePresence('missing');
      setOnboardingStatus('unknown');
      return;
    }

    setProfilePresence('present');
    const status = await getOnboardingStatus(userId);
    setOnboardingStatus(status);
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          resolveOnboarding(s.user.id);
        } else {
          setProfilePresence('unknown');
          setOnboardingStatus('unknown');
        }
        setLoading(false);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        setProfilePresence('unknown');
        setOnboardingStatus('unknown');
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        resolveOnboarding(s.user.id);
      } else {
        setProfilePresence('unknown');
        setOnboardingStatus('unknown');
      }
    });

    return () => subscription.unsubscribe();
  }, [resolveOnboarding]);

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
    setProfilePresence('unknown');
    setOnboardingStatus('unknown');
  }, []);

  const refreshOnboarding = useCallback(async () => {
    if (user?.id) await resolveOnboarding(user.id);
  }, [user?.id, resolveOnboarding]);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    profilePresence,
    onboardingStatus,
    onboardingComplete: onboardingStatus === 'complete' ? true : onboardingStatus === 'incomplete' ? false : null,
    signIn,
    signOut,
    refreshOnboarding,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
