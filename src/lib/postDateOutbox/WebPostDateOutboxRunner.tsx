import { useEffect } from "react";
import { useUserProfile } from "@/contexts/AuthContext";
import { drainWebPostDateOutbox } from "./execute";

const DRAIN_INTERVAL_MS = 15_000;

export function WebPostDateOutboxRunner() {
  const { user } = useUserProfile();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const drain = () => {
      if (cancelled) return;
      void drainWebPostDateOutbox(userId);
    };

    drain();
    const intervalId = setInterval(drain, DRAIN_INTERVAL_MS);
    window.addEventListener("online", drain);
    document.addEventListener("visibilitychange", drain);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("online", drain);
      document.removeEventListener("visibilitychange", drain);
    };
  }, [userId]);

  return null;
}

