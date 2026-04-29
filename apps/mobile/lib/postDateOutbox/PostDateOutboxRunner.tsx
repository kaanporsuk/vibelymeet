import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { connectivityService } from '@/lib/connectivityService';
import { drainNativePostDateOutbox } from './execute';

const DRAIN_INTERVAL_MS = 15_000;

export function PostDateOutboxRunner() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const tick = useCallback(async () => {
    if (!userId) return;
    await drainNativePostDateOutbox(userId);
  }, [userId]);

  useEffect(() => {
    void tick();
  }, [tick]);

  useEffect(() => {
    const unsubNet = connectivityService.subscribe(() => {
      void tick();
    });
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') void tick();
    };
    const subApp = AppState.addEventListener('change', onAppState);
    const interval = setInterval(() => {
      void tick();
    }, DRAIN_INTERVAL_MS);
    return () => {
      unsubNet();
      subApp.remove();
      clearInterval(interval);
    };
  }, [tick]);

  return null;
}

