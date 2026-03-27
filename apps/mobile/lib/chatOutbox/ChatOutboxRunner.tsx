import { useEffect, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { connectivityService } from '@/lib/connectivityService';
import { useChatOutbox } from '@/lib/chatOutbox/ChatOutboxContext';

/**
 * Global outbox driver: connectivity changes, foreground, periodic sweep.
 */
export function ChatOutboxRunner() {
  const queryClient = useQueryClient();
  const { processTick } = useChatOutbox();

  const tick = useCallback(async () => {
    await processTick(queryClient);
  }, [processTick, queryClient]);

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
    }, 4000);
    return () => {
      unsubNet();
      subApp.remove();
      clearInterval(interval);
    };
  }, [tick]);

  return null;
}
