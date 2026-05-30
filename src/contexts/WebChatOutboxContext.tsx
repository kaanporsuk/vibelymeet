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
import { useQueryClient } from "@tanstack/react-query";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { deleteOutboxBlob, pruneOutboxBlobsExcept } from "@/lib/webChatOutbox/blobIdb";
import { loadWebOutboxItems, saveWebOutboxItems } from "@/lib/webChatOutbox/store";
import {
  executeWebOutboxItem,
  nextBackoffMs,
  WebOutboxExecuteError,
} from "@/lib/webChatOutbox/execute";
import { syncChatVibeClipUploadStatus } from "@/lib/mediaAssetResolver";
import { isLikelyNetworkFailure, outboxFailureUserMessage } from "@/lib/webChatOutbox/network";
import {
  CHAT_MESSAGE_SELECT,
  invalidateAfterThreadMutation,
  patchThreadCacheFromRawMessage,
} from "@/hooks/useMessages";
import { trackEvent } from "@/lib/analytics";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import type { WebChatOutboxItem, WebChatOutboxPayload, WebChatOutboxQueueState } from "@/lib/webChatOutbox/types";
import type { ThreadInvalidateScope } from "../../shared/chat/queryKeys";
import { getSessionUploadSummary, type SessionUploadSummary } from "../../shared/media/session-upload-summary";
import {
  mediaUploadSuspendedRecoveryTelemetry,
  type MediaUploadSuspendedRecoveryOutcome,
  type VibeClipRecoveryDismissResult,
  type VibeClipRecoveryResumeStrategy,
  type VibeClipServerUpload,
  type VibeClipUploadStatus,
} from "../../shared/chat/vibeClipRecovery";
import {
  buildRecoveryAttentionTargets,
  normalizeServerRecoveryAttentionTarget,
  type UploadAttentionTarget,
  type UploadAttentionSkipResult,
  type UploadAttentionValidationResult,
} from "../../shared/chat/uploadAttentionTargets";
import {
  isRawMessageDisplayReadyForOutboxCompletion,
  shouldPruneOutboxItemAfterServerReconcile,
  type OutboxServerMessageReconcileInput,
} from "../../shared/chat/outboxReconciliation";

const HYDRATION_CHECK_INTERVAL_MS = 10_000;
const HYDRATION_TIMEOUT_MS = 90_000;
const HYDRATION_RECOVERY_BACKOFF_MS = 5_000;
const INTERRUPTED_SENDING_RECOVERY_MS = 2 * 60 * 1000;
const STALE_VIBE_CLIP_UPLOAD_AGE_MS = 60_000;
const VIBE_CLIP_RECOVERY_SWEEP_LIMIT = 20;

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

function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function isMediaOutboxItem(item: WebChatOutboxItem): boolean {
  return item.payload.kind !== "text";
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
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .in("id", matchIds);
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
  staleVibeClipUploads: VibeClipServerUpload[];
  recoveryAttentionTargets: UploadAttentionTarget[];
  recoveryAttentionCount: number;
  sessionUploadSummary: SessionUploadSummary;
  enqueue: (input: {
    matchId: string;
    otherUserId: string;
    userId: string;
    payload: WebChatOutboxPayload;
    invalidateScope?: ThreadInvalidateScope;
    threadBucket?: WebChatOutboxItem["threadBucket"];
  }) => string | null;
  retry: (itemId: string) => void;
  retryAllFailed: () => void;
  retryVibeClipUpload: (clientRequestId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => void;
  dismissStaleVibeClipUpload: (uploadId: string) => Promise<VibeClipRecoveryDismissResult | false>;
  validateRecoveryAttentionTarget: (target: UploadAttentionTarget) => Promise<UploadAttentionValidationResult>;
  skipRecoveryAttentionTarget: (target: UploadAttentionTarget) => Promise<UploadAttentionSkipResult>;
  remove: (itemId: string) => void;
  itemsForMatch: (matchId: string) => WebChatOutboxItem[];
  runVibeClipRecoverySweep: (trigger: VibeClipRecoverySweepTrigger, matchId?: string | null) => Promise<void>;
  staleVibeClipUploadsForMatch: (matchId: string) => VibeClipServerUpload[];
  reconcileWithServerMessages: (input: OutboxServerMessageReconcileInput) => void;
  processTick: () => Promise<void>;
};

const WebChatOutboxContext = createContext<WebChatOutboxContextValue | null>(null);

export function WebChatOutboxProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<WebChatOutboxItem[]>([]);
  const [staleVibeClipUploads, setStaleVibeClipUploads] = useState<VibeClipServerUpload[]>([]);
  const [sessionUploadStats, setSessionUploadStats] = useState({ enqueued: 0, succeeded: 0, failed: 0 });
  const itemsRef = useRef(items);
  const staleVibeClipUploadsRef = useRef(staleVibeClipUploads);
  const processingRef = useRef<Set<string>>(new Set());
  const processingAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const processTickRef = useRef<() => Promise<void>>(async () => undefined);
  const tickScheduledRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    staleVibeClipUploadsRef.current = staleVibeClipUploads;
  }, [staleVibeClipUploads]);

  const updateItems = useCallback((updater: WebChatOutboxItem[] | ((prev: WebChatOutboxItem[]) => WebChatOutboxItem[])) => {
    const prev = itemsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
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
    if (typeof queueMicrotask === "function") {
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
    void loadWebOutboxItems(userId).then((loaded) => {
      if (!cancelled) {
        updateItems(
          recoverInterruptedSendingItems(loaded, {
            now: Date.now(),
            online: isOnline(),
            force: true,
          }),
        );
        requestProcessTick();
      }
      // Best-effort GC: drop IndexedDB blobs no longer referenced by any pending item.
      const keepKeys = new Set(
        loaded.map(itemPayloadBlobKey).filter((k): k is string => typeof k === "string" && k.length > 0),
      );
      void pruneOutboxBlobsExcept(keepKeys);
    });
    return () => {
      cancelled = true;
    };
  }, [requestProcessTick, updateItems, userId]);

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
      threadBucket?: WebChatOutboxItem["threadBucket"];
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
        threadBucket: input.threadBucket ?? "unknown",
      };
      updateItems((prev) => [...prev, item].sort((a, b) => a.createdAtMs - b.createdAtMs));
      requestProcessTick();
      if (isMediaOutboxItem(item)) {
        setSessionUploadStats((prev) => ({ ...prev, enqueued: prev.enqueued + 1 }));
      }
      return id;
    },
    [requestProcessTick, updateItems, userId],
  );

  const retryVibeClipUpload = useCallback((itemId: string, resumeStrategy?: VibeClipRecoveryResumeStrategy | null) => {
    updateItems((prev) =>
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
    requestProcessTick();
  }, [requestProcessTick, updateItems]);

  const retry = useCallback((itemId: string) => {
    retryVibeClipUpload(itemId, null);
  }, [retryVibeClipUpload]);

  const retryAllFailed = useCallback(() => {
    updateItems((prev) =>
      prev.map((it) =>
        it.state === "failed"
          ? {
              ...it,
              state: isOnline() ? ("queued" as const) : ("waiting_for_network" as const),
              lastError: undefined,
              nextRetryAtMs: undefined,
              uploadProgress: undefined,
              updatedAtMs: Date.now(),
            }
          : it,
      ),
    );
    requestProcessTick();
  }, [requestProcessTick, updateItems]);

  const dismissStaleVibeClipUpload = useCallback(async (uploadId: string): Promise<VibeClipRecoveryDismissResult | false> => {
    if (!userId) return false;
    const id = uploadId.trim();
    if (!id) return false;
    const trackDismissFailure = () => {
      trackVibeClipEvent("clip_recovery_status", {
        trigger: "manual_discard",
        outcome: "query_failed",
        upload_id: id,
        latency_ms: 0,
      });
    };
    let data: unknown = null;
    let error: unknown = null;
    try {
      const result = await supabase.functions.invoke("dismiss-chat-vibe-clip-upload", {
        body: {
          upload_id: id,
          reason: "user_discard_send_again",
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
    setStaleVibeClipUploads((prev) => prev.filter((upload) => upload.id.trim() !== id));
    return response.already_published ? "already_published" : "dismissed";
  }, [userId]);

  const remove = useCallback((itemId: string) => {
    const toCleanup: string[] = [];
    processingAbortControllersRef.current.get(itemId)?.abort();
    updateItems((prev) =>
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
  }, [updateItems]);

  const reconcileWithServerMessages = useCallback((input: OutboxServerMessageReconcileInput) => {
    const toCleanup: string[] = [];
    updateItems((prev) => {
      let changed = false;
      const next = prev.filter((it) => {
        if (!shouldPruneOutboxItemAfterServerReconcile(it, input)) return true;
        const key = itemPayloadBlobKey(it);
        if (key) toCleanup.push(key);
        changed = true;
        return false;
      });
      return changed ? next : prev;
    });
    if (toCleanup.length > 0) {
      void Promise.all(toCleanup.map((k) => deleteOutboxBlob(k)));
    }
  }, [updateItems]);

  const recoverLocalAttentionIfServerMessageExists = useCallback(async (
    item: WebChatOutboxItem,
  ): Promise<"recovered" | "missing" | "lookup_failed"> => {
    if (!userId) return "lookup_failed";
    const { data, error } = await supabase
      .from("messages")
      .select(CHAT_MESSAGE_SELECT)
      .eq("match_id", item.matchId)
      .eq("sender_id", userId)
      .filter("structured_payload->>client_request_id", "eq", item.id)
      .limit(1);
    if (error) return "lookup_failed";
    const serverRow = Array.isArray(data) ? data[0] : null;
    if (!serverRow?.id) return "missing";

    const serverMessageIds = new Set<string>([String(serverRow.id)]);
    const completedClientRequestIds = new Set<string>();
    const displayReady = isRawMessageDisplayReadyForOutboxCompletion(serverRow);
    const patchScope = item.invalidateScope ?? {
      otherUserId: item.otherUserId,
      currentUserId: item.userId,
      matchId: item.matchId,
    };
    await patchThreadCacheFromRawMessage(queryClient, patchScope, serverRow);
    if (displayReady) {
      completedClientRequestIds.add(item.id);
      reconcileWithServerMessages({ serverMessageIds, completedClientRequestIds });
      return "recovered";
    }

    updateItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? {
              ...it,
              serverMessageId: String(serverRow.id),
              state: "awaiting_hydration" as const,
              lastError: undefined,
              nextRetryAtMs: undefined,
              hydrationLastCheckedAtMs: undefined,
              hydrationDeadlineAtMs: Date.now() + HYDRATION_TIMEOUT_MS,
              updatedAtMs: Date.now(),
            }
          : it,
      ),
    );
    return "recovered";
  }, [queryClient, reconcileWithServerMessages, updateItems, userId]);

  const clearStaleVibeClipUpload = useCallback((uploadId: string) => {
    setStaleVibeClipUploads((prev) => prev.filter((upload) => upload.id !== uploadId));
  }, []);

  const validateRecoveryAttentionTarget = useCallback(async (
    target: UploadAttentionTarget,
  ): Promise<UploadAttentionValidationResult> => {
    if (target.kind === "local_failed") {
      const item = itemsRef.current.find((it) => it.id === target.clientRequestId);
      if (!item) return { status: "cleared", reason: "not_found" };
      if (!isMediaOutboxItem(item)) return { status: "cleared", reason: "not_actionable" };
      if (item.state !== "failed") return { status: "cleared", reason: "not_failed" };

      const recovery = await recoverLocalAttentionIfServerMessageExists(item);
      if (recovery === "recovered") return { status: "cleared", reason: "already_sent" };
      return { status: "valid", target };
    }

    const uploadId = target.attentionId.startsWith("server:")
      ? target.attentionId.slice("server:".length)
      : "";
    const upload = staleVibeClipUploadsRef.current.find(
      (candidate) =>
        candidate.id === uploadId ||
        candidate.clientRequestId === target.clientRequestId,
    );
    if (!upload) return { status: "cleared", reason: "not_found" };
    if (upload.recoveryDismissedAt) return { status: "cleared", reason: "already_dismissed" };
    const currentTarget = normalizeServerRecoveryAttentionTarget(target, upload);
    if (!currentTarget) return { status: "cleared", reason: "not_actionable" };
    if (upload.publishedMessageId) {
      clearStaleVibeClipUpload(upload.id);
      return { status: "cleared", reason: "already_sent" };
    }
    if (upload.status === "ready") {
      clearStaleVibeClipUpload(upload.id);
      return { status: "cleared", reason: "ready" };
    }

    const synced = await syncChatVibeClipUploadStatus({
      uploadId: upload.id,
      clientRequestId: upload.clientRequestId,
    });
    if (!synced) {
      return upload.status === "failed"
        ? { status: "valid", target: currentTarget }
        : { status: "unknown", reason: "sync_failed" };
    }
    if (synced.messageId) {
      clearStaleVibeClipUpload(upload.id);
      return { status: "cleared", reason: "already_sent" };
    }
    if (synced.status === "ready") {
      clearStaleVibeClipUpload(upload.id);
      return { status: "cleared", reason: "ready" };
    }

    const syncedUploadForTarget = {
      ...upload,
      id: synced.uploadId ?? upload.id,
      matchId: synced.matchId ?? upload.matchId,
      clientRequestId: synced.clientRequestId ?? upload.clientRequestId,
      status: synced.status,
      updatedAt: synced.updatedAt ?? upload.updatedAt,
    };
    const updatedTarget = normalizeServerRecoveryAttentionTarget(currentTarget, syncedUploadForTarget) ?? currentTarget;
    setStaleVibeClipUploads((prev) =>
      prev.map((candidate) =>
        candidate.id === upload.id
          ? {
              ...candidate,
              id: synced.uploadId ?? candidate.id,
              matchId: synced.matchId ?? candidate.matchId,
              clientRequestId: synced.clientRequestId ?? candidate.clientRequestId,
              status: synced.status,
              providerObjectId: synced.providerObjectId ?? candidate.providerObjectId,
              expiresAt: synced.expiresAt ?? candidate.expiresAt,
              updatedAt: synced.updatedAt ?? candidate.updatedAt,
              publishedMessageId: synced.messageId ?? candidate.publishedMessageId,
            }
          : candidate,
      ),
    );
    return { status: "valid", target: updatedTarget };
  }, [clearStaleVibeClipUpload, recoverLocalAttentionIfServerMessageExists]);

  const skipRecoveryAttentionTarget = useCallback(async (
    target: UploadAttentionTarget,
  ): Promise<UploadAttentionSkipResult> => {
    const validation = await validateRecoveryAttentionTarget(target);
    if (validation.status === "cleared") return { status: "cleared", reason: validation.reason };
    if (validation.status === "unknown") return { status: "failed", reason: validation.reason };

    if (validation.target.kind === "local_failed") {
      remove(validation.target.clientRequestId);
      return { status: "removed", target: validation.target };
    }

    const uploadId = validation.target.attentionId.startsWith("server:")
      ? validation.target.attentionId.slice("server:".length)
      : "";
    if (!uploadId) return { status: "failed", reason: "remove_failed" };
    const dismissed = await dismissStaleVibeClipUpload(uploadId);
    if (!dismissed) return { status: "failed", reason: "remove_failed" };
    if (dismissed === "already_published") return { status: "cleared", reason: "already_sent" };
    return { status: "removed", target: validation.target };
  }, [dismissStaleVibeClipUpload, remove, validateRecoveryAttentionTarget]);

  const itemsForMatch = useCallback(
    (matchId: string) =>
      items.filter((it) => it.matchId === matchId && it.state !== "canceled" && it.state !== "sent"),
    [items],
  );

  const staleVibeClipUploadsForMatch = useCallback(
    (matchId: string) => staleVibeClipUploads.filter((upload) => upload.matchId === matchId),
    [staleVibeClipUploads],
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
        from: (table: "chat_vibe_clip_uploads") => {
          select: (columns: string) => ChatVibeClipUploadSweepQuery;
        };
      })
        .from("chat_vibe_clip_uploads")
        .select(
          "id, match_id, client_request_id, status, provider_object_id, expires_at, updated_at, recovery_dismissed_at, published_message_id, duration_ms, aspect_ratio, source_bytes, mime_type",
        )
        .eq("sender_id", userId)
        .in("status", statuses)
        .is("published_message_id", null)
        .is("recovery_dismissed_at", null)
        .lt("updated_at", staleBefore);
      if (matchId) query = query.eq("match_id", matchId);
      return query.order("updated_at", { ascending: true }).limit(limit);
    };

    const recoverableResult = await selectStaleUploadRows(["uploading", "processing"], VIBE_CLIP_RECOVERY_SWEEP_LIMIT);
    if (recoverableResult.error) {
      trackVibeClipEvent("clip_recovery_status", {
        trigger,
        outcome: "query_failed",
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
        ["failed"],
        VIBE_CLIP_RECOVERY_SWEEP_LIMIT - recoverableRows.length,
      );
      if (failedResult.error) {
        failedTopUpQueryFailed = true;
        trackVibeClipEvent("clip_recovery_status", {
          trigger,
          outcome: "query_failed",
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
      if (syncedStatus === "ready") {
        selfHealedCount += 1;
        trackVibeClipEvent("media_upload_suspended_recovery", mediaUploadSuspendedRecoveryTelemetry({
          clientRequestId: upload.clientRequestId,
          trigger,
          recoveryOutcome: "self_healed",
          nowMs: Date.now(),
          serverUpload: {
            ...upload,
            status: "ready",
            providerObjectId: synced?.providerObjectId ?? upload.providerObjectId,
            expiresAt: synced?.expiresAt ?? upload.expiresAt,
            updatedAt: upload.updatedAt,
            publishedMessageId: synced?.messageId ?? upload.publishedMessageId,
          },
          localSourcePresent: false,
        }));
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
    const stillStuckWithPeers = await attachOtherUserIdsToStaleUploads(stillStuck, userId);
    if (rows.length > 0) {
      const stuckCount = stillStuckWithPeers.filter((upload) => upload.status !== "failed").length;
      for (const upload of stillStuckWithPeers) {
        const recoveryOutcome: MediaUploadSuspendedRecoveryOutcome =
          upload.status === "failed" ? "failed" : "stuck";
        trackVibeClipEvent("media_upload_suspended_recovery", mediaUploadSuspendedRecoveryTelemetry({
          clientRequestId: upload.clientRequestId,
          trigger,
          recoveryOutcome,
          nowMs: Date.now(),
          serverUpload: upload,
          localSourcePresent: false,
        }));
      }
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
        if (!matchId) {
          if (failedTopUpQueryFailed && upload.status === "failed") nextById.set(upload.id, upload);
          continue;
        }
        if (matchId && upload.matchId === matchId) {
          if (failedTopUpQueryFailed && upload.status === "failed") nextById.set(upload.id, upload);
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
      const online = isOnline();
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
                  : it,
              ),
            );
          }
        }
        if (!serverMessageId) {
          updateItems((prev) =>
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
          .select(CHAT_MESSAGE_SELECT)
          .eq("id", serverMessageId)
          .eq("match_id", item.matchId)
          .maybeSingle();

        if (serverRow?.id) {
          const patchScope: ThreadInvalidateScope = item.invalidateScope ?? {
            otherUserId: item.otherUserId,
            currentUserId: item.userId,
            matchId: item.matchId,
          };
          const patchResult = await patchThreadCacheFromRawMessage(queryClient, patchScope, serverRow);
          if (item.payload.kind === "image" && patchResult.patched && !patchResult.displayReady) {
            updateItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      hydrationLastCheckedAtMs: now,
                      hydrationDeadlineAtMs: pastDeadline ? now + HYDRATION_TIMEOUT_MS : deadlineAtMs,
                      updatedAtMs: now,
                    }
                  : it,
              ),
            );
            invalidateAfterThreadMutation(queryClient, patchScope);
            continue;
          } else {
            const key = itemPayloadBlobKey(item);
            if (key) void deleteOutboxBlob(key);
            updateItems((prev) =>
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
            if (isMediaOutboxItem(item)) {
              setSessionUploadStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
            }
            invalidateAfterThreadMutation(queryClient, patchScope);
            continue;
          }
        }

        if (pastDeadline) {
          updateItems((prev) =>
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
          updateItems((prev) =>
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
        if (list.some((it) => it.state === "sending" || processingRef.current.has(it.id))) continue;
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
              ? { ...it, state: "sending" as const, attemptCount, updatedAtMs: Date.now() }
              : it,
          ),
        );

        try {
          const { serverMessageId, uploadedPublicUrl, uploadedMediaUrl, patchedThreadCache, displayReady } = await executeWebOutboxItem(
            { ...next, attemptCount },
            queryClient,
            (fraction) => {
              const uploadProgress = Math.max(0, Math.min(1, fraction));
              updateItems((prev) =>
                prev.map((it) =>
                  it.id === next.id
                    ? { ...it, uploadProgress, updatedAtMs: Date.now() }
                    : it,
                ),
              );
            },
            { signal: abortController.signal },
          );
          const successAtMs = Date.now();
          const completeImmediately =
            next.payload.kind !== "video" &&
            patchedThreadCache === true &&
            (next.payload.kind !== "image" || displayReady === true);
          if (completeImmediately) {
            const key = itemPayloadBlobKey(next);
            if (key) void deleteOutboxBlob(key);
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
                    state: completeImmediately ? ("sent" as const) : ("awaiting_hydration" as const),
                    lastError: undefined,
                    nextRetryAtMs: undefined,
                    hydrationLastCheckedAtMs: undefined,
                    hydrationDeadlineAtMs: completeImmediately ? undefined : successAtMs + HYDRATION_TIMEOUT_MS,
                    updatedAtMs: successAtMs,
                  }
                : it,
            ),
          );
          if (completeImmediately && isMediaOutboxItem(next)) {
            setSessionUploadStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
          }
          trackEvent("quality.chat_send_latency_observed", {
            payload_kind: next.payload.kind,
            latency_phase: completeImmediately ? "response_patched" : "response_waiting_hydration",
            outcome: "success",
            attempt_count: attemptCount,
            enqueue_to_attempt_ms: attemptStartedAtMs - next.createdAtMs,
            attempt_to_response_ms: successAtMs - attemptStartedAtMs,
            response_to_hydration_ms: completeImmediately ? Date.now() - successAtMs : 0,
            thread_bucket: next.threadBucket ?? "unknown",
          });
        } catch (e) {
          const responseAtMs = Date.now();
          const rawMsg = e instanceof Error ? e.message : "Send failed";
          const backoff = nextBackoffMs(attemptCount);
          const uploadedPublicUrl = e instanceof WebOutboxExecuteError ? e.uploadedPublicUrl : undefined;
          const uploadedMediaUrl = e instanceof WebOutboxExecuteError ? e.uploadedMediaUrl : undefined;
          const offlineNow = !isOnline();
          const likelyNet = isLikelyNetworkFailure(e);
          const treatAsOfflineWait = offlineNow || likelyNet;
          const isClip = next.payload.kind === "video";
          updateItems((prev) =>
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
          if (isMediaOutboxItem(next) && !treatAsOfflineWait) {
            setSessionUploadStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
          }
          trackEvent("quality.chat_send_latency_observed", {
            payload_kind: next.payload.kind,
            latency_phase: "response_error",
            outcome: treatAsOfflineWait ? "offline_wait" : "failed",
            attempt_count: attemptCount,
            enqueue_to_attempt_ms: attemptStartedAtMs - next.createdAtMs,
            attempt_to_response_ms: responseAtMs - attemptStartedAtMs,
            response_to_hydration_ms: 0,
            thread_bucket: next.threadBucket ?? "unknown",
          });
        } finally {
          processingAbortControllersRef.current.delete(next.id);
          processingRef.current.delete(next.id);
          if (itemsRef.current.some((it) => it.matchId === next.matchId && isEligibleToSend(it, isOnline()))) {
            requestProcessTick();
          }
        }
      }
    },
    [queryClient, requestProcessTick, updateItems, userId],
  );

  useEffect(() => {
    processTickRef.current = processTick;
  }, [processTick]);

  const value = useMemo<WebChatOutboxContextValue>(
    () => ({
      items,
      staleVibeClipUploads,
      recoveryAttentionTargets,
      recoveryAttentionCount,
      sessionUploadSummary: getSessionUploadSummary({
        enqueued: sessionUploadStats.enqueued,
        succeeded: sessionUploadStats.succeeded,
        failed: sessionUploadStats.failed,
        failedInQueue: items.filter((it) => isMediaOutboxItem(it) && it.state === "failed").length,
        inFlight: items.filter((it) =>
          isMediaOutboxItem(it) && (it.state === "sending" || it.state === "awaiting_hydration")
        ).length,
        queued: items.filter((it) =>
          isMediaOutboxItem(it) && (it.state === "queued" || it.state === "waiting_for_network")
        ).length,
      }),
      enqueue,
      retry,
      retryAllFailed,
      retryVibeClipUpload,
      dismissStaleVibeClipUpload,
      validateRecoveryAttentionTarget,
      skipRecoveryAttentionTarget,
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
      validateRecoveryAttentionTarget,
      skipRecoveryAttentionTarget,
      remove,
      itemsForMatch,
      runVibeClipRecoverySweep,
      staleVibeClipUploadsForMatch,
      reconcileWithServerMessages,
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
  const { processTick, runVibeClipRecoverySweep } = useWebChatOutbox();

  const tick = useCallback(async () => {
    await processTick();
  }, [processTick]);

  const sweep = useCallback(async (trigger: VibeClipRecoverySweepTrigger) => {
    await runVibeClipRecoverySweep(trigger, null);
  }, [runVibeClipRecoverySweep]);

  useEffect(() => {
    void tick();
    void sweep("mount_sweep");
  }, [sweep, tick]);

  useEffect(() => {
    const onNet = () => {
      void tick();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void tick();
      void sweep("foreground");
    };
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      void tick();
    }, 4000);
    return () => {
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [sweep, tick]);

  return null;
}
