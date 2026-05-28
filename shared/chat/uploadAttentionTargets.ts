export type UploadAttentionTargetKind = "local_failed" | "server_stale";

export type UploadAttentionTarget = {
  kind: UploadAttentionTargetKind;
  attentionId: string;
  matchId: string;
  otherUserId: string | null;
  clientRequestId: string;
  updatedAtMs: number;
  mediaKind: string;
  status: string;
  label: string;
};

export type UploadAttentionValidationResult =
  | { status: "valid"; target: UploadAttentionTarget }
  | {
      status: "cleared";
      reason:
        | "already_sent"
        | "already_dismissed"
        | "not_found"
        | "not_failed"
        | "ready"
        | "not_actionable";
    }
  | { status: "unknown"; reason: "sync_failed" | "lookup_failed" };

export type UploadAttentionClearedReason = Extract<
  UploadAttentionValidationResult,
  { status: "cleared" }
>["reason"];

export type UploadAttentionSkipResult =
  | { status: "removed"; target: UploadAttentionTarget }
  | { status: "cleared"; reason: UploadAttentionClearedReason }
  | { status: "failed"; reason: "sync_failed" | "lookup_failed" | "remove_failed" };

export type UploadAttentionLocalItem = {
  id: string;
  matchId: string;
  otherUserId?: string | null;
  payload: { kind: string };
  state: string;
  updatedAtMs?: number | null;
  createdAtMs?: number | null;
};

export type UploadAttentionServerUpload = {
  id: string;
  matchId: string;
  otherUserId?: string | null;
  clientRequestId?: string | null;
  status: string;
  updatedAt?: string | null;
  recoveryDismissedAt?: string | null;
  publishedMessageId?: string | null;
};

function mediaKindForPayload(kind: string): string {
  return kind === "video" ? "clip" : kind;
}

function labelForMediaKind(mediaKind: string): string {
  switch (mediaKind) {
    case "clip":
    case "video":
      return "Clip upload needs attention";
    case "image":
      return "Photo upload needs attention";
    case "voice":
      return "Voice upload needs attention";
    default:
      return "Upload needs attention";
  }
}

function timestampFromIso(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function timestampFromLocalItem(item: UploadAttentionLocalItem): number {
  const updatedAtMs = typeof item.updatedAtMs === "number" && Number.isFinite(item.updatedAtMs)
    ? item.updatedAtMs
    : null;
  if (updatedAtMs != null) return updatedAtMs;
  const createdAtMs = typeof item.createdAtMs === "number" && Number.isFinite(item.createdAtMs)
    ? item.createdAtMs
    : null;
  return createdAtMs ?? 0;
}

function isActionableServerUpload(upload: UploadAttentionServerUpload): boolean {
  if (upload.recoveryDismissedAt || upload.publishedMessageId) return false;
  return upload.status === "uploading" || upload.status === "processing" || upload.status === "failed";
}

function navigableOtherUserId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildRecoveryAttentionTargets(
  items: UploadAttentionLocalItem[],
  staleUploads: UploadAttentionServerUpload[],
): UploadAttentionTarget[] {
  const targetsByClientRequestId = new Map<string, UploadAttentionTarget>();

  for (const item of items) {
    if (item.payload.kind === "text" || item.state !== "failed") continue;
    const clientRequestId = item.id.trim();
    if (!clientRequestId) continue;
    const otherUserId = navigableOtherUserId(item.otherUserId);
    if (!otherUserId) continue;
    const mediaKind = mediaKindForPayload(item.payload.kind);
    targetsByClientRequestId.set(clientRequestId, {
      kind: "local_failed",
      attentionId: `local:${clientRequestId}`,
      matchId: item.matchId,
      otherUserId,
      clientRequestId,
      updatedAtMs: timestampFromLocalItem(item),
      mediaKind,
      status: item.state,
      label: labelForMediaKind(mediaKind),
    });
  }

  for (const upload of staleUploads) {
    if (!isActionableServerUpload(upload)) continue;
    const uploadId = upload.id.trim();
    if (!uploadId) continue;
    const otherUserId = navigableOtherUserId(upload.otherUserId);
    if (!otherUserId) continue;
    const clientRequestId = upload.clientRequestId?.trim() || uploadId;
    if (targetsByClientRequestId.has(clientRequestId)) continue;
    const mediaKind = "clip";
    targetsByClientRequestId.set(clientRequestId, {
      kind: "server_stale",
      attentionId: `server:${uploadId}`,
      matchId: upload.matchId,
      otherUserId,
      clientRequestId,
      updatedAtMs: timestampFromIso(upload.updatedAt),
      mediaKind,
      status: upload.status,
      label: labelForMediaKind(mediaKind),
    });
  }

  return Array.from(targetsByClientRequestId.values()).sort((a, b) => {
    const time = a.updatedAtMs - b.updatedAtMs;
    if (time !== 0) return time;
    return a.attentionId.localeCompare(b.attentionId);
  });
}

export function uploadAttentionTargetIdentity(target: UploadAttentionTarget): string {
  return [
    target.kind,
    target.attentionId,
    target.matchId,
    target.otherUserId ?? "",
    target.clientRequestId,
  ].join(":");
}

export function normalizeServerRecoveryAttentionTarget(
  target: UploadAttentionTarget,
  upload: UploadAttentionServerUpload,
): UploadAttentionTarget | null {
  const uploadId = upload.id.trim();
  const otherUserId = navigableOtherUserId(upload.otherUserId ?? target.otherUserId);
  const clientRequestId = upload.clientRequestId?.trim() || target.clientRequestId.trim();
  if (!uploadId || !otherUserId || !clientRequestId) return null;
  const updatedAtMs = timestampFromIso(upload.updatedAt);
  return {
    ...target,
    kind: "server_stale",
    attentionId: `server:${uploadId}`,
    matchId: upload.matchId || target.matchId,
    otherUserId,
    clientRequestId,
    updatedAtMs: updatedAtMs || target.updatedAtMs,
    mediaKind: "clip",
    status: upload.status,
    label: labelForMediaKind("clip"),
  };
}

export function selectPrimaryRecoveryAttentionTarget(
  targets: UploadAttentionTarget[],
  currentOtherUserId?: string | null,
): UploadAttentionTarget | null {
  if (targets.length === 0) return null;
  if (currentOtherUserId) {
    const currentThreadTarget = targets.find((target) => target.otherUserId === currentOtherUserId);
    if (currentThreadTarget) return currentThreadTarget;
  }
  return targets[0] ?? null;
}
