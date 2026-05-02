import React, { createContext, useContext } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useActiveSession, type ActiveSession } from '@/lib/useActiveSession';

type SessionHydrationContextValue = {
  activeSession: ActiveSession | null;
  hydrated: boolean;
  refetch: () => Promise<void>;
};

const SessionHydrationContext = createContext<SessionHydrationContextValue | null>(null);

export function SessionHydrationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { activeSession, hydrated, refetch } = useActiveSession(user?.id);

  return (
    <SessionHydrationContext.Provider value={{ activeSession, hydrated, refetch }}>
      {children}
    </SessionHydrationContext.Provider>
  );
}

export function useSessionHydration() {
  const context = useContext(SessionHydrationContext);
  if (!context) throw new Error('useSessionHydration must be used within SessionHydrationProvider');
  return context;
}
