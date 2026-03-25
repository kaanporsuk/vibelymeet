import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session, User as SupabaseUser } from "@supabase/supabase-js";

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
  isVerified: boolean;
  isPaused: boolean;
  pauseUntil: Date | null;
}

interface SessionContextType {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineAtBoot: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
}

interface ProfileContextType {
  user: User | null;
  refreshProfile: () => Promise<void>;
}

interface EntitlementsContextType {
  isAdmin: boolean;
  pauseAccount: (duration: 'day' | 'week' | 'indefinite') => void;
  resumeAccount: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);
const ProfileContext = createContext<ProfileContextType | undefined>(undefined);
const EntitlementsContext = createContext<EntitlementsContextType | undefined>(undefined);

function transformSupabaseUser(supabaseUser: SupabaseUser, profileData?: Record<string, unknown>): User {
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
    isVerified: (profileData?.photo_verified as boolean) || false,
    isPaused: (profileData?.is_paused as boolean) || false,
    pauseUntil: profileData?.paused_until ? new Date(profileData.paused_until as string) : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOfflineAtBoot, setIsOfflineAtBoot] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session?.user && !navigator.onLine) {
        setIsOfflineAtBoot(true);
      }
      setIsLoading(false);
    }).catch(() => {
      if (!navigator.onLine) {
        setIsOfflineAtBoot(true);
      }
      setIsLoading(false);
    });

    // Clear offline-at-boot flag when connectivity returns
    const handleOnline = () => setIsOfflineAtBoot(false);
    window.addEventListener("online", handleOnline);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      setUser(null);
      return;
    }

    const userId = session.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "id, name, age, gender, job, height_cm, location, about_me, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at, is_premium, photo_verified, is_paused, paused_at, paused_until, pause_reason"
      )
      .eq("id", userId)
      .maybeSingle();

    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (supabaseUser) {
      setUser(transformSupabaseUser(supabaseUser, profile || undefined));
    }
  }, [session]);

  const checkAdminRole = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    
    setIsAdmin(!!data);
  };

  useEffect(() => {
    if (session?.user) {
      void refreshProfile();
      void checkAdminRole(session.user.id);
    } else {
      setUser(null);
      setIsAdmin(false);
    }
  }, [session?.user, refreshProfile]);

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

    if (data.user) {
      const refId = localStorage.getItem("vibely_referrer_id");
      
      await supabase.from('profiles').insert({
        id: data.user.id,
        name,
        age: 25,
        gender: 'prefer_not_to_say',
        ...(refId ? { referred_by: refId } : {}),
      });

      if (refId) localStorage.removeItem("vibely_referrer_id");
    }

    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const logout = async () => {
    const userId = session?.user?.id;
    if (userId) {
      try {
        await supabase
          .from("notification_preferences")
          .update({
            onesignal_player_id: null,
            onesignal_subscribed: false,
          })
          .eq("user_id", userId);
      } catch {
        /* don't block logout */
      }
    }
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
  };

  const pauseAccount = async (duration: 'day' | 'week' | 'indefinite') => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke('account-pause', {
      body: { duration },
    });
    if (!error && data?.success) {
      await refreshProfile();
    }
  };

  const resumeAccount = async () => {
    if (!user) return;
    const { data, error } = await supabase.functions.invoke('account-resume', { body: {} });
    if (!error && data?.success) {
      await refreshProfile();
    }
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        isOfflineAtBoot,
        signUp,
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
        <EntitlementsContext.Provider
          value={{
            isAdmin,
            pauseAccount,
            resumeAccount,
          }}
        >
          {children}
        </EntitlementsContext.Provider>
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

export function useEntitlements() {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) {
    throw new Error("useEntitlements must be used within an AuthProvider");
  }
  return ctx;
}
