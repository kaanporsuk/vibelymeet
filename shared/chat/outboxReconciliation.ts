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
