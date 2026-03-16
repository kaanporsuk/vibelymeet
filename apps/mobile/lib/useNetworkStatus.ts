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
    const handleState = (netState: NetInfoState) => {
      setState({
        isConnected: netState.isConnected ?? false,
        isInternetReachable: netState.isInternetReachable ?? null,
      });
    };

    NetInfo.fetch().then(handleState);
    const unsubscribe = NetInfo.addEventListener(handleState);
    return () => unsubscribe();
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
