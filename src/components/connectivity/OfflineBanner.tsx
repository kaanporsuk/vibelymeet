import { useCallback, useEffect, useRef, useState } from "react";
import { getHealthUrl } from "@/lib/healthUrl";

type NetState = "online" | "reconnecting" | "offline";

async function probeHealthOk(timeoutMs: number): Promise<boolean> {
  const url = getHealthUrl();
  if (!url) return true;
  if (typeof AbortSignal.timeout === "function") {
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function useWebConnectivity(): NetState {
  const [state, setStateRaw] = useState<NetState>("online");
  const startupGraceRef = useRef(true);
  const probeLoopRef = useRef<number | null>(null);
  const debounceOfflineRef = useRef<number | null>(null);
  const stabilityRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setNetState = useCallback((next: NetState | ((s: NetState) => NetState)) => {
    setStateRaw((prev) => {
      const resolved = typeof next === "function" ? (next as (s: NetState) => NetState)(prev) : next;
      if (startupGraceRef.current && resolved !== "online") return prev;
      return resolved;
    });
  }, []);

  function clearProbeLoop() {
    if (probeLoopRef.current != null) {
      window.clearTimeout(probeLoopRef.current);
      probeLoopRef.current = null;
    }
  }

  const probe = useCallback(async () => {
    if (!mountedRef.current) return;
    clearProbeLoop();
    const ok = await probeHealthOk(8000);
    if (!mountedRef.current) return;
    if (ok) {
      if (stabilityRef.current != null) window.clearTimeout(stabilityRef.current);
      stabilityRef.current = window.setTimeout(async () => {
        stabilityRef.current = null;
        const confirm = await probeHealthOk(5000);
        if (!mountedRef.current) return;
        if (confirm) {
          setNetState("online");
        } else {
          setNetState("reconnecting");
          probeLoopRef.current = window.setTimeout(() => {
            if (mountedRef.current) void probe();
          }, 8000);
        }
      }, 2000);
      return;
    }
    if (!mountedRef.current) return;
    setNetState((s) => (s === "offline" || s === "online" ? "reconnecting" : s));
    probeLoopRef.current = window.setTimeout(() => {
      if (mountedRef.current) void probe();
    }, 8000);
  }, [setNetState]);

  useEffect(() => {
    const pendingTimers: number[] = [];
    const id = window.setTimeout(() => {
      startupGraceRef.current = false;
      if (mountedRef.current) void probe();
    }, 5000);
    pendingTimers.push(id);
    return () => {
      pendingTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [probe]);

  useEffect(() => {
    const pendingTimers: number[] = [];

    function scheduleProbe(delayMs: number) {
      const timerId = window.setTimeout(() => {
        if (mountedRef.current) void probe();
      }, delayMs);
      pendingTimers.push(timerId);
      return timerId;
    }

    const scheduleOffline = () => {
      if (debounceOfflineRef.current != null) {
        window.clearTimeout(debounceOfflineRef.current);
        debounceOfflineRef.current = null;
      }
      debounceOfflineRef.current = window.setTimeout(() => {
        debounceOfflineRef.current = null;
        if (!mountedRef.current) return;
        setNetState("offline");
        const loopId = window.setTimeout(() => {
          if (mountedRef.current) void probe();
        }, 8000);
        probeLoopRef.current = loopId;
        pendingTimers.push(loopId);
      }, 2000);
      if (debounceOfflineRef.current != null) {
        pendingTimers.push(debounceOfflineRef.current);
      }
    };

    const onBrowserOffline = () => {
      if (stabilityRef.current != null) {
        window.clearTimeout(stabilityRef.current);
        stabilityRef.current = null;
      }
      scheduleOffline();
    };

    const onBrowserOnline = () => {
      if (debounceOfflineRef.current != null) {
        window.clearTimeout(debounceOfflineRef.current);
        debounceOfflineRef.current = null;
      }
      setNetState("reconnecting");
      scheduleProbe(400);
    };

    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);

    scheduleProbe(400);

    return () => {
      window.removeEventListener("offline", onBrowserOffline);
      window.removeEventListener("online", onBrowserOnline);
      pendingTimers.forEach((t) => window.clearTimeout(t));
      clearProbeLoop();
      if (debounceOfflineRef.current != null) {
        window.clearTimeout(debounceOfflineRef.current);
        debounceOfflineRef.current = null;
      }
      if (stabilityRef.current != null) {
        window.clearTimeout(stabilityRef.current);
        stabilityRef.current = null;
      }
    };
  }, [probe, setNetState]);

  return state;
}

export function OfflineBanner() {
  const state = useWebConnectivity();
  const [showToast, setShowToast] = useState(false);
  const prevState = useRef(state);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    if (
      state === "online" &&
      (prevState.current === "offline" || prevState.current === "reconnecting")
    ) {
      setShowToast(true);
      toastTimer.current = window.setTimeout(() => setShowToast(false), 3000);
    }
    prevState.current = state;
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [state]);

  const AMBER = "#F59E0B";
  const CYAN = "#22D3EE";

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {state === "offline" && "You're offline. Reconnecting automatically."}
        {state === "reconnecting" && "Reconnecting to Vibely…"}
        {showToast && "Back online. Live updates resumed."}
      </div>

      {(state === "offline" || state === "reconnecting") && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            borderRadius: 16,
            border: `1px solid ${AMBER}55`,
            backgroundColor: "rgba(28, 26, 46, 0.97)",
            backdropFilter: "blur(16px)",
            boxShadow: `0 4px 32px rgba(0,0,0,0.4), 0 0 0 1px ${AMBER}22`,
            minWidth: 240,
            maxWidth: 400,
            animation: "vibelySlideDown 0.3s ease",
          }}
          role="alert"
          aria-live="assertive"
        >
          <span style={{ fontSize: 18 }}>{state === "reconnecting" ? "⟳" : "☁"}</span>
          <div>
            <div
              style={{
                color: "#F5F5F5",
                fontSize: 14,
                fontWeight: 600,
                lineHeight: "1.3",
              }}
            >
              {state === "reconnecting" ? "Reconnecting…" : "You're offline"}
            </div>
            <div
              style={{
                color: "rgba(245,245,245,0.55)",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {state === "reconnecting"
                ? "Restoring your connection"
                : "We'll reconnect automatically"}
            </div>
          </div>
        </div>
      )}

      {showToast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 16px",
            borderRadius: 20,
            border: `1px solid ${CYAN}55`,
            backgroundColor: "rgba(10, 30, 30, 0.97)",
            backdropFilter: "blur(16px)",
            fontSize: 13,
            fontWeight: 600,
            color: CYAN,
            animation: "vibelySlideDown 0.3s ease",
            whiteSpace: "nowrap",
          }}
          role="status"
        >
          ✦ Back online
          <span style={{ fontWeight: 400, color: `${CYAN}99`, marginLeft: 4 }}>
            · Live updates resumed
          </span>
        </div>
      )}

      <style>{`
        @keyframes vibelySlideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  );
}
