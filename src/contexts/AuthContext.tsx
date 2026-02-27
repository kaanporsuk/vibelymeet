import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  isPaused: boolean;
  pauseUntil: Date | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  pauseAccount: (duration: 'day' | 'week' | 'indefinite') => void;
  resumeAccount: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function transformSupabaseUser(supabaseUser: SupabaseUser, profileData?: Record<string, unknown>): User {
  return {
    id: supabaseUser.id,
    name: (profileData?.name as string) || supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'User',
    email: supabaseUser.email || '',
    avatarUrl: (profileData?.avatar_url as string) || supabaseUser.user_metadata?.avatar_url || '',
    isPaused: (profileData?.is_paused as boolean) || false,
    pauseUntil: profileData?.pause_until ? new Date(profileData.pause_until as string) : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (session?.user) {
          // Defer profile fetch to avoid deadlock
          setTimeout(() => {
            fetchUserProfile(session.user.id);
            checkAdminRole(session.user.id);
          }, 0);
        } else {
          setUser(null);
          setIsAdmin(false);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchUserProfile(session.user.id);
        checkAdminRole(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (userId: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at')
      .eq('id', userId)
      .maybeSingle();

    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (supabaseUser) {
      setUser(transformSupabaseUser(supabaseUser, profile || undefined));
    }
  };

  const checkAdminRole = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    
    setIsAdmin(!!data);
  };

  const signUp = async (email: string, password: string, name: string): Promise<{ error: Error | null }> => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { name }
      }
    });

    if (error) return { error };

    // Create profile if user was created
    if (data.user) {
      // Check for referral
      const refId = localStorage.getItem("vibely_referrer_id");
      
      await supabase.from('profiles').insert({
        id: data.user.id,
        name,
        age: 25,
        gender: 'prefer_not_to_say',
        ...(refId ? { referred_by: refId } : {}),
      });

      // Clean up referral
      if (refId) localStorage.removeItem("vibely_referrer_id");
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  };

  const pauseAccount = async (duration: 'day' | 'week' | 'indefinite') => {
    if (!user) return;
    
    let pauseUntil: Date | null = null;
    const now = new Date();
    
    switch (duration) {
      case 'day':
        pauseUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'week':
        pauseUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'indefinite':
        pauseUntil = null;
        break;
    }
    
    setUser({ ...user, isPaused: true, pauseUntil });
  };

  const resumeAccount = async () => {
    if (!user) return;
    setUser({ ...user, isPaused: false, pauseUntil: null });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAuthenticated: !!session,
        isLoading,
        isAdmin,
        signUp,
        signIn,
        logout,
        pauseAccount,
        resumeAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
