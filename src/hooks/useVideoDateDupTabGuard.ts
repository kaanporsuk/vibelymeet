import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEASE_MS = 15_000;
const TICK_MS = 5_000;
const SERVER_TTL_SECONDS = 30;
const SERVER_CLAIM_BACKOFF_BASE_MS = 1000;
const SERVER_CLAIM_BACKOFF_MAX_MS = 15000;
const SERVER_CLAIM_RELEASE_GRACE_MS = 1_000;

function storageKey(sessionId: string, profileId: string) {
  return `vibely_vd_tab_lease:${profileId}:${sessionId}`;
}

function serverClientStorageKey(sessionId: string, profileId: string) {
  return `vibely_vd_surface_client:${profileId}:${sessionId}`;
}

type LeasePayload = {
  owner: string;
  exp: number;
  serverClientInstanceId?: string;
};

type ActiveServerSurfaceOwner = {
  owner: string;
  serverClientInstanceId: string;
};

const activeServerSurfaceOwners = new Map<string, ActiveServerSurfaceOwner>();

function activeServerSurfaceKey(sessionId: string, profileId: string) {
  return `${profileId}:${sessionId}`;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function createServerClientInstanceId() {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `vd-web-${cryptoApi.randomUUID()}`;
  }
  return `vd-web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isValidServerClientInstanceId(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 120;
}

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
  const ownerRef = useRef(`vd-tab-${Math.random().toString(36).slice(2)}`);
  const serverClientInstanceRef = useRef<string | null>(null);
  const serverClaimInFlightRef = useRef(false);
  const serverClaimBackoffUntilRef = useRef(0);
  const serverClaimFailureCountRef = useRef(0);
  const [dupBlocked, setDupBlocked] = useState(false);
  const key = sessionId && profileId ? storageKey(sessionId, profileId) : null;
  const activeKey = sessionId && profileId ? activeServerSurfaceKey(sessionId, profileId) : null;

  const resolveServerClientInstanceId = useCallback((): string => {
    if (!sessionId || !profileId) {
      const fallback =
        serverClientInstanceRef.current ?? createServerClientInstanceId();
      serverClientInstanceRef.current = fallback;
      return fallback;
    }

    const storage = getLocalStorage();
    const storageIdKey = serverClientStorageKey(sessionId, profileId);
    if (storage) {
      try {
        const stored = storage.getItem(storageIdKey);
        if (isValidServerClientInstanceId(stored)) {
          serverClientInstanceRef.current = stored;
          return stored;
        }
      } catch {
        // localStorage is best-effort; a memory instance still works with the server reclaim guard.
      }
    }

    const next = createServerClientInstanceId();
    serverClientInstanceRef.current = next;
    if (storage) {
      try {
        storage.setItem(storageIdKey, next);
      } catch {
        // Persistence failure should not block date entry.
      }
    }
    return next;
  }, [profileId, sessionId]);

  const takeOver = useCallback(() => {
    if (!key) return;
    const storage = getLocalStorage();
    const serverClientInstanceId = resolveServerClientInstanceId();
    const payload: LeasePayload = {
      owner: ownerRef.current,
      exp: Date.now() + LEASE_MS,
      serverClientInstanceId,
    };
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify(payload));
      } catch {
        // Local duplicate-tab feedback is best-effort; the server claim below is authoritative.
      }
    }
    serverClaimBackoffUntilRef.current = 0;
    serverClaimFailureCountRef.current = 0;
    if (sessionId) {
      void supabase.rpc("claim_video_date_surface", {
        p_session_id: sessionId,
        p_surface: "video_date",
        p_client_instance_id: serverClientInstanceId,
        p_takeover: true,
        p_ttl_seconds: SERVER_TTL_SECONDS,
      });
    }
    setDupBlocked(false);
  }, [key, resolveServerClientInstanceId, sessionId]);

  useEffect(() => {
    if (!key || typeof window === "undefined" || !leaseActive) {
      serverClaimBackoffUntilRef.current = 0;
      serverClaimFailureCountRef.current = 0;
      setDupBlocked(false);
      return;
    }
    const owner = ownerRef.current;
    const serverClientInstanceId = resolveServerClientInstanceId();
    const storage = getLocalStorage();
    let cancelled = false;
    if (activeKey) {
      activeServerSurfaceOwners.set(activeKey, {
        owner,
        serverClientInstanceId,
      });
    }

    const readLease = (): LeasePayload | null => {
      try {
        const raw = storage?.getItem(key);
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
          p_client_instance_id: serverClientInstanceId,
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
      const payload: LeasePayload = {
        owner,
        exp: now + LEASE_MS,
        serverClientInstanceId,
      };
      try {
        storage?.setItem(key, JSON.stringify(payload));
      } catch {
        // Local lease persistence can fail in hardened browsers; keep renewing the server claim.
      }
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
        try {
          storage?.removeItem(key);
        } catch {
          // Best-effort cleanup only.
        }
      }
      const activeOwner = activeKey
        ? activeServerSurfaceOwners.get(activeKey)
        : null;
      if (
        activeKey &&
        activeOwner?.owner === owner &&
        activeOwner.serverClientInstanceId === serverClientInstanceId
      ) {
        activeServerSurfaceOwners.delete(activeKey);
      }
      if (sessionId) {
        window.setTimeout(() => {
          if (
            activeKey &&
            activeServerSurfaceOwners.get(activeKey)?.serverClientInstanceId ===
              serverClientInstanceId
          ) {
            return;
          }
          const latestLease = readLease();
          if (
            latestLease?.serverClientInstanceId === serverClientInstanceId &&
            latestLease.exp > Date.now()
          ) {
            return;
          }
          void supabase.rpc("release_video_date_surface_claim", {
            p_session_id: sessionId,
            p_client_instance_id: serverClientInstanceId,
          });
        }, SERVER_CLAIM_RELEASE_GRACE_MS);
      }
    };
  }, [activeKey, key, leaseActive, resolveServerClientInstanceId, sessionId]);

  return { dupBlocked, takeOver };
}
