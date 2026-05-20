import type {
  MediaUploadErrorInfo,
  MediaUploadFamily,
  MediaUploadPlatform,
  MediaUploadResult,
  MediaUploadSnapshot,
  MediaUploadState,
} from "./types";

export type MediaUploadTransition =
  | { type: "begin_upload"; atMs?: number }
  | { type: "progress"; progress: number; bytesUploaded?: number; bytesTotal?: number; atMs?: number }
  | { type: "pause"; atMs?: number }
  | { type: "resume"; atMs?: number }
  | { type: "upload_complete"; atMs?: number }
  | { type: "ready"; result?: MediaUploadResult | null; atMs?: number }
  | { type: "fail"; error: MediaUploadErrorInfo; atMs?: number }
  | { type: "cancel"; reason?: string | null; atMs?: number }
  | { type: "retry"; atMs?: number };

export const MEDIA_UPLOAD_STATES: readonly MediaUploadState[] = [
  "created",
  "uploading",
  "paused",
  "processing",
  "ready",
  "failed",
  "cancelled",
] as const;

export function isMediaUploadTerminalState(state: MediaUploadState): boolean {
  return state === "ready" || state === "failed" || state === "cancelled";
}

export function clampUploadProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export function createInitialMediaUploadSnapshot(input: {
  id: string;
  clientRequestId: string;
  family: MediaUploadFamily;
  platform?: MediaUploadPlatform;
  nowMs?: number;
}): MediaUploadSnapshot {
  const now = input.nowMs ?? Date.now();
  return {
    id: input.id,
    clientRequestId: input.clientRequestId,
    family: input.family,
    platform: input.platform ?? "unknown",
    state: "created",
    progress: 0,
    attempt: 0,
    createdAtMs: now,
    updatedAtMs: now,
    error: null,
    result: null,
  };
}

export function transitionMediaUploadState(
  snapshot: MediaUploadSnapshot,
  transition: MediaUploadTransition,
): MediaUploadSnapshot {
  const atMs = transition.atMs ?? Date.now();
  const touch = (patch: Partial<MediaUploadSnapshot>): MediaUploadSnapshot => ({
    ...snapshot,
    ...patch,
    updatedAtMs: atMs,
  });

  switch (transition.type) {
    case "begin_upload": {
      if (snapshot.state !== "created") return snapshot;
      return touch({ state: "uploading", error: null, progress: 0 });
    }
    case "progress": {
      if (snapshot.state !== "created" && snapshot.state !== "uploading") return snapshot;
      const nextProgress = Math.max(snapshot.progress, clampUploadProgress(transition.progress));
      return touch({ state: "uploading", progress: nextProgress, error: null });
    }
    case "pause": {
      if (snapshot.state !== "uploading") return snapshot;
      return touch({ state: "paused" });
    }
    case "resume": {
      if (snapshot.state !== "paused") return snapshot;
      return touch({ state: "uploading", error: null });
    }
    case "upload_complete": {
      if (snapshot.state !== "created" && snapshot.state !== "uploading") return snapshot;
      return touch({ state: "processing", progress: 1, error: null });
    }
    case "ready": {
      if (snapshot.state === "ready" || snapshot.state === "cancelled") return snapshot;
      return touch({
        state: "ready",
        progress: 1,
        error: null,
        result: transition.result ?? snapshot.result,
      });
    }
    case "fail": {
      if (snapshot.state === "ready" || snapshot.state === "failed" || snapshot.state === "cancelled") return snapshot;
      return touch({
        state: "failed",
        error: transition.error,
      });
    }
    case "cancel": {
      if (isMediaUploadTerminalState(snapshot.state)) return snapshot;
      return touch({
        state: "cancelled",
        error: transition.reason
          ? { code: "cancelled", message: transition.reason, retryable: true }
          : null,
      });
    }
    case "retry": {
      if (
        snapshot.state !== "failed" &&
        snapshot.state !== "cancelled" &&
        snapshot.state !== "paused" &&
        snapshot.state !== "uploading"
      ) return snapshot;
      return touch({
        state: "created",
        progress: 0,
        attempt: snapshot.attempt + 1,
        error: null,
        result: null,
      });
    }
  }
}
