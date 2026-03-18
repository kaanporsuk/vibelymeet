/**
 * Network status detection for React Native. Mirrors web useNetworkStatus (navigator.onLine).
 * Uses @react-native-community/netinfo.
 */
import { useState, useEffect } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type NetworkStatus = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
};

export function useNetworkStatus(): NetworkStatus {
  const [state, setState] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
  });

  useEffect(() => {
    let isMounted = true;
    const safeHandleState = (netState: NetInfoState) => {
      if (!isMounted) return;
      setState({
        isConnected: netState.isConnected ?? false,
        isInternetReachable: netState.isInternetReachable ?? null,
      });
    };
    NetInfo.fetch().then(safeHandleState);
    const unsubscribe = NetInfo.addEventListener(safeHandleState);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}

/** Returns true if we should treat the user as offline (no connection or internet unreachable). */
export function useIsOffline(): boolean {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  if (!isConnected) return true;
  if (isInternetReachable === false) return true;
  return false;
}
