import { useCallback, useEffect, useRef, useState } from "react";

const LEASE_MS = 5000;
const TICK_MS = 2000;

function storageKey(sessionId: string) {
  return `vibely_vd_tab_lease:${sessionId}`;
}

type LeasePayload = { owner: string; exp: number };

/**
 * Soft duplicate-tab guard for active video dates: one browser tab holds a short-lived localStorage lease.
 * Does not change backend state. Second tab can "take over" (steals lease; first tab must end).
 */
export function useVideoDateDupTabGuard(sessionId: string | undefined, leaseActive: boolean) {
  const ownerRef = useRef(`vd-${Math.random().toString(36).slice(2)}`);
  const [dupBlocked, setDupBlocked] = useState(false);
  const key = sessionId ? storageKey(sessionId) : null;

  const takeOver = useCallback(() => {
    if (!key || typeof localStorage === "undefined") return;
    const payload: LeasePayload = { owner: ownerRef.current, exp: Date.now() + LEASE_MS };
    localStorage.setItem(key, JSON.stringify(payload));
    setDupBlocked(false);
  }, [key]);

  useEffect(() => {
    if (!key || typeof window === "undefined" || !leaseActive) {
      setDupBlocked(false);
      return;
    }

    const readLease = (): LeasePayload | null => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as LeasePayload;
      } catch {
        return null;
      }
    };

    const tick = () => {
      const now = Date.now();
      const cur = readLease();
      if (cur && cur.owner !== ownerRef.current && cur.exp > now) {
        setDupBlocked(true);
        return;
      }
      setDupBlocked(false);
      const payload: LeasePayload = { owner: ownerRef.current, exp: now + LEASE_MS };
      localStorage.setItem(key, JSON.stringify(payload));
    };

    tick();
    const iv = setInterval(tick, TICK_MS);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const cur = JSON.parse(e.newValue) as LeasePayload;
        if (cur.owner !== ownerRef.current && cur.exp > Date.now()) {
          setDupBlocked(true);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      clearInterval(iv);
      window.removeEventListener("storage", onStorage);
      const cur = readLease();
      if (cur?.owner === ownerRef.current) {
        localStorage.removeItem(key);
      }
    };
  }, [key, leaseActive]);

  return { dupBlocked, takeOver };
}
