import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { connectivityService } from '@/lib/connectivityService';
import { loadOutboxItems, saveOutboxItems } from '@/lib/chatOutbox/store';
import { newOutboxClientRequestId } from '@/lib/chatOutbox/id';
import { executeOutboxItem, nextBackoffMs } from '@/lib/chatOutbox/execute';
import type { ChatOutboxItem, ChatOutboxPayload, ChatOutboxQueueState } from '@/lib/chatOutbox/types';

type ChatOutboxContextValue = {
  items: ChatOutboxItem[];
  /** Returns client_request_id (outbox item id) */
  enqueue: (input: {
    matchId: string;
    otherUserId: string;
    payload: ChatOutboxPayload;
  }) => string | null;
  retry: (itemId: string) => void;
  remove: (itemId: string) => void;
  itemsForMatch: (matchId: string) => ChatOutboxItem[];
  /** Remove items whose server row is now in the hydrated thread */
  reconcileWithServerIds: (serverMessageIds: Set<string>) => void;
  /** Called by ChatOutboxRunner only */
  processTick: (queryClient: QueryClient) => Promise<void>;
};

const ChatOutboxContext = createContext<ChatOutboxContextValue | null>(null);

function isEligibleToSend(item: ChatOutboxItem, online: boolean): boolean {
  if (!online) return false;
  if (item.state === 'canceled' || item.state === 'sent') return false;
  if (item.state === 'awaiting_hydration') return false;
  if (item.state === 'sending') return false;
  if (item.state === 'failed') {
    if (item.nextRetryAtMs != null && Date.now() < item.nextRetryAtMs) return false;
    return true;
  }
  if (item.state === 'waiting_for_network' || item.state === 'queued') return true;
  return false;
}

export function ChatOutboxProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<ChatOutboxItem[]>([]);
  const itemsRef = useRef(items);
  const processingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void loadOutboxItems(userId).then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      void saveOutboxItems(userId, items);
    }, 200);
    return () => clearTimeout(t);
  }, [items, userId]);

  const enqueue = useCallback(
    (input: { matchId: string; otherUserId: string; payload: ChatOutboxPayload }): string | null => {
      if (!userId) return null;
      const id = newOutboxClientRequestId();
      const now = Date.now();
      const online = connectivityService.getState() === 'online';
      const initialState: ChatOutboxQueueState = online ? 'queued' : 'waiting_for_network';
      const item: ChatOutboxItem = {
        id,
        matchId: input.matchId,
        otherUserId: input.otherUserId,
        userId,
        payload: input.payload,
        state: initialState,
        createdAtMs: now,
        updatedAtMs: now,
        attemptCount: 0,
      };
      setItems((prev) => [...prev, item].sort((a, b) => a.createdAtMs - b.createdAtMs));
      return id;
    },
    [userId]
  );

  const retry = useCallback((itemId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              state: connectivityService.getState() === 'online' ? 'queued' : 'waiting_for_network',
              lastError: undefined,
              nextRetryAtMs: undefined,
              updatedAtMs: Date.now(),
            }
          : it
      )
    );
  }, []);

  const remove = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== itemId));
  }, []);

  const reconcileWithServerIds = useCallback((serverMessageIds: Set<string>) => {
    setItems((prev) =>
      prev.filter((it) => {
        if (!it.serverMessageId) return true;
        return !serverMessageIds.has(it.serverMessageId);
      })
    );
  }, []);

  const itemsForMatch = useCallback(
    (matchId: string) => items.filter((it) => it.matchId === matchId && it.state !== 'canceled' && it.state !== 'sent'),
    [items]
  );

  const processTick = useCallback(
    async (queryClient: QueryClient) => {
      if (!userId) return;
      const online = connectivityService.getState() === 'online';

      const byMatch = new Map<string, ChatOutboxItem[]>();
      for (const it of itemsRef.current) {
        if (it.state === 'canceled' || it.state === 'sent') continue;
        if (!byMatch.has(it.matchId)) byMatch.set(it.matchId, []);
        byMatch.get(it.matchId)!.push(it);
      }

      for (const [, list] of byMatch) {
        list.sort((a, b) => a.createdAtMs - b.createdAtMs);
        const next = list.find((it) => isEligibleToSend(it, online));
        if (!next) continue;
        if (processingRef.current.has(next.id)) continue;

        processingRef.current.add(next.id);

        const attemptCount = next.attemptCount + 1;
        setItems((prev) =>
          prev.map((it) =>
            it.id === next.id
              ? { ...it, state: 'sending' as const, attemptCount, updatedAtMs: Date.now() }
              : it
          )
        );

        try {
          const { serverMessageId } = await executeOutboxItem(
            { ...next, attemptCount },
            queryClient
          );
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    serverMessageId,
                    state: 'awaiting_hydration' as const,
                    lastError: undefined,
                    nextRetryAtMs: undefined,
                    updatedAtMs: Date.now(),
                  }
                : it
            )
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Send failed';
          const backoff = nextBackoffMs(attemptCount);
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    state: 'failed' as const,
                    lastError: msg,
                    nextRetryAtMs: Date.now() + backoff,
                    updatedAtMs: Date.now(),
                  }
                : it
            )
          );
        } finally {
          processingRef.current.delete(next.id);
        }
      }
    },
    [userId]
  );

  const value = useMemo<ChatOutboxContextValue>(
    () => ({
      items,
      enqueue,
      retry,
      remove,
      itemsForMatch,
      reconcileWithServerIds,
      processTick,
    }),
    [items, enqueue, retry, remove, itemsForMatch, reconcileWithServerIds, processTick]
  );

  return <ChatOutboxContext.Provider value={value}>{children}</ChatOutboxContext.Provider>;
}

export function useChatOutbox(): ChatOutboxContextValue {
  const ctx = useContext(ChatOutboxContext);
  if (!ctx) {
    throw new Error('useChatOutbox must be used within ChatOutboxProvider');
  }
  return ctx;
}
