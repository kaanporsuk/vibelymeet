import {
  extractChatImageIdentityRef,
  extractRenderableChatImageUrl,
} from "./messageRouting";

export type OutboxReconcileCandidate = {
  id: string;
  serverMessageId?: string | null;
  payload?: { kind?: string | null } | null;
};

export type OutboxServerMessageReconcileInput = {
  serverMessageIds: ReadonlySet<string>;
  completedClientRequestIds: ReadonlySet<string>;
};

export function shouldPruneOutboxItemAfterServerReconcile(
  item: OutboxReconcileCandidate,
  input: OutboxServerMessageReconcileInput,
): boolean {
  const completedByClientRequestId = input.completedClientRequestIds.has(item.id);
  if (item.payload?.kind === "image" && !completedByClientRequestId) return false;
  if (item.serverMessageId && input.serverMessageIds.has(item.serverMessageId)) return true;
  return completedByClientRequestId;
}

export function isRawMessageDisplayReadyForOutboxCompletion(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const content = (row as { content?: unknown }).content;
  const structuredPayload = (row as { structured_payload?: unknown }).structured_payload;
  const mediaRow = {
    content: typeof content === "string" ? content : "",
    structured_payload: structuredPayload && typeof structuredPayload === "object"
      ? structuredPayload as Record<string, unknown>
      : null,
  };
  const imageIdentity = extractChatImageIdentityRef(mediaRow);
  if (!imageIdentity) return true;
  return Boolean(extractRenderableChatImageUrl(mediaRow));
}
