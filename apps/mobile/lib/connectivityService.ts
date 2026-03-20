/**
 * Production connectivity: NetInfo is a hint; truth = health probe + 2s stability.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type NetworkState = 'online' | 'reconnecting' | 'offline';

type Listener = (state: NetworkState) => void;

function getHealthUrl(): string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/functions/v1/health`;
}

function abortAfter(ms: number): AbortSignal {
  // AbortSignal.timeout() auto-clears — no orphaned timers
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  // Fallback for older runtimes
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  // Return a signal that also clears the timer
  const originalAbort = c.abort.bind(c);
  c.abort = () => {
    clearTimeout(t);
    originalAbort();
  };
  return c.signal;
}

async function probeHealthOk(timeoutMs: number): Promise<boolean> {
  const url = getHealthUrl();
  if (!url) return true;
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: abortAfter(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

class ConnectivityService {
  private state: NetworkState = 'online';
  private listeners: Set<Listener> = new Set();
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private offlineDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private probeLoopTimer: ReturnType<typeof setTimeout> | null = null;
  private netUnsub: (() => void) | null = null;
  private started = false;
  private startupGrace = true;

  init() {
    if (this.started) return;
    this.started = true;

    setTimeout(() => {
      this.startupGrace = false;
      void this.probe();
    }, 5000);

    const url = getHealthUrl();
    if (url) {
      NetInfo.configure({
        reachabilityUrl: url,
        reachabilityTest: async (response) => response.status === 200,
        reachabilityLongTimeout: 60 * 1000,
        reachabilityShortTimeout: 5 * 1000,
        reachabilityRequestTimeout: 10 * 1000,
      });
    }

    this.netUnsub = NetInfo.addEventListener((netState) => {
      this.handleNetInfo(netState);
    });

    void NetInfo.fetch().then((s) => this.handleNetInfo(s));

    // Silent verify shortly after launch (does not flash offline if OK)
    this.scheduleProbe(400);
  }

  private handleNetInfo(netState: NetInfoState) {
    const disconnected = netState.isConnected === false;
    const definitelyUnreachable = netState.isInternetReachable === false;

    if (disconnected || definitelyUnreachable) {
      this.scheduleOffline();
      return;
    }

    if (this.offlineDebounceTimer) {
      clearTimeout(this.offlineDebounceTimer);
      this.offlineDebounceTimer = null;
    }
    if (this.probeLoopTimer) {
      clearTimeout(this.probeLoopTimer);
      this.probeLoopTimer = null;
    }
    this.scheduleProbe(800);
  }

  private scheduleOffline() {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.offlineDebounceTimer) clearTimeout(this.offlineDebounceTimer);
    this.offlineDebounceTimer = setTimeout(() => {
      this.offlineDebounceTimer = null;
      if (this.state !== 'offline') {
        this.setState('offline');
      }
      this.startProbeLoop();
    }, 2000);
  }

  private scheduleProbe(delayMs: number) {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      void this.probe();
    }, delayMs);
  }

  private async probe() {
    if (this.probeLoopTimer) {
      clearTimeout(this.probeLoopTimer);
      this.probeLoopTimer = null;
    }

    const ok = await probeHealthOk(8000);
    if (ok) {
      if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
      this.stabilityTimer = setTimeout(async () => {
        this.stabilityTimer = null;
        const confirm = await probeHealthOk(5000);
        if (confirm) {
          this.setState('online');
        } else {
          this.setState('reconnecting');
          this.startProbeLoop();
        }
      }, 2000);
      return;
    }

    if (this.state === 'offline' || this.state === 'online') {
      this.setState('reconnecting');
    }
    this.startProbeLoop();
  }

  private startProbeLoop() {
    if (this.probeLoopTimer) clearTimeout(this.probeLoopTimer);
    this.probeLoopTimer = setTimeout(() => {
      this.probeLoopTimer = null;
      void this.probe();
    }, 8000);
  }

  private setState(next: NetworkState) {
    if (this.state === next) return;
    if (this.startupGrace && next !== 'online') return;
    this.state = next;
    this.listeners.forEach((l) => l(next));
    if (next === 'online') {
      if (this.probeLoopTimer) {
        clearTimeout(this.probeLoopTimer);
        this.probeLoopTimer = null;
      }
    }
  }

  getState(): NetworkState {
    return this.state;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const connectivityService = new ConnectivityService();
