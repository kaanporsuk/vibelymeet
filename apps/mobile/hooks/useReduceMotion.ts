import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type ReduceMotionState = {
  reduceMotion: boolean;
  resolved: boolean;
};

let cachedReduceMotion: boolean | null = null;

export function useReduceMotionState(): ReduceMotionState {
  const [state, setState] = useState<ReduceMotionState>(() => ({
    reduceMotion: cachedReduceMotion ?? false,
    resolved: cachedReduceMotion !== null,
  }));

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        cachedReduceMotion = enabled;
        if (mounted) setState({ reduceMotion: enabled, resolved: true });
      })
      .catch(() => {
        cachedReduceMotion = false;
        if (mounted) setState({ reduceMotion: false, resolved: true });
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      cachedReduceMotion = enabled;
      setState({ reduceMotion: enabled, resolved: true });
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return state;
}

export function useReduceMotion(): boolean {
  return useReduceMotionState().reduceMotion;
}
