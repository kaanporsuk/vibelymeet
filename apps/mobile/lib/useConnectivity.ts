import { useEffect, useState } from 'react';
import { connectivityService, type NetworkState } from '@/lib/connectivityService';

export function useConnectivity(): NetworkState {
  const [state, setState] = useState<NetworkState>(connectivityService.getState());

  useEffect(() => {
    setState(connectivityService.getState());
    return connectivityService.subscribe(setState);
  }, []);

  return state;
}
