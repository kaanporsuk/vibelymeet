import type { MediaTelemetry } from "./telemetry";
import type { MediaUploadErrorInfo, MediaUploadResult, MediaUploadState } from "./types";
import type { MediaUploadQueue, MediaUploadQueueRecord } from "./queue";

export type MediaUploadServerState = "uploading" | "processing" | "ready" | "failed" | "superseded" | "missing";

export type MediaUploadServerRecord = {
  state: MediaUploadServerState;
  result?: MediaUploadResult | null;
  error?: MediaUploadErrorInfo | null;
  expiresAtMs?: number | null;
  updatedAtMs?: number | null;
};

export type MediaUploadQueueReconciler = {
  fetch: (record: MediaUploadQueueRecord) => Promise<MediaUploadServerRecord | null>;
  nudge?: (record: MediaUploadQueueRecord, server: MediaUploadServerRecord) => Promise<MediaUploadServerRecord | null>;
};

export type MediaUploadReconcileResult = {
  checked: number;
  retained: number;
  removed: number;
  nudged: number;
  failed: number;
};

const RECONCILE_STATES: readonly MediaUploadState[] = ["created", "uploading", "paused", "processing", "failed"];
export const DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS = 10 * 60 * 1000;

function terminalStateFromServer(state: MediaUploadServerState): "ready" | "failed" | "cancelled" | null {
  if (state === "ready") return "ready";
  if (state === "failed") return "failed";
  if (state === "superseded") return "cancelled";
  return null;
}

function isStaleLocalFailure(record: MediaUploadQueueRecord, nowMs: number, graceMs: number): boolean {
  return record.state === "failed" && nowMs - record.updatedAtMs >= graceMs;
}

export async function reconcileMediaUploadQueue(input: {
  queue: MediaUploadQueue;
  reconciler?: MediaUploadQueueReconciler | null;
  telemetry?: MediaTelemetry | null;
  staleSweepGracePeriodMs?: number;
  reason?: string;
  nowMs?: number;
}): Promise<MediaUploadReconcileResult> {
  const nowMs = input.nowMs ?? Date.now();
  const graceMs = input.staleSweepGracePeriodMs ?? DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS;
  const result: MediaUploadReconcileResult = { checked: 0, retained: 0, removed: 0, nudged: 0, failed: 0 };
  const records = await input.queue.list({ states: RECONCILE_STATES });

  for (const record of records) {
    result.checked += 1;
    try {
      let currentRecord = record;
      let server = input.reconciler ? await input.reconciler.fetch(record) : null;
      const syncActiveServerRecord = async (activeServer: MediaUploadServerRecord): Promise<void> => {
        if (activeServer.state !== "uploading" && activeServer.state !== "processing") return;
        const serverUpdatedAtMs = activeServer.updatedAtMs ?? nowMs;
        const serverSnapshot = {
          ...currentRecord.snapshot,
          state: activeServer.state as Extract<MediaUploadState, "uploading" | "processing">,
          progress: activeServer.state === "processing" ? 1 : currentRecord.snapshot.progress,
          error: null,
          result: activeServer.result ?? currentRecord.snapshot.result,
          updatedAtMs: serverUpdatedAtMs,
        };
        if (
          currentRecord.state !== serverSnapshot.state ||
          currentRecord.snapshot.progress !== serverSnapshot.progress ||
          currentRecord.updatedAtMs !== serverUpdatedAtMs
        ) {
          currentRecord = (await input.queue.update(record.id, {
            state: serverSnapshot.state,
            updatedAtMs: serverUpdatedAtMs,
            snapshot: serverSnapshot,
          })) ?? currentRecord;
        }
      };
      const terminal = server ? terminalStateFromServer(server.state) : null;
      if (terminal && server) {
        await input.queue.remove(record.id);
        result.removed += 1;
        input.telemetry?.emit({
          name: "media_upload_queue_reconciled_terminal",
          family: record.family,
          platform: record.snapshot.platform,
          state: terminal,
          clientRequestId: record.clientRequestId,
          fields: {
            server_state: server.state,
            reconcile_reason: input.reason ?? "manual",
          },
        });
        continue;
      }

      if (server?.state === "missing" && record.state !== "created") {
        await input.queue.remove(record.id);
        result.removed += 1;
        input.telemetry?.emit({
          name: "media_upload_queue_pruned",
          family: record.family,
          platform: record.snapshot.platform,
          state: record.state,
          clientRequestId: record.clientRequestId,
          fields: { reason: "server_missing", reconcile_reason: input.reason ?? "manual" },
        });
        continue;
      }

      if (server) await syncActiveServerRecord(server);

      if (
        server &&
        (server.state === "uploading" || server.state === "processing") &&
        server.expiresAtMs !== null &&
        server.expiresAtMs !== undefined &&
        server.expiresAtMs <= nowMs &&
        input.reconciler?.nudge
      ) {
        const nudged = await input.reconciler.nudge(record, server);
        result.nudged += 1;
        server = nudged ?? server;
        const nudgedTerminal = nudged ? terminalStateFromServer(nudged.state) : null;
        if (nudgedTerminal) {
          await input.queue.remove(record.id);
          result.removed += 1;
          continue;
        }
        if (nudged) await syncActiveServerRecord(nudged);
      }

      if (isStaleLocalFailure(currentRecord, nowMs, graceMs)) {
        await input.queue.remove(record.id);
        result.removed += 1;
        input.telemetry?.emit({
          name: "media_upload_queue_pruned",
          family: record.family,
          platform: record.snapshot.platform,
          state: currentRecord.state,
          clientRequestId: record.clientRequestId,
          fields: { reason: "stale_failed", reconcile_reason: input.reason ?? "manual" },
        });
        continue;
      }

      result.retained += 1;
    } catch (error) {
      result.failed += 1;
      input.telemetry?.exception(error, {
        family: record.family,
        platform: record.snapshot.platform,
        client_request_id: record.clientRequestId,
        reconcile_reason: input.reason ?? "manual",
      });
    }
  }

  return result;
}
