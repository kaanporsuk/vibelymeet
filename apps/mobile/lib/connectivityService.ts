import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

type NetworkState = 'online' | 'offline';
type Listener = (state: NetworkState) => void;

class ConnectivityService {
  private state: NetworkState = 'online';
  private listeners: Set<Listener> = new Set();
  private startupGrace = true;
  private initialized = false;
  private netUnsub: (() => void) | null = null;

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // 10-second startup grace — ignore ALL non-online states
    setTimeout(() => {
      this.startupGrace = false;
    }, 10000);

    // Configure NetInfo to NOT do its own reachability checks
    // This prevents the oscillation caused by failed HEAD/GET probes
    NetInfo.configure({
      reachabilityShouldRun: () => false,
      reachabilityRequestTimeout: 15000,
    });

    // Subscribe to NetInfo — only react to hard connect/disconnect
    this.netUnsub = NetInfo.addEventListener((netState: NetInfoState) => {
      if (netState.isConnected === false) {
        this.setState('offline');
      } else if (netState.isConnected === true) {
        if (this.state !== 'online') {
          this.setState('online');
        }
      }
      // isConnected === null → ignore, don't change state
    });
  }

  private setState(next: NetworkState) {
    // During startup grace, never show offline/reconnecting
    if (this.startupGrace && next !== 'online') return;

    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((l) => l(next));
  }

  getState(): NetworkState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy() {
    this.netUnsub?.();
    this.netUnsub = null;
    this.listeners.clear();
    this.initialized = false;
  }
}

export const connectivityService = new ConnectivityService();
export type { NetworkState };
