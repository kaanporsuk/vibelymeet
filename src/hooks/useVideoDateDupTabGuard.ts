import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEASE_MS = 15_000;
const TICK_MS = 5_000;
const SERVER_TTL_SECONDS = 30;
const SERVER_CLAIM_BACKOFF_BASE_MS = 1000;
const SERVER_CLAIM_BACKOFF_MAX_MS = 15000;

function storageKey(sessionId: string, profileId: string) {
  return `vibely_vd_tab_lease:${profileId}:${sessionId}`;
}

type LeasePayload = { owner: string; exp: number };

function nextServerClaimBackoffMs(failureCount: number) {
  return Math.min(SERVER_CLAIM_BACKOFF_MAX_MS, SERVER_CLAIM_BACKOFF_BASE_MS * 2 ** Math.min(failureCount, 4));
}

/**
 * Soft duplicate-tab guard for active video dates: one browser tab per participant
 * holds a short-lived localStorage lease. The local lease gives fast same-browser
 * feedback; the backend claim catches duplicate devices/tabs.
 */
export function useVideoDateDupTabGuard(
  sessionId: string | undefined,
  profileId: string | undefined,
  leaseActive: boolean,
) {
  const ownerRef = useRef(`vd-${Math.random().toString(36).slice(2)}`);
  const serverClaimInFlightRef = useRef(false);
  const serverClaimBackoffUntilRef = useRef(0);
  const serverClaimFailureCountRef = useRef(0);
  const [dupBlocked, setDupBlocked] = useState(false);
  const key = sessionId && profileId ? storageKey(sessionId, profileId) : null;

  const takeOver = useCallback(() => {
    if (!key || typeof localStorage === "undefined") return;
    const payload: LeasePayload = { owner: ownerRef.current, exp: Date.now() + LEASE_MS };
    localStorage.setItem(key, JSON.stringify(payload));
    serverClaimBackoffUntilRef.current = 0;
    serverClaimFailureCountRef.current = 0;
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
      serverClaimBackoffUntilRef.current = 0;
      serverClaimFailureCountRef.current = 0;
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
      const now = Date.now();
      if (serverClaimInFlightRef.current || now < serverClaimBackoffUntilRef.current) return;
      serverClaimInFlightRef.current = true;
      try {
        const { data, error } = await supabase.rpc("claim_video_date_surface", {
          p_session_id: sessionId,
          p_surface: "video_date",
          p_client_instance_id: owner,
          p_takeover: false,
          p_ttl_seconds: SERVER_TTL_SECONDS,
        });
        if (cancelled) return;
        const payload = data as { success?: boolean; code?: string; retryable?: boolean } | null;
        const blocked = payload?.code === "SURFACE_CLAIM_CONFLICT" && payload.retryable !== true;
        if (error || payload?.success === false) {
          setDupBlocked(blocked);
          if (!blocked) {
            serverClaimFailureCountRef.current += 1;
            serverClaimBackoffUntilRef.current =
              Date.now() + nextServerClaimBackoffMs(serverClaimFailureCountRef.current);
          }
          return;
        }
        serverClaimFailureCountRef.current = 0;
        serverClaimBackoffUntilRef.current = 0;
        setDupBlocked(false);
      } finally {
        serverClaimInFlightRef.current = false;
      }
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
