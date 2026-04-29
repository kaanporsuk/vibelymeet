import { supabase } from "@/integrations/supabase/client";
import {
  isPostDateOutboxItemSendable,
  newPostDateOutboxItem,
  nextPostDateOutboxStateAfterFailure,
  normalizePostDateOutboxResult,
  postDateOutboxStorageDedupeKey,
  shouldTreatPostDateResultAsSuccess,
  upsertPostDateOutboxItem,
} from "@clientShared/postDateOutbox/core";
import type {
  PostDateOutboxItem,
  PostDateOutboxPayload,
  PostDateOutboxResultPayload,
} from "@clientShared/postDateOutbox/types";
import { loadPostDateOutboxItems, savePostDateOutboxItems } from "./store";

type SubmitPostDateOutboxInput = {
  userId: string;
  sessionId: string;
  eventId?: string | null;
  payload: PostDateOutboxPayload;
};

type DrainOptions = {
  onlyItemId?: string;
};

function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `post-date-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function bodyForItem(item: PostDateOutboxItem): Record<string, unknown> {
  if (item.payload.kind === "report") {
    return {
      action: "report",
      session_id: item.sessionId,
      idempotency_key: item.id,
      safety_report: item.payload.report,
    };
  }

  return {
    action: "verdict",
    session_id: item.sessionId,
    liked: item.payload.liked,
    idempotency_key: item.id,
    safety_report: item.payload.report ?? null,
  };
}

async function invokePostDateItem(item: PostDateOutboxItem): Promise<PostDateOutboxResultPayload> {
  const { data, error } = await supabase.functions.invoke("post-date-verdict", {
    body: bodyForItem(item),
  });
  if (error) {
    const errorName = error instanceof Error ? error.name : "invoke_error";
    return { success: false, error: errorName };
  }
  return normalizePostDateOutboxResult(data);
}

async function updateStoredItem(
  userId: string,
  itemId: string,
  update: (item: PostDateOutboxItem) => PostDateOutboxItem | null,
): Promise<PostDateOutboxItem[]> {
  const items = await loadPostDateOutboxItems(userId);
  const next = items
    .map((item) => (item.id === itemId ? update(item) : item))
    .filter((item): item is PostDateOutboxItem => item !== null);
  await savePostDateOutboxItems(userId, next);
  return next;
}

export async function drainWebPostDateOutbox(
  userId: string,
  options?: DrainOptions,
): Promise<PostDateOutboxResultPayload | null> {
  let latestResult: PostDateOutboxResultPayload | null = null;
  const online = isOnline();
  const items = await loadPostDateOutboxItems(userId);

  for (const item of items) {
    if (options?.onlyItemId && item.id !== options.onlyItemId) continue;
    if (!isPostDateOutboxItemSendable(item, online)) continue;

    await updateStoredItem(userId, item.id, (current) => ({
      ...current,
      state: "sending",
      updatedAtMs: Date.now(),
    }));

    const result = await invokePostDateItem(item);
    latestResult = result;

    if (shouldTreatPostDateResultAsSuccess(result)) {
      await updateStoredItem(userId, item.id, () => null);
      continue;
    }

    const failedOnline = isOnline();
    await updateStoredItem(userId, item.id, (current) => ({
      ...current,
      ...nextPostDateOutboxStateAfterFailure({
        item: current,
        error: result.error ?? result.code ?? "unknown",
        online: failedOnline,
      }),
      lastResult: result,
    }));
  }

  return latestResult;
}

export async function submitWebPostDateOutboxItem(
  input: SubmitPostDateOutboxInput,
): Promise<PostDateOutboxResultPayload> {
  const item = newPostDateOutboxItem({
    id: newId(),
    userId: input.userId,
    sessionId: input.sessionId,
    eventId: input.eventId ?? null,
    payload: input.payload,
    online: isOnline(),
  });
  const existing = await loadPostDateOutboxItems(input.userId);
  const nextItems = upsertPostDateOutboxItem(existing, item);
  const itemKey = postDateOutboxStorageDedupeKey(item);
  const storedItem = nextItems.find((candidate) => postDateOutboxStorageDedupeKey(candidate) === itemKey) ?? item;
  await savePostDateOutboxItems(input.userId, nextItems);

  const result = await drainWebPostDateOutbox(input.userId, { onlyItemId: storedItem.id });
  return result ?? {
    success: false,
    error: isOnline() ? "queued" : "network",
    code: isOnline() ? "queued" : "network",
  };
}
