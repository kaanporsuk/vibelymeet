import type {
  PostDateOutboxItem,
  PostDateOutboxPayload,
  PostDateOutboxQueueState,
  PostDateOutboxResultPayload,
} from "./types";

export const POST_DATE_OUTBOX_MAX_ATTEMPTS = 8;

const BACKOFFS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;

export function newPostDateOutboxItem(params: {
  id: string;
  userId: string;
  sessionId: string;
  eventId?: string | null;
  payload: PostDateOutboxPayload;
  online: boolean;
  nowMs?: number;
}): PostDateOutboxItem {
  const now = params.nowMs ?? Date.now();
  return {
    id: params.id,
    userId: params.userId,
    sessionId: params.sessionId,
    eventId: params.eventId ?? null,
    payload: params.payload,
    state: params.online ? "queued" : "waiting_for_network",
    createdAtMs: now,
    updatedAtMs: now,
    attemptCount: 0,
  };
}

export function postDateOutboxStorageDedupeKey(item: Pick<PostDateOutboxItem, "userId" | "sessionId" | "payload">): string {
  return item.payload.kind === "verdict"
    ? `${item.userId}:${item.sessionId}:verdict`
    : `${item.userId}:${item.sessionId}:report:${item.payload.report.reason}`;
}

export function upsertPostDateOutboxItem(
  items: PostDateOutboxItem[],
  next: PostDateOutboxItem,
): PostDateOutboxItem[] {
  const nextKey = postDateOutboxStorageDedupeKey(next);
  const existing = items.find(
    (item) =>
      item.state !== "sent" &&
      item.state !== "canceled" &&
      postDateOutboxStorageDedupeKey(item) === nextKey,
  );
  const filtered = items.filter((item) => {
    if (item.state === "sent" || item.state === "canceled") return true;
    return postDateOutboxStorageDedupeKey(item) !== nextKey;
  });
  const merged: PostDateOutboxItem = existing
    ? {
        ...existing,
        eventId: next.eventId,
        payload: next.payload,
        state: next.state,
        updatedAtMs: next.updatedAtMs,
        lastError: undefined,
        nextRetryAtMs: undefined,
        lastResult: undefined,
      }
    : next;
  return [...filtered, merged].sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export function isPostDateOutboxItemSendable(item: PostDateOutboxItem, online: boolean, nowMs = Date.now()): boolean {
  if (!online) return false;
  if (item.state === "sent" || item.state === "canceled" || item.state === "sending") return false;
  if (item.state === "failed" && item.nextRetryAtMs != null && nowMs < item.nextRetryAtMs) return false;
  return item.state === "queued" || item.state === "waiting_for_network" || item.state === "failed";
}

export function nextPostDateOutboxBackoffMs(attemptCount: number): number {
  return BACKOFFS_MS[Math.min(Math.max(0, attemptCount - 1), BACKOFFS_MS.length - 1)];
}

export function postDateOutboxFailureMessage(error: string | undefined, payloadKind: PostDateOutboxPayload["kind"]): string {
  if (error === "network" || error === "FunctionsFetchError" || error === "Failed to fetch") {
    return payloadKind === "verdict"
      ? "Waiting for connection to save your answer."
      : "Waiting for connection to submit your report.";
  }
  if (payloadKind === "verdict") return "Couldn't save your answer. Tap to retry.";
  return "Couldn't submit your report. Tap to retry.";
}

export function normalizePostDateOutboxResult(data: unknown): PostDateOutboxResultPayload {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "invalid_response" };
  }
  return data as PostDateOutboxResultPayload;
}

export function shouldTreatPostDateResultAsSuccess(result: PostDateOutboxResultPayload): boolean {
  return result.success !== false && !result.error;
}

export function nextPostDateOutboxStateAfterFailure(params: {
  item: PostDateOutboxItem;
  error: string;
  online: boolean;
  nowMs?: number;
}): Pick<PostDateOutboxItem, "state" | "lastError" | "nextRetryAtMs" | "attemptCount" | "updatedAtMs"> {
  const now = params.nowMs ?? Date.now();
  const attemptCount = params.item.attemptCount + 1;
  const retryable = attemptCount < POST_DATE_OUTBOX_MAX_ATTEMPTS;
  const state: PostDateOutboxQueueState = params.online && retryable ? "failed" : params.online ? "failed" : "waiting_for_network";
  return {
    state,
    attemptCount,
    lastError: postDateOutboxFailureMessage(params.error, params.item.payload.kind),
    nextRetryAtMs: retryable ? now + nextPostDateOutboxBackoffMs(attemptCount) : undefined,
    updatedAtMs: now,
  };
}
