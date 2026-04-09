import { useEffect, useState } from 'react';
import {
  nativeHeroVideoGetState,
  nativeHeroVideoSubscribe,
  type NativeHeroVideoControllerState,
} from '@/lib/nativeHeroVideoUploadController';

/**
 * Subscribe to the native hero video upload controller.
 * Returns live controller state that updates whenever phase/progress changes.
 * Works across screen mounts/unmounts — the underlying controller persists.
 */
export function useNativeHeroVideoUpload(): NativeHeroVideoControllerState {
  const [state, setState] = useState<NativeHeroVideoControllerState>(nativeHeroVideoGetState);

  useEffect(() => {
    // Sync once on mount in case state changed between render and effect
    setState(nativeHeroVideoGetState());
    return nativeHeroVideoSubscribe(setState);
  }, []);

  return state;
}
