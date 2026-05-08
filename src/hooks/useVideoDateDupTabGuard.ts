import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEASE_MS = 5000;
const TICK_MS = 2000;
const SERVER_TTL_SECONDS = 12;

function storageKey(sessionId: string) {
  return `vibely_vd_tab_lease:${sessionId}`;
}

type LeasePayload = { owner: string; exp: number };

/**
 * Soft duplicate-tab guard for active video dates: one browser tab holds a short-lived localStorage lease.
 * The local lease gives fast same-browser feedback; the backend claim catches duplicate devices/tabs.
 */
export function useVideoDateDupTabGuard(sessionId: string | undefined, leaseActive: boolean) {
  const ownerRef = useRef(`vd-${Math.random().toString(36).slice(2)}`);
  const [dupBlocked, setDupBlocked] = useState(false);
  const key = sessionId ? storageKey(sessionId) : null;

  const takeOver = useCallback(() => {
    if (!key || typeof localStorage === "undefined") return;
    const payload: LeasePayload = { owner: ownerRef.current, exp: Date.now() + LEASE_MS };
    localStorage.setItem(key, JSON.stringify(payload));
    if (sessionId) {
      void supabase.rpc("claim_video_date_surface", {
        p_session_id: sessionId,
        p_surface: "video_date",
        p_client_instance_id: ownerRef.current,
        p_takeover: true,
        p_ttl_seconds: SERVER_TTL_SECONDS,
      });
    }
    setDupBlocked(false);
  }, [key, sessionId]);

  useEffect(() => {
    if (!key || typeof window === "undefined" || !leaseActive) {
      setDupBlocked(false);
      return;
    }
    const owner = ownerRef.current;
    let cancelled = false;

    const readLease = (): LeasePayload | null => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as LeasePayload;
      } catch {
        return null;
      }
    };

    const claimServerSurface = async () => {
      if (!sessionId) return;
      const { data, error } = await supabase.rpc("claim_video_date_surface", {
        p_session_id: sessionId,
        p_surface: "video_date",
        p_client_instance_id: owner,
        p_takeover: false,
        p_ttl_seconds: SERVER_TTL_SECONDS,
      });
      if (cancelled) return;
      const payload = data as { success?: boolean; code?: string } | null;
      if (error || payload?.success === false) {
        setDupBlocked(payload?.code === "SURFACE_CLAIM_CONFLICT");
        return;
      }
      setDupBlocked(false);
    };

    const tick = () => {
      const now = Date.now();
      const cur = readLease();
      if (cur && cur.owner !== owner && cur.exp > now) {
        setDupBlocked(true);
        return;
      }
      setDupBlocked(false);
      const payload: LeasePayload = { owner, exp: now + LEASE_MS };
      localStorage.setItem(key, JSON.stringify(payload));
      void claimServerSurface();
    };

    tick();
    const iv = setInterval(tick, TICK_MS);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const cur = JSON.parse(e.newValue) as LeasePayload;
        if (cur.owner !== owner && cur.exp > Date.now()) {
          setDupBlocked(true);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener("storage", onStorage);
      const cur = readLease();
      if (cur?.owner === owner) {
        localStorage.removeItem(key);
      }
      if (sessionId) {
        void supabase.rpc("release_video_date_surface_claim", {
          p_session_id: sessionId,
          p_client_instance_id: owner,
        });
      }
    };
  }, [key, leaseActive, sessionId]);

  return { dupBlocked, takeOver };
}
