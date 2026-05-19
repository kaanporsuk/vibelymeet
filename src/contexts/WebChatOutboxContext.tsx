import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { deleteOutboxBlob } from "@/lib/webChatOutbox/blobIdb";
import { loadWebOutboxItems, saveWebOutboxItems } from "@/lib/webChatOutbox/store";
import {
  executeWebOutboxItem,
  nextBackoffMs,
  WebOutboxExecuteError,
} from "@/lib/webChatOutbox/execute";
import { syncChatVibeClipUploadStatus } from "@/lib/mediaAssetResolver";
import { isLikelyNetworkFailure, outboxFailureUserMessage } from "@/lib/webChatOutbox/network";
import { invalidateAfterThreadMutation } from "@/hooks/useMessages";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import type { WebChatOutboxItem, WebChatOutboxPayload, WebChatOutboxQueueState } from "@/lib/webChatOutbox/types";
import type { ThreadInvalidateScope } from "../../shared/chat/queryKeys";
import type {
  VibeClipRecoveryResumeStrategy,
  VibeClipServerUpload,
  VibeClipUploadStatus,
} from "../../shared/chat/vibeClipRecovery";

const HYDRATION_CHECK_INTERVAL_MS = 10_000;
const HYDRATION_TIMEOUT_MS = 90_000;
const HYDRATION_RECOVERY_BACKOFF_MS = 5_000;
const INTERRUPTED_SENDING_RECOVERY_MS = 2 * 60 * 1000;
const STALE_VIBE_CLIP_UPLOAD_AGE_MS = 60_000;

type VibeClipRecoverySweepTrigger = "mount_sweep" | "foreground" | "poll" | "manual";
type VibeClipRecoverySweepOutcome =
  | "none"
  | "self_healed"
  | "provider_unreachable"
  | "terminal_failed"
  | "stuck"
  | "query_failed";

type ChatVibeClipUploadSweepRow = {
  id: string;
  match_id: string;
  client_request_id: string;
  status: VibeClipUploadStatus;
  provider_object_id: string | null;
  expires_at: string | null;
  updated_at: string | null;
  published_message_id?: string | null;
  duration_ms?: number | null;
  aspect_ratio?: number | null;
  source_bytes?: number | null;
  mime_type?: string | null;
};

type ChatVibeClipUploadSweepQuery = {
  eq: (column: string, value: unknown) => ChatVibeClipUploadSweepQuery;
  in: (column: string, values: unknown[]) => ChatVibeClipUploadSweepQuery;
  lt: (column: string, value: string) => ChatVibeClipUploadSweepQuery;
  order: (column: string, options?: { ascending?: boolean }) => ChatVibeClipUploadSweepQuery;
  limit: (count: number) => Promise<{ data: ChatVibeClipUploadSweepRow[] | null; error: { message?: string } | null }>;
};

function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function itemPayloadBlobKey(item: WebChatOutboxItem): string | null {
  const p = item.payload;
  if (p.kind === "text") return null;
  return p.blobKey;
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
    publishedMessageId: row.published_message_id ?? null,
    durationMs: row.duration_ms ?? null,
    aspectRatio: row.aspect_ratio ?? null,
    sourceBytes: row.source_bytes ?? null,
    mimeType: row.mime_type ?? null,
  };
}

function isEligibleToSend(item: WebChatOutboxItem, online: boolean): boolean {
  if (!online) return false;
  if (item.state === "canceled" || item.state === "sent") return false;
  if (item.state === "awaiting_hydration") return false;
  if (item.state === "sending") return false;
  if (item.state === "failed") {
    if (item.nextRetryAtMs != null && Date.now() < item.nextRetryAtMs) return false;
    return true;
  }
  if (item.state === "waiting_for_network" || item.state === "queued") return true;
  return false;
}

function recoverInterruptedSendingItems(
  items: WebChatOutboxItem[],
  opts: {
    now: number;
    online: boolean;
    activeProcessingIds?: Set<string>;
    force?: boolean;
  },
): WebChatOutboxItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.state !== "sending") return item;
    if (opts.activeProcessingIds?.has(item.id)) return item;
    const isStale = opts.force || opts.now - item.updatedAtMs >= INTERRUPTED_SENDING_RECOVERY_MS;
    if (!isStale) return item;
    changed = true;
    return {
      ...item,
      state: opts.online ? ("queued" as const) : ("waiting_for_network" as const),
      lastError: undefined,
      nextRetryAtMs: undefined,
      uploadProgress: undefined,
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
  if (stats.selfHealedCount > 0) return "self_healed";
  if (stats.providerUnreachableCount > 0) return "provider_unreachable";
  if (stats.terminalFailedCount > 0) return "terminal_failed";
  if (stats.stuckCount > 0) return "stuck";
  return "none";
}

type WebChatOutboxContextValue = {
  items: WebChatOutboxItem[];
  enqueue: (input: {
    matchId: string;
    otherUserId: string;
    userId: string;
    payload: WebChatOutboxPayload;
    invalidateScope?: ThreadInvalidateScope;
  }) => string | null;
  retry: (itemId: string) => void;
  retryVibeClipUpload: (clientRequestId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => void;
  remove: (itemId: string) => void;
  itemsForMatch: (matchId: string) => WebChatOutboxItem[];
  runVibeClipRecoverySweep: (trigger: VibeClipRecoverySweepTrigger, matchId?: string | null) => Promise<void>;
  staleVibeClipUploadsForMatch: (matchId: string) => VibeClipServerUpload[];
  reconcileWithServerIds: (serverMessageIds: Set<string>) => void;
  processTick: (queryClient: QueryClient) => Promise<void>;
};

const WebChatOutboxContext = createContext<WebChatOutboxContextValue | null>(null);

export function WebChatOutboxProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const userId = user?.id ?? null;
  const mediaV2Video = useFeatureFlag("media_v2_video");
  const mediaV2Photo = useFeatureFlag("media_v2_photo");
  const mediaV2Voice = useFeatureFlag("media_v2_voice");
  const [items, setItems] = useState<WebChatOutboxItem[]>([]);
  const [staleVibeClipUploads, setStaleVibeClipUploads] = useState<VibeClipServerUpload[]>([]);
  const itemsRef = useRef(items);
  const processingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setStaleVibeClipUploads([]);
      return;
    }
    let cancelled = false;
    void loadWebOutboxItems(userId).then((loaded) => {
      if (!cancelled) {
        setItems(
          recoverInterruptedSendingItems(loaded, {
            now: Date.now(),
            online: isOnline(),
            force: true,
          }),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      void saveWebOutboxItems(userId, items);
    }, 200);
    return () => clearTimeout(t);
  }, [items, userId]);

  const enqueue = useCallback(
    (input: {
      matchId: string;
      otherUserId: string;
      userId: string;
      payload: WebChatOutboxPayload;
      invalidateScope?: ThreadInvalidateScope;
    }): string | null => {
      if (!userId) return null;
      const id = crypto.randomUUID();
      const now = Date.now();
      const onlineNow = isOnline();
      const initialState: WebChatOutboxQueueState = onlineNow ? "queued" : "waiting_for_network";
      const item: WebChatOutboxItem = {
        id,
        matchId: input.matchId,
        otherUserId: input.otherUserId,
        userId: input.userId,
        payload: input.payload,
        state: initialState,
        createdAtMs: now,
        updatedAtMs: now,
        attemptCount: 0,
        invalidateScope: input.invalidateScope,
      };
      setItems((prev) => [...prev, item].sort((a, b) => a.createdAtMs - b.createdAtMs));
      return id;
    },
    [userId],
  );

  const retryVibeClipUpload = useCallback((itemId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              state: isOnline() ? "queued" : "waiting_for_network",
              lastError: undefined,
              nextRetryAtMs: undefined,
              uploadProgress: undefined,
              vibeClipResumeStrategy: it.payload.kind === "video" ? resumeStrategy ?? undefined : undefined,
              updatedAtMs: Date.now(),
            }
          : it,
      ),
    );
  }, []);

  const retry = useCallback((itemId: string) => {
    retryVibeClipUpload(itemId, null);
  }, [retryVibeClipUpload]);

  const remove = useCallback((itemId: string) => {
    const toCleanup: string[] = [];
    setItems((prev) =>
      prev.filter((it) => {
        if (it.id !== itemId) return true;
        const key = itemPayloadBlobKey(it);
        if (key) toCleanup.push(key);
        return false;
      }),
    );
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((k) => deleteOutboxBlob(k)));
    }
  }, []);

  const reconcileWithServerIds = useCallback((serverMessageIds: Set<string>) => {
    const toCleanup: string[] = [];
    setItems((prev) =>
      prev.filter((it) => {
        if (!it.serverMessageId) return true;
        if (!serverMessageIds.has(it.serverMessageId)) return true;
        const key = itemPayloadBlobKey(it);
        if (key) toCleanup.push(key);
        return false;
      }),
    );
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((k) => deleteOutboxBlob(k)));
    }
  }, []);

  const itemsForMatch = useCallback(
    (matchId: string) =>
      items.filter((it) => it.matchId === matchId && it.state !== "canceled" && it.state !== "sent"),
    [items],
  );

  const staleVibeClipUploadsForMatch = useCallback(
    (matchId: string) => staleVibeClipUploads.filter((upload) => upload.matchId === matchId),
    [staleVibeClipUploads],
  );

  const runVibeClipRecoverySweep = useCallback(async (trigger: VibeClipRecoverySweepTrigger, matchId?: string | null) => {
    if (!userId) return;
    const startedAtMs = Date.now();
    const staleBefore = new Date(Date.now() - STALE_VIBE_CLIP_UPLOAD_AGE_MS).toISOString();
    let query = (supabase as unknown as {
      from: (table: "chat_vibe_clip_uploads") => {
        select: (columns: string) => ChatVibeClipUploadSweepQuery;
      };
    })
      .from("chat_vibe_clip_uploads")
      .select(
        "id, match_id, client_request_id, status, provider_object_id, expires_at, updated_at, published_message_id, duration_ms, aspect_ratio, source_bytes, mime_type",
      );
    query = query
      .eq("sender_id", userId)
      .in("status", ["uploading", "processing"])
      .lt("updated_at", staleBefore);
    if (matchId) query = query.eq("match_id", matchId);

    const { data, error } = await query.order("updated_at", { ascending: true }).limit(20);
    if (error) {
      trackVibeClipEvent("clip_recovery_status", {
        trigger,
        outcome: "query_failed",
        checked_count: 0,
        latency_ms: Date.now() - startedAtMs,
      });
      return;
    }

    const rows = Array.isArray(data) ? data : [];
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
      if (syncedStatus === "ready") {
        selfHealedCount += 1;
        continue;
      }
      if (syncedStatus === "failed") terminalFailedCount += 1;
      stillStuck.push({
        ...upload,
        status: syncedStatus,
        providerObjectId: synced?.providerObjectId ?? upload.providerObjectId,
        expiresAt: synced?.expiresAt ?? upload.expiresAt,
        updatedAt: synced?.updatedAt ?? upload.updatedAt,
        publishedMessageId: synced?.messageId ?? upload.publishedMessageId,
      });
    }
    if (rows.length > 0) {
      const stuckCount = stillStuck.filter((upload) => upload.status !== "failed").length;
      trackVibeClipEvent("clip_recovery_status", {
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
        if (matchId && upload.matchId === matchId) continue;
        nextById.set(upload.id, upload);
      }
      for (const upload of stillStuck) nextById.set(upload.id, upload);
      return Array.from(nextById.values()).sort((a, b) => {
        const at = new Date(a.updatedAt ?? 0).getTime();
        const bt = new Date(b.updatedAt ?? 0).getTime();
        return at - bt;
      });
    });
  }, [userId]);

  const processTick = useCallback(
    async (queryClient: QueryClient) => {
      if (!userId) return;
      const online = isOnline();
      const now = Date.now();
      const recovered = recoverInterruptedSendingItems(itemsRef.current, {
        now,
        online,
        activeProcessingIds: processingRef.current,
      });
      if (recovered !== itemsRef.current) {
        itemsRef.current = recovered;
        setItems(recovered);
      }

      for (const item of itemsRef.current) {
        if (item.state !== "awaiting_hydration") continue;
        let serverMessageId = item.serverMessageId;
        const deadlineAtMs = item.hydrationDeadlineAtMs ?? item.updatedAtMs + HYDRATION_TIMEOUT_MS;
        const lastCheckedAtMs = item.hydrationLastCheckedAtMs ?? 0;
        const dueForCheck = now - lastCheckedAtMs >= HYDRATION_CHECK_INTERVAL_MS;
        const pastDeadline = now >= deadlineAtMs;
        if (online && item.payload.kind === "video" && (dueForCheck || pastDeadline)) {
          const synced = await syncChatVibeClipUploadStatus({
            messageId: serverMessageId,
            clientRequestId: item.id,
          });
          if (synced?.messageId && synced.messageId !== serverMessageId) {
            serverMessageId = synced.messageId;
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      serverMessageId: synced.messageId ?? it.serverMessageId,
                      hydrationLastCheckedAtMs: now,
                      hydrationDeadlineAtMs: deadlineAtMs,
                      updatedAtMs: now,
                    }
                  : it,
              ),
            );
          }
        }
        if (!serverMessageId) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: "failed" as const,
                    lastError: "Message confirmation missing. Retry to continue.",
                    nextRetryAtMs: now + HYDRATION_RECOVERY_BACKOFF_MS,
                    updatedAtMs: now,
                  }
                : it,
            ),
          );
          continue;
        }
        if (!online) continue;

        if (!dueForCheck && !pastDeadline) continue;

        const { data: serverRow } = await supabase
          .from("messages")
          .select("id")
          .eq("id", serverMessageId)
          .eq("match_id", item.matchId)
          .maybeSingle();

        if (serverRow?.id) {
          const key = itemPayloadBlobKey(item);
          if (key) void deleteOutboxBlob(key);
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: "sent" as const,
                    hydrationLastCheckedAtMs: now,
                    hydrationDeadlineAtMs: deadlineAtMs,
                    updatedAtMs: now,
                  }
                : it,
            ),
          );
          invalidateAfterThreadMutation(queryClient, item.invalidateScope);
          continue;
        }

        if (pastDeadline) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    state: "failed" as const,
                    lastError: "Message still syncing. Retry to resend safely.",
                    nextRetryAtMs: now + HYDRATION_RECOVERY_BACKOFF_MS,
                    hydrationLastCheckedAtMs: now,
                    hydrationDeadlineAtMs: deadlineAtMs,
                    updatedAtMs: now,
                  }
                : it,
            ),
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
                : it,
            ),
          );
        }
      }

      const byMatch = new Map<string, WebChatOutboxItem[]>();
      for (const it of itemsRef.current) {
        if (it.state === "canceled" || it.state === "sent") continue;
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
              ? { ...it, state: "sending" as const, attemptCount, updatedAtMs: Date.now() }
              : it,
          ),
        );

        try {
          const { serverMessageId, uploadedPublicUrl, uploadedMediaUrl } = await executeWebOutboxItem(
            { ...next, attemptCount },
            queryClient,
            (fraction) => {
              const uploadProgress = Math.max(0, Math.min(1, fraction));
              setItems((prev) =>
                prev.map((it) =>
                  it.id === next.id
                    ? { ...it, uploadProgress, updatedAtMs: Date.now() }
                    : it,
                ),
              );
            },
            {
              mediaV2VideoEnabled: mediaV2Video.enabled,
              mediaV2PhotoEnabled: mediaV2Photo.enabled,
              mediaV2VoiceEnabled: mediaV2Voice.enabled,
            },
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
                    uploadProgress: undefined,
                    vibeClipResumeStrategy: undefined,
                    state: "awaiting_hydration" as const,
                    lastError: undefined,
                    nextRetryAtMs: undefined,
                    hydrationLastCheckedAtMs: undefined,
                    hydrationDeadlineAtMs: successAtMs + HYDRATION_TIMEOUT_MS,
                    updatedAtMs: successAtMs,
                  }
                : it,
            ),
          );
        } catch (e) {
          const rawMsg = e instanceof Error ? e.message : "Send failed";
          const backoff = nextBackoffMs(attemptCount);
          const uploadedPublicUrl = e instanceof WebOutboxExecuteError ? e.uploadedPublicUrl : undefined;
          const uploadedMediaUrl = e instanceof WebOutboxExecuteError ? e.uploadedMediaUrl : undefined;
          const offlineNow = !isOnline();
          const likelyNet = isLikelyNetworkFailure(e);
          const treatAsOfflineWait = offlineNow || likelyNet;
          const isClip = next.payload.kind === "video";
          setItems((prev) =>
            prev.map((it) =>
              it.id === next.id
                ? {
                    ...it,
                    uploadedPublicUrl: uploadedPublicUrl ?? it.uploadedPublicUrl,
                    uploadedMediaUrl: uploadedMediaUrl ?? it.uploadedMediaUrl,
                    uploadProgress: undefined,
                    state: treatAsOfflineWait ? ("waiting_for_network" as const) : ("failed" as const),
                    lastError: treatAsOfflineWait ? undefined : outboxFailureUserMessage(rawMsg, isClip),
                    nextRetryAtMs: treatAsOfflineWait ? undefined : Date.now() + backoff,
                    attemptCount: treatAsOfflineWait ? next.attemptCount : attemptCount,
                    updatedAtMs: Date.now(),
                  }
                : it,
            ),
          );
        } finally {
          processingRef.current.delete(next.id);
        }
      }
    },
    [mediaV2Photo.enabled, mediaV2Video.enabled, mediaV2Voice.enabled, userId],
  );

  const value = useMemo<WebChatOutboxContextValue>(
    () => ({
      items,
      enqueue,
      retry,
      retryVibeClipUpload,
      remove,
      itemsForMatch,
      runVibeClipRecoverySweep,
      staleVibeClipUploadsForMatch,
      reconcileWithServerIds,
      processTick,
    }),
    [
      items,
      enqueue,
      retry,
      retryVibeClipUpload,
      remove,
      itemsForMatch,
      runVibeClipRecoverySweep,
      staleVibeClipUploadsForMatch,
      reconcileWithServerIds,
      processTick,
    ],
  );

  return <WebChatOutboxContext.Provider value={value}>{children}</WebChatOutboxContext.Provider>;
}

export function useWebChatOutbox(): WebChatOutboxContextValue {
  const ctx = useContext(WebChatOutboxContext);
  if (!ctx) {
    throw new Error("useWebChatOutbox must be used within WebChatOutboxProvider");
  }
  return ctx;
}

/** Background driver: online/offline + interval (mirrors native ChatOutboxRunner). */
export function WebChatOutboxRunner() {
  const queryClient = useQueryClient();
  const { processTick } = useWebChatOutbox();

  const tick = useCallback(async () => {
    await processTick(queryClient);
  }, [processTick, queryClient]);

  useEffect(() => {
    void tick();
  }, [tick]);

  useEffect(() => {
    const onNet = () => {
      void tick();
    };
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    const interval = setInterval(() => {
      void tick();
    }, 4000);
    return () => {
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
      clearInterval(interval);
    };
  }, [tick]);

  return null;
}
