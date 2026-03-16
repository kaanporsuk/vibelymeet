/**
 * Updates profiles.last_seen_at periodically while app is in foreground.
 * Powers "Online" / "Recently active" / "Last seen" in chat. Reference: src/hooks/useActivityHeartbeat.ts
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useActivityHeartbeat(userId: string | null | undefined) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const inFlightRef = useRef(false);

  const updateLastSeen = useCallback(async () => {
    if (!userId || inFlightRef.current) return;
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
  }, [userId]);

  const startHeartbeat = useCallback(() => {
    if (!userId) return;
    void updateLastSeen();
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => void updateLastSeen(), HEARTBEAT_INTERVAL_MS);
  }, [userId, updateLastSeen]);

  const stopHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

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
  }, [userId, startHeartbeat, stopHeartbeat]);
}
