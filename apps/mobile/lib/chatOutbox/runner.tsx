import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useConnectivity } from '@/lib/useConnectivity';
import { chatOutboxStore } from '@/lib/chatOutbox/store';
import { chatOutboxExecutor } from '@/lib/chatOutbox/executor';

function isActive(state: AppStateStatus): boolean {
  return state === 'active';
}

export function ChatOutboxRunner() {
  const { user } = useAuth();
  const network = useConnectivity();
  const [appActive, setAppActive] = useState(() => isActive(AppState.currentState));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppActive(isActive(next)));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await chatOutboxStore.initForUser(user?.id ?? null);
      if (cancelled) return;
      // If we launched online + active, run immediately after hydration.
      chatOutboxExecutor.tick({ network, appActive });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, network, appActive]);

  const shouldTick = useMemo(() => {
    return Boolean(user?.id) && appActive && network === 'online';
  }, [user?.id, appActive, network]);

  useEffect(() => {
    if (!shouldTick) return;
    chatOutboxExecutor.tick({ network, appActive });
  }, [shouldTick, network, appActive]);

  return null;
}

