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

export function buildRecoveryAttentionTargets(
  items: UploadAttentionLocalItem[],
  staleUploads: UploadAttentionServerUpload[],
): UploadAttentionTarget[] {
  const targetsByClientRequestId = new Map<string, UploadAttentionTarget>();

  for (const item of items) {
    if (item.payload.kind === "text" || item.state !== "failed") continue;
    const mediaKind = mediaKindForPayload(item.payload.kind);
    targetsByClientRequestId.set(item.id, {
      kind: "local_failed",
      attentionId: `local:${item.id}`,
      matchId: item.matchId,
      otherUserId: item.otherUserId ?? null,
      clientRequestId: item.id,
      updatedAtMs: timestampFromLocalItem(item),
      mediaKind,
      status: item.state,
      label: labelForMediaKind(mediaKind),
    });
  }

  for (const upload of staleUploads) {
    if (upload.recoveryDismissedAt) continue;
    const clientRequestId = upload.clientRequestId || upload.id;
    if (targetsByClientRequestId.has(clientRequestId)) continue;
    const mediaKind = "clip";
    targetsByClientRequestId.set(clientRequestId, {
      kind: "server_stale",
      attentionId: `server:${upload.id}`,
      matchId: upload.matchId,
      otherUserId: upload.otherUserId ?? null,
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
