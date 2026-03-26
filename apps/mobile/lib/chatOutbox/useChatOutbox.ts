import { useEffect, useMemo, useState } from 'react';
import { chatOutboxStore } from '@/lib/chatOutbox/store';
import type { ChatOutboxItem } from '@/lib/chatOutbox/types';

export function useChatOutboxMatch(matchId: string | null | undefined): ChatOutboxItem[] {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return chatOutboxStore.subscribe(() => setTick((t) => t + 1));
  }, []);

  return useMemo(() => {
    if (!matchId) return [];
    void tick;
    return chatOutboxStore.listByMatch(matchId);
  }, [matchId, tick]);
}

