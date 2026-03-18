import { useState, useEffect } from 'react';
import * as Network from 'expo-network';

export type NetworkStatus = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
};

export function useNetworkStatus() {
  const [state, setState] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
  });

  useEffect(() => {
    let isMounted = true;

    const check = async () => {
      try {
        const networkState = await Network.getNetworkStateAsync();
        if (isMounted) {
          setState({
            isConnected: networkState.isConnected ?? true,
            isInternetReachable: networkState.isInternetReachable ?? null,
          });
        }
      } catch {
        // assume connected on error
      }
    };

    check();
    const interval = setInterval(check, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return state;
}

export function useIsOffline(): boolean {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  return !isConnected || isInternetReachable === false;
}
