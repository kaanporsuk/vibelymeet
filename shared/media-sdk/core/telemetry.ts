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

export function createMediaTelemetry(sinks: readonly MediaTelemetrySink[] = []): MediaTelemetry {
  return {
    emit(event) {
      const fullEvent: MediaTelemetryEvent = { ...event, atMs: event.atMs ?? Date.now() };
      for (const sink of sinks) {
        try {
          sink.capture(fullEvent);
        } catch {
        }
      }
    },
    exception(error, fields) {
      for (const sink of sinks) {
        try {
          sink.captureException?.(error, fields);
        } catch {
        }
      }
    },
  };
}

export const noopMediaTelemetry = createMediaTelemetry();
