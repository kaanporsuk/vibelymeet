import * as Sentry from "@sentry/react";
import type { MediaTelemetryEvent, MediaTelemetryFields, MediaTelemetrySink } from "@clientShared/media-sdk";
import { sanitizeMediaSdkTelemetryProperties } from "@clientShared/media/mediaTelemetry";

function fieldsForEvent(event: MediaTelemetryEvent): MediaTelemetryFields {
  return sanitizeMediaSdkTelemetryProperties({
    family: event.family ?? null,
    platform: event.platform ?? "web",
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    ...(event.fields ?? {}),
  });
}

export const webMediaSentrySink: MediaTelemetrySink = {
  capture(event) {
    Sentry.addBreadcrumb({
      category: "media-sdk",
      message: event.name,
      level: event.state === "failed" ? "error" : "info",
      data: fieldsForEvent(event),
    });
  },
  captureException(error, fields) {
    const extra = sanitizeMediaSdkTelemetryProperties(fields ?? {});
    Sentry.captureException(error, {
      tags: {
        feature: "media-sdk",
        family: typeof extra.family === "string" ? extra.family : undefined,
        platform: typeof extra.platform === "string" ? extra.platform : "web",
      },
      extra,
    });
  },
};
