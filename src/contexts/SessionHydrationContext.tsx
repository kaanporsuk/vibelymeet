import React, { createContext, useContext, ReactNode } from "react";
import { useUserProfile } from "@/contexts/AuthContext";
import { useActiveSession, type ActiveSession } from "@/hooks/useActiveSession";

type SessionHydrationContextType = {
  activeSession: ActiveSession | null;
  hydrated: boolean;
  refetch: () => Promise<void>;
};

const SessionHydrationContext = createContext<SessionHydrationContextType | undefined>(undefined);

/**
 * Backend-derived active video / ready-gate session for shell routing and banners.
 * Independent of in-app notification inbox state.
 */
export function SessionHydrationProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const { activeSession, hydrated, refetch } = useActiveSession(user?.id);

  return (
    <SessionHydrationContext.Provider value={{ activeSession, hydrated, refetch }}>
      {children}
    </SessionHydrationContext.Provider>
  );
}

export function useSessionHydration() {
  const ctx = useContext(SessionHydrationContext);
  if (!ctx) {
    throw new Error("useSessionHydration must be used within SessionHydrationProvider");
  }
  return ctx;
}
