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
import { supabase } from '@/lib/supabase';
import { loadOutboxItems, saveOutboxItems } from '@/lib/chatOutbox/store';
import { newOutboxClientRequestId } from '@/lib/chatOutbox/id';
import { executeOutboxItem, nextBackoffMs, OutboxExecuteError } from '@/lib/chatOutbox/execute';
import { isLikelyNetworkFailure, outboxFailureUserMessage } from '@/lib/networkErrorMessage';
import { cleanupOutboxCacheUri } from '@/lib/chatOutbox/mediaCache';
import type { ChatOutboxItem, ChatOutboxPayload, ChatOutboxQueueState } from '@/lib/chatOutbox/types';
import { trackVibeClipEvent } from '@/lib/vibeClipAnalytics';
import { classifySendFailureMessage, durationBucketFromSeconds } from '../../../../shared/chat/vibeClipAnalytics';

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
const HYDRATION_CHECK_INTERVAL_MS = 10_000;
const HYDRATION_TIMEOUT_MS = 90_000;
const HYDRATION_RECOVERY_BACKOFF_MS = 5_000;

function itemPayloadUri(item: ChatOutboxItem): string | null {
  if (item.payload.kind === 'text') return null;
  return item.payload.uri;
}

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
    const toCleanup: string[] = [];
    setItems((prev) =>
      prev.filter((it) => {
        if (it.id !== itemId) return true;
        const uri = itemPayloadUri(it);
        if (uri) toCleanup.push(uri);
        return false;
      })
    );
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((uri) => cleanupOutboxCacheUri(uri)));
    }
  }, []);

  const reconcileWithServerIds = useCallback((serverMessageIds: Set<string>) => {
    const toCleanup: string[] = [];
    setItems((prev) =>
      prev.filter((it) => {
        if (!it.serverMessageId) return true;
        if (!serverMessageIds.has(it.serverMessageId)) return true;
        const uri = itemPayloadUri(it);
        if (uri) toCleanup.push(uri);
        return false;
      })
    );
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((uri) => cleanupOutboxCacheUri(uri)));
    }
  }, []);

  const itemsForMatch = useCallback(
    (matchId: string) => items.filter((it) => it.matchId === matchId && it.state !== 'canceled' && it.state !== 'sent'),
    [items]
  );

  const processTick = useCallback(
    async (queryClient: QueryClient) => {
      if (!userId) return;
      const online = connectivityService.getState() === 'online';
      const now = Date.now();

      // Bounded recovery: awaiting_hydration is not terminal.
      for (const item of itemsRef.current) {
        if (item.state !== 'awaiting_hydration') continue;
        if (!item.serverMessageId) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: 'failed' as const,
                    lastError: 'Message confirmation missing. Retry to continue.',
                    nextRetryAtMs: now + HYDRATION_RECOVERY_BACKOFF_MS,
                    updatedAtMs: now,
                  }
                : it
            )
          );
          continue;
        }
        if (!online) continue;

        const deadlineAtMs = item.hydrationDeadlineAtMs ?? item.updatedAtMs + HYDRATION_TIMEOUT_MS;
        const lastCheckedAtMs = item.hydrationLastCheckedAtMs ?? 0;
        const dueForCheck = now - lastCheckedAtMs >= HYDRATION_CHECK_INTERVAL_MS;
        const pastDeadline = now >= deadlineAtMs;
        if (!dueForCheck && !pastDeadline) continue;

        const { data: serverRow } = await supabase
          .from('messages')
          .select('id')
          .eq('id', item.serverMessageId)
          .eq('match_id', item.matchId)
          .maybeSingle();

        if (serverRow?.id) {
          const uri = itemPayloadUri(item);
          if (uri) void cleanupOutboxCacheUri(uri);
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: 'sent' as const,
                    hydrationLastCheckedAtMs: now,
                    hydrationDeadlineAtMs: deadlineAtMs,
                    updatedAtMs: now,
                  }
                : it
            )
          );
          queryClient.invalidateQueries({ queryKey: ['messages'] });
          queryClient.invalidateQueries({ queryKey: ['matches'] });
          continue;
        }

        if (pastDeadline) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: 'failed' as const,
                    lastError: 'Message still syncing. Retry to resend safely.',
                    nextRetryAtMs: now + HYDRATION_RECOVERY_BACKOFF_MS,
                    hydrationLastCheckedAtMs: now,
                    hydrationDeadlineAtMs: deadlineAtMs,
                    updatedAtMs: now,
                  }
                : it
            )
          );
        } else {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    hydrationLastCheckedAtMs: now,
                    hydrationDeadlineAtMs: deadlineAtMs,
                  }
                : it
            )
          );
        }
      }

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
          const { serverMessageId, uploadedPublicUrl, uploadedMediaUrl } = await executeOutboxItem(
            { ...next, attemptCount },
            queryClient
          );
          const successAtMs = Date.now();
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    serverMessageId,
                    uploadedPublicUrl: uploadedPublicUrl ?? it.uploadedPublicUrl,
                    uploadedMediaUrl: uploadedMediaUrl ?? it.uploadedMediaUrl,
                    state: 'awaiting_hydration' as const,
                    lastError: undefined,
                    nextRetryAtMs: undefined,
                    hydrationLastCheckedAtMs: undefined,
                    hydrationDeadlineAtMs: successAtMs + HYDRATION_TIMEOUT_MS,
                    updatedAtMs: successAtMs,
                  }
                : it
            )
          );
          if (next.payload.kind === 'video') {
            const dur = next.payload.durationSeconds;
            trackVibeClipEvent('clip_send_succeeded', {
              duration_bucket: durationBucketFromSeconds(dur),
              has_poster: !!(uploadedPublicUrl ?? next.uploadedPublicUrl),
              thread_bucket: 'unknown',
              is_sender: true,
            });
          }
        } catch (e) {
          const rawMsg = e instanceof Error ? e.message : 'Send failed';
          const backoff = nextBackoffMs(attemptCount);
          const uploadedPublicUrl =
            e instanceof OutboxExecuteError ? e.uploadedPublicUrl : undefined;
          const uploadedMediaUrl =
            e instanceof OutboxExecuteError ? e.uploadedMediaUrl : undefined;
          const offlineNow = connectivityService.getState() === 'offline';
          const likelyNet = isLikelyNetworkFailure(e);
          const treatAsOfflineWait = offlineNow || likelyNet;
          const isClip = next.payload.kind === 'video';
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    uploadedPublicUrl: uploadedPublicUrl ?? it.uploadedPublicUrl,
                    uploadedMediaUrl: uploadedMediaUrl ?? it.uploadedMediaUrl,
                    state: treatAsOfflineWait ? ('waiting_for_network' as const) : ('failed' as const),
                    lastError: treatAsOfflineWait ? undefined : outboxFailureUserMessage(rawMsg, isClip),
                    nextRetryAtMs: treatAsOfflineWait ? undefined : Date.now() + backoff,
                    attemptCount: treatAsOfflineWait ? next.attemptCount : attemptCount,
                    updatedAtMs: Date.now(),
                  }
                : it
            )
          );
          if (isClip && !treatAsOfflineWait) {
            trackVibeClipEvent('clip_send_failed', {
              failure_class: classifySendFailureMessage(rawMsg),
            });
          }
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
