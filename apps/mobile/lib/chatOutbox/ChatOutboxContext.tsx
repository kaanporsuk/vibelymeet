import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { connectivityService } from '@/lib/connectivityService';
import { supabase } from '@/lib/supabase';
import { loadOutboxItems, saveOutboxItems } from '@/lib/chatOutbox/store';
import { newOutboxClientRequestId } from '@/lib/chatOutbox/id';
import { executeOutboxItem, nextBackoffMs, OutboxExecuteError } from '@/lib/chatOutbox/execute';
import { syncChatVibeClipUploadStatus } from '@/lib/mediaAssetResolver';
import { isLikelyNetworkFailure, outboxFailureUserMessage } from '@/lib/networkErrorMessage';
import { cleanupOutboxCacheUri } from '@/lib/chatOutbox/mediaCache';
import { trackEvent } from '@/lib/analytics';
import type { ChatOutboxItem, ChatOutboxPayload, ChatOutboxQueueState } from '@/lib/chatOutbox/types';
import { trackVibeClipEvent } from '@/lib/vibeClipAnalytics';
import { CHAT_MESSAGE_SELECT, invalidateAfterThreadMutation, patchThreadCacheFromRawMessage } from '@/lib/chatApi';
import { classifySendFailureMessage, durationBucketFromSeconds } from '../../../../shared/chat/vibeClipAnalytics';
import { getSessionUploadSummary, type SessionUploadSummary } from '../../../../shared/media/session-upload-summary';
import {
  mediaUploadSuspendedRecoveryTelemetry,
  type MediaUploadSuspendedRecoveryOutcome,
  type VibeClipRecoveryDismissResult,
  type VibeClipRecoveryResumeStrategy,
  type VibeClipServerUpload,
  type VibeClipUploadStatus,
} from '../../../../shared/chat/vibeClipRecovery';
import {
  buildRecoveryAttentionTargets,
  type UploadAttentionTarget,
} from '@clientShared/chat/uploadAttentionTargets';
import {
  shouldPruneOutboxItemAfterServerReconcile,
  type OutboxServerMessageReconcileInput,
} from '@clientShared/chat/outboxReconciliation';

type VibeClipRecoverySweepTrigger = 'mount_sweep' | 'foreground' | 'poll' | 'manual';
type VibeClipRecoverySweepOutcome =
  | 'none'
  | 'self_healed'
  | 'provider_unreachable'
  | 'terminal_failed'
  | 'stuck'
  | 'query_failed';

type ChatVibeClipUploadSweepRow = {
  id: string;
  match_id: string;
  client_request_id: string;
  status: VibeClipUploadStatus;
  provider_object_id: string | null;
  expires_at: string | null;
  updated_at: string | null;
  recovery_dismissed_at?: string | null;
  published_message_id?: string | null;
  duration_ms?: number | null;
  aspect_ratio?: number | null;
  source_bytes?: number | null;
  mime_type?: string | null;
};

type MatchPeerRow = {
  id: string;
  profile_id_1: string | null;
  profile_id_2: string | null;
};

type ChatVibeClipUploadSweepQuery = {
  eq: (column: string, value: unknown) => ChatVibeClipUploadSweepQuery;
  in: (column: string, values: unknown[]) => ChatVibeClipUploadSweepQuery;
  is: (column: string, value: unknown) => ChatVibeClipUploadSweepQuery;
  lt: (column: string, value: string) => ChatVibeClipUploadSweepQuery;
  order: (column: string, options?: { ascending?: boolean }) => ChatVibeClipUploadSweepQuery;
  limit: (count: number) => Promise<{ data: ChatVibeClipUploadSweepRow[] | null; error: { message?: string } | null }>;
};

type ChatOutboxContextValue = {
  items: ChatOutboxItem[];
  staleVibeClipUploads: VibeClipServerUpload[];
  recoveryAttentionTargets: UploadAttentionTarget[];
  recoveryAttentionCount: number;
  sessionUploadSummary: SessionUploadSummary;
  /** Returns client_request_id (outbox item id) */
  enqueue: (input: {
    matchId: string;
    otherUserId: string;
    payload: ChatOutboxPayload;
    threadBucket?: ChatOutboxItem['threadBucket'];
  }) => string | null;
  retry: (itemId: string) => void;
  retryAllFailed: () => void;
  retryVibeClipUpload: (clientRequestId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => void;
  dismissStaleVibeClipUpload: (uploadId: string) => Promise<VibeClipRecoveryDismissResult | false>;
  remove: (itemId: string) => void;
  itemsForMatch: (matchId: string) => ChatOutboxItem[];
  runVibeClipRecoverySweep: (trigger: VibeClipRecoverySweepTrigger, matchId?: string | null) => Promise<void>;
  staleVibeClipUploadsForMatch: (matchId: string) => VibeClipServerUpload[];
  /** Remove items whose server row is now in the hydrated thread */
  reconcileWithServerMessages: (input: OutboxServerMessageReconcileInput) => void;
  /** Called by ChatOutboxRunner only */
  processTick: () => Promise<void>;
};

const ChatOutboxContext = createContext<ChatOutboxContextValue | null>(null);
const HYDRATION_CHECK_INTERVAL_MS = 10_000;
const HYDRATION_TIMEOUT_MS = 90_000;
const HYDRATION_RECOVERY_BACKOFF_MS = 5_000;
const INTERRUPTED_SENDING_RECOVERY_MS = 2 * 60 * 1000;
const STALE_VIBE_CLIP_UPLOAD_AGE_MS = 60_000;
const VIBE_CLIP_RECOVERY_SWEEP_LIMIT = 20;

function itemPayloadUri(item: ChatOutboxItem): string | null {
  if (item.payload.kind === 'text') return null;
  return item.payload.uri;
}

function isMediaOutboxItem(item: ChatOutboxItem): boolean {
  return item.payload.kind !== 'text';
}

function rowToVibeClipServerUpload(row: ChatVibeClipUploadSweepRow): VibeClipServerUpload {
  return {
    id: row.id,
    matchId: row.match_id,
    clientRequestId: row.client_request_id,
    status: row.status,
    providerObjectId: row.provider_object_id,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    recoveryDismissedAt: row.recovery_dismissed_at ?? null,
    publishedMessageId: row.published_message_id ?? null,
    durationMs: row.duration_ms ?? null,
    aspectRatio: row.aspect_ratio ?? null,
    sourceBytes: row.source_bytes ?? null,
    mimeType: row.mime_type ?? null,
  };
}

async function attachOtherUserIdsToStaleUploads(
  uploads: VibeClipServerUpload[],
  userId: string,
): Promise<VibeClipServerUpload[]> {
  const matchIds = Array.from(new Set(uploads.map((upload) => upload.matchId).filter(Boolean)));
  if (matchIds.length === 0) return uploads;

  const { data, error } = await supabase
    .from('matches')
    .select('id, profile_id_1, profile_id_2')
    .in('id', matchIds);
  if (error || !Array.isArray(data)) return uploads;

  const peerByMatchId = new Map<string, string | null>();
  for (const row of data as MatchPeerRow[]) {
    const peerId = row.profile_id_1 === userId
      ? row.profile_id_2
      : row.profile_id_2 === userId
        ? row.profile_id_1
        : null;
    peerByMatchId.set(row.id, peerId);
  }

  return uploads.map((upload) => ({
    ...upload,
    otherUserId: peerByMatchId.get(upload.matchId) ?? upload.otherUserId ?? null,
  }));
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

function recoverInterruptedSendingItems(
  items: ChatOutboxItem[],
  opts: {
    now: number;
    online: boolean;
    activeProcessingIds?: Set<string>;
    force?: boolean;
  }
): ChatOutboxItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.state !== 'sending') return item;
    if (opts.activeProcessingIds?.has(item.id)) return item;
    const isStale = opts.force || opts.now - item.updatedAtMs >= INTERRUPTED_SENDING_RECOVERY_MS;
    if (!isStale) return item;
    changed = true;
    return {
      ...item,
      state: opts.online ? ('queued' as const) : ('waiting_for_network' as const),
      lastError: undefined,
      nextRetryAtMs: undefined,
      updatedAtMs: opts.now,
    };
  });
  return changed ? next : items;
}

function recoverySweepOutcome(stats: {
  selfHealedCount: number;
  providerUnreachableCount: number;
  terminalFailedCount: number;
  stuckCount: number;
}): VibeClipRecoverySweepOutcome {
  if (stats.selfHealedCount > 0) return 'self_healed';
  if (stats.providerUnreachableCount > 0) return 'provider_unreachable';
  if (stats.terminalFailedCount > 0) return 'terminal_failed';
  if (stats.stuckCount > 0) return 'stuck';
  return 'none';
}

export function ChatOutboxProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<ChatOutboxItem[]>([]);
  const [staleVibeClipUploads, setStaleVibeClipUploads] = useState<VibeClipServerUpload[]>([]);
  const [sessionUploadStats, setSessionUploadStats] = useState({ enqueued: 0, succeeded: 0, failed: 0 });
  const itemsRef = useRef(items);
  const processingRef = useRef<Set<string>>(new Set());
  const processingAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const processTickRef = useRef<() => Promise<void>>(async () => undefined);
  const tickScheduledRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const updateItems = useCallback((updater: ChatOutboxItem[] | ((prev: ChatOutboxItem[]) => ChatOutboxItem[])) => {
    const prev = itemsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    itemsRef.current = next;
    setItems(next);
  }, []);

  const requestProcessTick = useCallback(() => {
    if (tickScheduledRef.current) return;
    tickScheduledRef.current = true;
    const run = () => {
      tickScheduledRef.current = false;
      void processTickRef.current();
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(run);
    } else {
      setTimeout(run, 0);
    }
  }, []);

  useEffect(() => {
    const controllers = processingAbortControllersRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    setSessionUploadStats({ enqueued: 0, succeeded: 0, failed: 0 });
    if (!userId) {
      updateItems([]);
      setStaleVibeClipUploads([]);
      return;
    }
    let cancelled = false;
    void loadOutboxItems(userId).then((loaded) => {
      if (cancelled) return;
      updateItems(
        recoverInterruptedSendingItems(loaded, {
          now: Date.now(),
          online: connectivityService.getState() === 'online',
          force: true,
        }),
      );
      requestProcessTick();
    });
    return () => {
      cancelled = true;
    };
  }, [requestProcessTick, updateItems, userId]);

  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      void saveOutboxItems(userId, items);
    }, 200);
    return () => clearTimeout(t);
  }, [items, userId]);

  const enqueue = useCallback(
    (input: {
      matchId: string;
      otherUserId: string;
      payload: ChatOutboxPayload;
      threadBucket?: ChatOutboxItem['threadBucket'];
    }): string | null => {
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
        threadBucket: input.threadBucket ?? 'unknown',
      };
      updateItems((prev) => [...prev, item].sort((a, b) => a.createdAtMs - b.createdAtMs));
      requestProcessTick();
      if (isMediaOutboxItem(item)) {
        setSessionUploadStats((prev) => ({ ...prev, enqueued: prev.enqueued + 1 }));
      }
      return id;
    },
    [requestProcessTick, updateItems, userId]
  );

  const retryVibeClipUpload = useCallback((itemId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => {
    updateItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              state: connectivityService.getState() === 'online' ? 'queued' : 'waiting_for_network',
              lastError: undefined,
              nextRetryAtMs: undefined,
              uploadProgress: undefined,
              vibeClipResumeStrategy: it.payload.kind === 'video' ? resumeStrategy ?? undefined : undefined,
              updatedAtMs: Date.now(),
            }
          : it
      )
    );
    requestProcessTick();
  }, [requestProcessTick, updateItems]);

  const retry = useCallback((itemId: string) => {
    retryVibeClipUpload(itemId, null);
  }, [retryVibeClipUpload]);

  const retryAllFailed = useCallback(() => {
    updateItems((prev) =>
      prev.map((it) =>
        it.state === 'failed'
          ? {
              ...it,
              state: connectivityService.getState() === 'online' ? 'queued' : 'waiting_for_network',
              lastError: undefined,
              nextRetryAtMs: undefined,
              uploadProgress: undefined,
              updatedAtMs: Date.now(),
            }
          : it
      )
    );
    requestProcessTick();
  }, [requestProcessTick, updateItems]);

  const dismissStaleVibeClipUpload = useCallback(async (uploadId: string): Promise<VibeClipRecoveryDismissResult | false> => {
    if (!userId) return false;
    const id = uploadId.trim();
    if (!id) return false;
    const trackDismissFailure = () => {
      trackVibeClipEvent('clip_recovery_status', {
        trigger: 'manual_discard',
        outcome: 'query_failed',
        upload_id: id,
        latency_ms: 0,
      });
    };
    let data: unknown = null;
    let error: unknown = null;
    try {
      const result = await supabase.functions.invoke('dismiss-chat-vibe-clip-upload', {
        body: {
          upload_id: id,
          reason: 'user_discard_send_again',
        },
      });
      data = result.data;
      error = result.error;
    } catch {
      trackDismissFailure();
      return false;
    }
    const response = data as { success?: boolean; already_published?: boolean } | null;
    const success = !error && response?.success === true;
    if (!success) {
      trackDismissFailure();
      return false;
    }
    setStaleVibeClipUploads((prev) => prev.filter((upload) => upload.id !== id));
    return response.already_published ? 'already_published' : 'dismissed';
  }, [userId]);

  const remove = useCallback((itemId: string) => {
    const toCleanup: string[] = [];
    processingAbortControllersRef.current.get(itemId)?.abort();
    updateItems((prev) =>
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
  }, [updateItems]);

  const reconcileWithServerMessages = useCallback((input: OutboxServerMessageReconcileInput) => {
    const toCleanup: string[] = [];
    updateItems((prev) => {
      let changed = false;
      const next = prev.filter((it) => {
        if (!shouldPruneOutboxItemAfterServerReconcile(it, input)) return true;
        const uri = itemPayloadUri(it);
        if (uri) toCleanup.push(uri);
        changed = true;
        return false;
      });
      return changed ? next : prev;
    });
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((uri) => cleanupOutboxCacheUri(uri)));
    }
  }, [updateItems]);

  const itemsForMatch = useCallback(
    (matchId: string) => items.filter((it) => it.matchId === matchId && it.state !== 'canceled' && it.state !== 'sent'),
    [items]
  );

  const staleVibeClipUploadsForMatch = useCallback(
    (matchId: string) => staleVibeClipUploads.filter((upload) => upload.matchId === matchId),
    [staleVibeClipUploads]
  );

  const recoveryAttentionTargets = useMemo(
    () => buildRecoveryAttentionTargets(items, staleVibeClipUploads),
    [items, staleVibeClipUploads],
  );

  const recoveryAttentionCount = useMemo(
    () => recoveryAttentionTargets.length,
    [recoveryAttentionTargets],
  );

  const runVibeClipRecoverySweep = useCallback(async (trigger: VibeClipRecoverySweepTrigger, matchId?: string | null) => {
    if (!userId) return;
    const startedAtMs = Date.now();
    const staleBefore = new Date(Date.now() - STALE_VIBE_CLIP_UPLOAD_AGE_MS).toISOString();
    const selectStaleUploadRows = async (statuses: VibeClipUploadStatus[], limit: number) => {
      if (limit <= 0) return { data: [] as ChatVibeClipUploadSweepRow[], error: null };
      let query = (supabase as unknown as {
        from: (table: 'chat_vibe_clip_uploads') => {
          select: (columns: string) => ChatVibeClipUploadSweepQuery;
        };
      })
        .from('chat_vibe_clip_uploads')
        .select(
          'id, match_id, client_request_id, status, provider_object_id, expires_at, updated_at, recovery_dismissed_at, published_message_id, duration_ms, aspect_ratio, source_bytes, mime_type',
        )
        .eq('sender_id', userId)
        .in('status', statuses)
        .is('published_message_id', null)
        .is('recovery_dismissed_at', null)
        .lt('updated_at', staleBefore);
      if (matchId) query = query.eq('match_id', matchId);
      return query.order('updated_at', { ascending: true }).limit(limit);
    };

    const recoverableResult = await selectStaleUploadRows(['uploading', 'processing'], VIBE_CLIP_RECOVERY_SWEEP_LIMIT);
    if (recoverableResult.error) {
      trackVibeClipEvent('clip_recovery_status', {
        trigger,
        outcome: 'query_failed',
        checked_count: 0,
        latency_ms: Date.now() - startedAtMs,
      });
      return;
    }

    const recoverableRows = Array.isArray(recoverableResult.data) ? recoverableResult.data : [];
    let rows = recoverableRows;
    let failedTopUpQueryFailed = false;
    if (recoverableRows.length < VIBE_CLIP_RECOVERY_SWEEP_LIMIT) {
      const failedResult = await selectStaleUploadRows(
        ['failed'],
        VIBE_CLIP_RECOVERY_SWEEP_LIMIT - recoverableRows.length,
      );
      if (failedResult.error) {
        failedTopUpQueryFailed = true;
        trackVibeClipEvent('clip_recovery_status', {
          trigger,
          outcome: 'query_failed',
          checked_count: recoverableRows.length,
          latency_ms: Date.now() - startedAtMs,
        });
      } else {
        const failedRows = Array.isArray(failedResult.data) ? failedResult.data : [];
        rows = [...recoverableRows, ...failedRows];
      }
    }
    const stillStuck: VibeClipServerUpload[] = [];
    let selfHealedCount = 0;
    let providerUnreachableCount = 0;
    let terminalFailedCount = 0;
    for (const row of rows) {
      const upload = rowToVibeClipServerUpload(row);
      const synced = await syncChatVibeClipUploadStatus({
        uploadId: upload.id,
        clientRequestId: upload.clientRequestId,
      });
      const syncedStatus = synced?.status ?? upload.status;
      if (synced?.providerReachable === false) providerUnreachableCount += 1;
      if (syncedStatus === 'ready') {
        selfHealedCount += 1;
        trackVibeClipEvent('media_upload_suspended_recovery', mediaUploadSuspendedRecoveryTelemetry({
          clientRequestId: upload.clientRequestId,
          trigger,
          recoveryOutcome: 'self_healed',
          nowMs: Date.now(),
          serverUpload: {
            ...upload,
            status: 'ready',
            providerObjectId: synced?.providerObjectId ?? upload.providerObjectId,
            expiresAt: synced?.expiresAt ?? upload.expiresAt,
            updatedAt: upload.updatedAt,
            publishedMessageId: synced?.messageId ?? upload.publishedMessageId,
          },
          localSourcePresent: false,
        }));
        continue;
      }
      if (syncedStatus === 'failed') terminalFailedCount += 1;
      stillStuck.push({
        ...upload,
        status: syncedStatus,
        providerObjectId: synced?.providerObjectId ?? upload.providerObjectId,
        expiresAt: synced?.expiresAt ?? upload.expiresAt,
        updatedAt: synced?.updatedAt ?? upload.updatedAt,
        publishedMessageId: synced?.messageId ?? upload.publishedMessageId,
      });
    }
    const stillStuckWithPeers = await attachOtherUserIdsToStaleUploads(stillStuck, userId);
    if (rows.length > 0) {
      const stuckCount = stillStuckWithPeers.filter((upload) => upload.status !== 'failed').length;
      for (const upload of stillStuckWithPeers) {
        const recoveryOutcome: MediaUploadSuspendedRecoveryOutcome =
          upload.status === 'failed' ? 'failed' : 'stuck';
        trackVibeClipEvent('media_upload_suspended_recovery', mediaUploadSuspendedRecoveryTelemetry({
          clientRequestId: upload.clientRequestId,
          trigger,
          recoveryOutcome,
          nowMs: Date.now(),
          serverUpload: upload,
          localSourcePresent: false,
        }));
      }
      trackVibeClipEvent('clip_recovery_status', {
        trigger,
        outcome: recoverySweepOutcome({
          selfHealedCount,
          providerUnreachableCount,
          terminalFailedCount,
          stuckCount,
        }),
        checked_count: rows.length,
        self_healed_count: selfHealedCount,
        provider_unreachable_count: providerUnreachableCount,
        terminal_failed_count: terminalFailedCount,
        stuck_count: stuckCount,
        latency_ms: Date.now() - startedAtMs,
      });
    }

    setStaleVibeClipUploads((prev) => {
      const nextById = new Map<string, VibeClipServerUpload>();
      for (const upload of prev) {
        if (!matchId) {
          if (failedTopUpQueryFailed && upload.status === 'failed') nextById.set(upload.id, upload);
          continue;
        }
        if (matchId && upload.matchId === matchId) {
          if (failedTopUpQueryFailed && upload.status === 'failed') nextById.set(upload.id, upload);
          continue;
        }
        nextById.set(upload.id, upload);
      }
      for (const upload of stillStuckWithPeers) nextById.set(upload.id, upload);
      return Array.from(nextById.values()).sort((a, b) => {
        const at = new Date(a.updatedAt ?? 0).getTime();
        const bt = new Date(b.updatedAt ?? 0).getTime();
        return at - bt;
      });
    });
  }, [userId]);

  const processTick = useCallback(
    async () => {
      if (!userId) return;
      const online = connectivityService.getState() === 'online';
      const now = Date.now();
      const recovered = recoverInterruptedSendingItems(itemsRef.current, {
        now,
        online,
        activeProcessingIds: processingRef.current,
      });
      if (recovered !== itemsRef.current) {
        itemsRef.current = recovered;
        updateItems(recovered);
      }

      // Bounded recovery: awaiting_hydration is not terminal.
      for (const item of itemsRef.current) {
        if (item.state !== 'awaiting_hydration') continue;
        let serverMessageId = item.serverMessageId;
        const deadlineAtMs = item.hydrationDeadlineAtMs ?? item.updatedAtMs + HYDRATION_TIMEOUT_MS;
        const lastCheckedAtMs = item.hydrationLastCheckedAtMs ?? 0;
        const dueForCheck = now - lastCheckedAtMs >= HYDRATION_CHECK_INTERVAL_MS;
        const pastDeadline = now >= deadlineAtMs;
        if (online && item.payload.kind === 'video' && (dueForCheck || pastDeadline)) {
          const synced = await syncChatVibeClipUploadStatus({
            messageId: serverMessageId,
            clientRequestId: item.id,
          });
          if (synced?.messageId && synced.messageId !== serverMessageId) {
            serverMessageId = synced.messageId;
            updateItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      serverMessageId: synced.messageId ?? it.serverMessageId,
                      hydrationLastCheckedAtMs: now,
                      hydrationDeadlineAtMs: deadlineAtMs,
                      updatedAtMs: now,
                    }
                  : it
              )
            );
          }
        }
        if (!serverMessageId) {
          updateItems((prev) =>
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

        if (!dueForCheck && !pastDeadline) continue;

        const { data: serverRow } = await supabase
          .from('messages')
          .select(CHAT_MESSAGE_SELECT)
          .eq('id', serverMessageId)
          .eq('match_id', item.matchId)
          .maybeSingle();

        if (serverRow?.id) {
          const patchScope = {
            otherUserId: item.otherUserId,
            currentUserId: item.userId,
            matchId: item.matchId,
          };
          const patchResult = await patchThreadCacheFromRawMessage({
            queryClient,
            ...patchScope,
            raw: serverRow,
          });
          if (item.payload.kind === 'image' && patchResult.patched && !patchResult.displayReady) {
            updateItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      hydrationLastCheckedAtMs: now,
                      hydrationDeadlineAtMs: pastDeadline ? now + HYDRATION_TIMEOUT_MS : deadlineAtMs,
                      updatedAtMs: now,
                    }
                  : it
              )
            );
            invalidateAfterThreadMutation(queryClient, patchScope);
            continue;
          } else {
            const uri = itemPayloadUri(item);
            if (uri) void cleanupOutboxCacheUri(uri);
            updateItems((prev) =>
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
            invalidateAfterThreadMutation(queryClient, patchScope);
            if (isMediaOutboxItem(item)) {
              setSessionUploadStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
            }
            continue;
          }
        }

        if (pastDeadline) {
          updateItems((prev) =>
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
          updateItems((prev) =>
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
        if (list.some((it) => it.state === 'sending' || processingRef.current.has(it.id))) continue;
        const next = list.find((it) => isEligibleToSend(it, online));
        if (!next) continue;

        processingRef.current.add(next.id);
        const abortController = new AbortController();
        processingAbortControllersRef.current.set(next.id, abortController);

        const attemptCount = next.attemptCount + 1;
        const attemptStartedAtMs = Date.now();
        updateItems((prev) =>
          prev.map((it) =>
            it.id === next.id
              ? { ...it, state: 'sending' as const, attemptCount, updatedAtMs: Date.now() }
              : it
          )
        );

        try {
          const { serverMessageId, uploadedPublicUrl, uploadedMediaUrl, patchedThreadCache, displayReady } = await executeOutboxItem(
            { ...next, attemptCount },
            queryClient,
            (fraction) => {
              const uploadProgress = Math.max(0, Math.min(1, fraction));
              updateItems((prev) =>
                prev.map((it) =>
                  it.id === next.id
                    ? { ...it, uploadProgress, updatedAtMs: Date.now() }
                    : it
                )
              );
            },
            { signal: abortController.signal },
          );
          const successAtMs = Date.now();
          const completeImmediately =
            next.payload.kind !== 'video' &&
            patchedThreadCache === true &&
            (next.payload.kind !== 'image' || displayReady === true);
          if (completeImmediately) {
            const uri = itemPayloadUri(next);
            if (uri) void cleanupOutboxCacheUri(uri);
          }
          updateItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    serverMessageId,
                    uploadedPublicUrl: uploadedPublicUrl ?? it.uploadedPublicUrl,
                    uploadedMediaUrl: uploadedMediaUrl ?? it.uploadedMediaUrl,
                    uploadProgress: undefined,
                    vibeClipResumeStrategy: undefined,
                    state: completeImmediately ? ('sent' as const) : ('awaiting_hydration' as const),
                    lastError: undefined,
                    nextRetryAtMs: undefined,
                    hydrationLastCheckedAtMs: undefined,
                    hydrationDeadlineAtMs: completeImmediately ? undefined : successAtMs + HYDRATION_TIMEOUT_MS,
                    updatedAtMs: successAtMs,
                  }
                : it
            )
          );
          if (completeImmediately && isMediaOutboxItem(next)) {
            setSessionUploadStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
          }
          trackEvent('quality.chat_send_latency_observed', {
            payload_kind: next.payload.kind,
            latency_phase: completeImmediately ? 'response_patched' : 'response_waiting_hydration',
            outcome: 'success',
            attempt_count: attemptCount,
            enqueue_to_attempt_ms: attemptStartedAtMs - next.createdAtMs,
            attempt_to_response_ms: successAtMs - attemptStartedAtMs,
            response_to_hydration_ms: completeImmediately ? Date.now() - successAtMs : 0,
            thread_bucket: next.threadBucket ?? 'unknown',
          });
          if (next.payload.kind === 'video') {
            const dur = next.payload.durationSeconds;
            trackVibeClipEvent('clip_send_succeeded', {
              duration_bucket: durationBucketFromSeconds(dur),
              has_poster: !!(uploadedPublicUrl ?? next.uploadedPublicUrl),
              thread_bucket: next.threadBucket ?? 'unknown',
              is_sender: true,
            });
          }
        } catch (e) {
          const responseAtMs = Date.now();
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
          updateItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    uploadedPublicUrl: uploadedPublicUrl ?? it.uploadedPublicUrl,
                    uploadedMediaUrl: uploadedMediaUrl ?? it.uploadedMediaUrl,
                    uploadProgress: undefined,
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
          if (isMediaOutboxItem(next) && !treatAsOfflineWait) {
            setSessionUploadStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
          }
          trackEvent('quality.chat_send_latency_observed', {
            payload_kind: next.payload.kind,
            latency_phase: 'response_error',
            outcome: treatAsOfflineWait ? 'offline_wait' : 'failed',
            attempt_count: attemptCount,
            enqueue_to_attempt_ms: attemptStartedAtMs - next.createdAtMs,
            attempt_to_response_ms: responseAtMs - attemptStartedAtMs,
            response_to_hydration_ms: 0,
            thread_bucket: next.threadBucket ?? 'unknown',
          });
        } finally {
          processingAbortControllersRef.current.delete(next.id);
          processingRef.current.delete(next.id);
          if (itemsRef.current.some((it) => it.matchId === next.matchId && isEligibleToSend(it, connectivityService.getState() === 'online'))) {
            requestProcessTick();
          }
        }
      }
    },
    [queryClient, requestProcessTick, updateItems, userId]
  );

  useEffect(() => {
    processTickRef.current = processTick;
  }, [processTick]);

  const value = useMemo<ChatOutboxContextValue>(
    () => ({
      items,
      staleVibeClipUploads,
      recoveryAttentionTargets,
      recoveryAttentionCount,
      sessionUploadSummary: getSessionUploadSummary({
        enqueued: sessionUploadStats.enqueued,
        succeeded: sessionUploadStats.succeeded,
        failed: sessionUploadStats.failed,
        failedInQueue: items.filter((it) => isMediaOutboxItem(it) && it.state === 'failed').length,
        inFlight: items.filter((it) =>
          isMediaOutboxItem(it) && (it.state === 'sending' || it.state === 'awaiting_hydration')
        ).length,
        queued: items.filter((it) =>
          isMediaOutboxItem(it) && (it.state === 'queued' || it.state === 'waiting_for_network')
        ).length,
      }),
      enqueue,
      retry,
      retryAllFailed,
      retryVibeClipUpload,
      dismissStaleVibeClipUpload,
      remove,
      itemsForMatch,
      runVibeClipRecoverySweep,
      staleVibeClipUploadsForMatch,
      reconcileWithServerMessages,
      processTick,
    }),
    [
      items,
      staleVibeClipUploads,
      recoveryAttentionTargets,
      recoveryAttentionCount,
      sessionUploadStats,
      enqueue,
      retry,
      retryAllFailed,
      retryVibeClipUpload,
      dismissStaleVibeClipUpload,
      remove,
      itemsForMatch,
      runVibeClipRecoverySweep,
      staleVibeClipUploadsForMatch,
      reconcileWithServerMessages,
      processTick,
    ]
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
