import type { MediaUploadFamily, MediaUploadPlatform, MediaUploadState } from "./types";

export type MediaTelemetryFields = Record<string, string | number | boolean | null | undefined>;

export type MediaTelemetryEvent = {
  name: string;
  family?: MediaUploadFamily;
  platform?: MediaUploadPlatform;
  state?: MediaUploadState;
  clientRequestId?: string | null;
  fields?: MediaTelemetryFields;
  atMs: number;
};

export interface MediaTelemetrySink {
  capture(event: MediaTelemetryEvent): void;
  captureException?(error: unknown, fields?: MediaTelemetryFields): void;
}

export type MediaTelemetry = {
  emit(event: Omit<MediaTelemetryEvent, "atMs"> & { atMs?: number }): void;
  exception(error: unknown, fields?: MediaTelemetryFields): void;
};

const SAFE_FIELD_KEYS = new Set([
  "active_flag",
  "active_flag_enabled",
  "active_flag_source",
  "active_flag_bucket",
  "active_flag_rollout_bps",
  "attempt",
  "attempt_count",
  "bytes",
  "bytes_total",
  "bytes_uploaded",
  "client_platform",
  "client_request_id",
  "duration_ms",
  "error_code",
  "event",
  "family",
  "network_type",
  "path",
  "path_selected",
  "platform",
  "progress",
  "provider",
  "reconcile_reason",
  "reason",
  "retry_count",
  "server_state",
  "source",
  "state",
  "status",
  "time_to_ready_ms",
  "upload_context",
  "user_id_bucket",
  "webhook_latency_ms",
]);

export function safeTelemetryFields(fields?: MediaTelemetryFields): MediaTelemetryFields | undefined {
  if (!fields) return undefined;
  const safe: MediaTelemetryFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD_KEYS.has(key)) continue;
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function createMediaTelemetry(sinks: readonly MediaTelemetrySink[] = []): MediaTelemetry {
  return {
    emit(event) {
      const fullEvent: MediaTelemetryEvent = {
        ...event,
        fields: safeTelemetryFields(event.fields),
        atMs: event.atMs ?? Date.now(),
      };
      for (const sink of sinks) {
        try {
          sink.capture(fullEvent);
        } catch {
        }
      }
    },
    exception(error, fields) {
      const safeFields = safeTelemetryFields(fields);
      for (const sink of sinks) {
        try {
          sink.captureException?.(error, safeFields);
        } catch {
        }
      }
    },
  };
}

export const noopMediaTelemetry = createMediaTelemetry();
