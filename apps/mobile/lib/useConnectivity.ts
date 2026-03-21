import { useState, useEffect } from 'react';
import { connectivityService, type NetworkState } from '@/lib/connectivityService';

export function useConnectivity(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => connectivityService.getState());
  useEffect(() => connectivityService.subscribe(setState), []);
  return state;
}
