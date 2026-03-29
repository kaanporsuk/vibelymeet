/**
 * Updates profiles.last_seen_at periodically while app is in foreground.
 * Powers "Online" / "Recently active" / "Last seen" in chat. Reference: src/hooks/useActivityHeartbeat.ts
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';

const HEARTBEAT_INTERVAL_MS = 60_000;

/** When `skipHeartbeat` is true (e.g. user on a break), we do not touch `last_seen_at` so matches see stale activity. */
export function useActivityHeartbeat(userId: string | null | undefined, skipHeartbeat = false) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const inFlightRef = useRef(false);

  const updateLastSeen = useCallback(async () => {
    if (!userId || skipHeartbeat || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      if (error && __DEV__) console.warn('[heartbeat] update failed:', error.message);
    } catch (err) {
      if (__DEV__) console.warn('[heartbeat] unexpected error:', err);
    } finally {
      inFlightRef.current = false;
    }
  }, [userId, skipHeartbeat]);

  const startHeartbeat = useCallback(() => {
    if (!userId || skipHeartbeat) return;
    void updateLastSeen();
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => void updateLastSeen(), HEARTBEAT_INTERVAL_MS);
  }, [userId, skipHeartbeat, updateLastSeen]);

  const stopHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!userId || skipHeartbeat) {
      stopHeartbeat();
      return;
    }

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        startHeartbeat();
      } else {
        stopHeartbeat();
      }
      appStateRef.current = nextState;
    };

    if (appStateRef.current === 'active') startHeartbeat();
    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
      stopHeartbeat();
    };
  }, [userId, skipHeartbeat, startHeartbeat, stopHeartbeat]);
}
