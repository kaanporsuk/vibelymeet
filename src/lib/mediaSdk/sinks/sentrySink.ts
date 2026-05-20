import * as Sentry from "@sentry/react";
import type { MediaTelemetryEvent, MediaTelemetryFields, MediaTelemetrySink } from "@clientShared/media-sdk";

function fieldsForEvent(event: MediaTelemetryEvent): MediaTelemetryFields {
  return {
    family: event.family ?? null,
    platform: event.platform ?? "web",
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    ...(event.fields ?? {}),
  };
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
    Sentry.captureException(error, {
      tags: {
        feature: "media-sdk",
        family: typeof fields?.family === "string" ? fields.family : undefined,
        platform: typeof fields?.platform === "string" ? fields.platform : "web",
      },
      extra: fields,
    });
  },
};
