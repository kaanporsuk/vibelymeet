import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { resetAnalytics } from '@/lib/analytics';
import { logoutOneSignal } from '@/lib/onesignal';
import { clearLocalPauseKeys } from '@/lib/notificationPause';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  onboardingComplete: boolean | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  const resolveOnboarding = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', userId)
        .maybeSingle();
      setOnboardingComplete(data?.onboarding_complete === true);
    } catch {
      setOnboardingComplete(false);
    }
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
          setOnboardingComplete(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        setOnboardingComplete(null);
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
        setOnboardingComplete(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [resolveOnboarding]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error ?? null };
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
    await supabase.auth.signOut();
    setOnboardingComplete(null);
  }, []);

  const refreshOnboarding = useCallback(async () => {
    if (user?.id) await resolveOnboarding(user.id);
  }, [user?.id, resolveOnboarding]);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    onboardingComplete,
    signIn,
    signUp,
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
