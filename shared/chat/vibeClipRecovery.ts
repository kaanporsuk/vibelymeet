export type VibeClipUploadStatus = "uploading" | "processing" | "ready" | "failed";

export type VibeClipRecoveryResumeStrategy = "tus_offset" | "reissue_credentials";

export type VibeClipRecoveryTelemetryOutcome =
  | "hidden"
  | "resumable"
  | "reissue_credentials"
  | "discard_only"
  | "self_healed"
  | "terminal_failed";

export type MediaUploadSuspendedRecoveryOutcome =
  | "resumed"
  | "discarded"
  | "lost"
  | "stuck"
  | "self_healed"
  | "failed";

export type VibeClipServerUpload = {
  id: string;
  matchId: string;
  clientRequestId: string;
  status: VibeClipUploadStatus;
  providerObjectId: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  publishedMessageId?: string | null;
  durationMs?: number | null;
  aspectRatio?: number | null;
  sourceBytes?: number | null;
  mimeType?: string | null;
};

export type VibeClipRecoveryOutboxSummary = {
  id: string;
  payloadKind: "video" | "image" | "voice" | "text" | string;
  state: string;
  uploadProgress?: number | null;
  lastError?: string | null;
  updatedAtMs?: number | null;
};

export type VibeClipRecoveryDecision = {
  canResume: boolean;
  canDiscard: boolean;
  resumeStrategy: VibeClipRecoveryResumeStrategy | null;
  stateLabel: string;
  error?: string;
  showPanel: boolean;
  telemetryOutcome: VibeClipRecoveryTelemetryOutcome;
};

export function isVibeClipUploadTerminal(status: unknown): status is "ready" | "failed" {
  return status === "ready" || status === "failed";
}

function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function outboxUploadPercent(item: VibeClipRecoveryOutboxSummary | null | undefined): number | null {
  if (!item) return null;
  const progress = item.uploadProgress;
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

function suspensionDurationMs(updatedAt: string | number | null | undefined, nowMs: number): number | null {
  if (updatedAt == null) return null;
  const updatedAtMs = typeof updatedAt === "number" ? updatedAt : new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return null;
  return Math.max(0, nowMs - updatedAtMs);
}

export function mediaUploadSuspendedRecoveryTelemetry(input: {
  clientRequestId: string | null | undefined;
  recoveryOutcome: MediaUploadSuspendedRecoveryOutcome;
  trigger: string;
  nowMs: number;
  serverUpload?: VibeClipServerUpload | null;
  outboxItem?: VibeClipRecoveryOutboxSummary | null;
  localSourcePresent?: boolean | null;
  resumeStrategy?: VibeClipRecoveryResumeStrategy | null;
}): Record<string, string | number | boolean | null> {
  const serverUpload = input.serverUpload ?? null;
  const outboxItem = input.outboxItem ?? null;
  const duration =
    suspensionDurationMs(serverUpload?.updatedAt, input.nowMs) ??
    suspensionDurationMs(outboxItem?.updatedAtMs, input.nowMs);
  return {
    family: "chat_vibe_clip",
    client_request_id: input.clientRequestId ?? serverUpload?.clientRequestId ?? outboxItem?.id ?? null,
    suspension_duration_ms: duration,
    bytes_already_uploaded_pct: outboxUploadPercent(outboxItem),
    recovery_outcome: input.recoveryOutcome,
    trigger: input.trigger,
    resume_strategy: input.resumeStrategy ?? "none",
    local_source_present: input.localSourcePresent ?? null,
    server_status: serverUpload?.status ?? null,
    would_benefit_from_background: true,
  };
}

function stateLabelForInput(params: {
  outboxItem?: VibeClipRecoveryOutboxSummary | null;
  serverUpload?: VibeClipServerUpload | null;
  sendError?: string | null;
}): string {
  if (params.sendError?.trim()) return params.sendError.trim();
  if (params.outboxItem?.lastError?.trim()) return params.outboxItem.lastError.trim();

  const uploadPercent = outboxUploadPercent(params.outboxItem);
  if (uploadPercent != null) return `Uploading ${uploadPercent}%`;

  if (params.serverUpload?.status === "processing") return "Clip is processing. Checking status now.";
  if (params.serverUpload?.status === "uploading") return "Upload was interrupted. Check or recover it here.";

  switch (params.outboxItem?.state) {
    case "awaiting_hydration":
      return "Uploaded. Waiting for the message to appear.";
    case "waiting_for_network":
      return "Upload paused until you're back online.";
    case "failed":
      return "Upload needs attention.";
    case "sending":
      return "Upload is in progress.";
    default:
      return "Upload is queued.";
  }
}

export function buildVibeClipRecovery(input: {
  outboxItem?: VibeClipRecoveryOutboxSummary | null;
  serverUpload?: VibeClipServerUpload | null;
  localSourcePresent: boolean;
  nowMs: number;
  sendError?: string | null;
}): VibeClipRecoveryDecision | null {
  const outboxItem = input.outboxItem ?? null;
  const serverUpload = input.serverUpload ?? null;
  if (!outboxItem && !serverUpload) return null;
  if (outboxItem && outboxItem.payloadKind !== "video") return null;

  if (serverUpload?.publishedMessageId) return null;

  if (serverUpload?.status === "ready") {
    return {
      canResume: false,
      canDiscard: false,
      resumeStrategy: null,
      stateLabel: "Clip is ready. Refreshing the thread.",
      showPanel: false,
      telemetryOutcome: "self_healed",
    };
  }

  if (serverUpload?.status === "failed") {
    return {
      canResume: false,
      canDiscard: true,
      resumeStrategy: null,
      stateLabel: "Clip processing failed. Record or choose it again.",
      error: input.sendError ?? outboxItem?.lastError ?? undefined,
      showPanel: true,
      telemetryOutcome: "terminal_failed",
    };
  }

  const label = stateLabelForInput(input);
  const isLocked = outboxItem?.state === "sending" || outboxItem?.state === "awaiting_hydration";
  const canDiscard = !isLocked;

  if (!input.localSourcePresent) {
    return {
      canResume: false,
      canDiscard: true,
      resumeStrategy: null,
      stateLabel: serverUpload
        ? "Original clip data is no longer on this device. Discard and send again."
        : label,
      error: input.sendError ?? outboxItem?.lastError ?? undefined,
      showPanel: true,
      telemetryOutcome: "discard_only",
    };
  }

  if (isLocked) {
    return {
      canResume: false,
      canDiscard,
      resumeStrategy: null,
      stateLabel: label,
      error: input.sendError ?? outboxItem?.lastError ?? undefined,
      showPanel: Boolean(input.sendError || outboxItem?.lastError || serverUpload),
      telemetryOutcome: "hidden",
    };
  }

  const resumeStrategy: VibeClipRecoveryResumeStrategy =
    serverUpload && isExpired(serverUpload.expiresAt, input.nowMs)
      ? "reissue_credentials"
      : "tus_offset";

  return {
    canResume: true,
    canDiscard,
    resumeStrategy,
    stateLabel: resumeStrategy === "reissue_credentials"
      ? "Upload credentials expired. Resume will refresh them."
      : label,
    error: input.sendError ?? outboxItem?.lastError ?? undefined,
    showPanel: true,
    telemetryOutcome: resumeStrategy === "reissue_credentials" ? "reissue_credentials" : "resumable",
  };
}
