import type { MediaTelemetryEvent, MediaTelemetrySink } from "@clientShared/media-sdk";
import { trackEvent } from "@/lib/analytics";

function propertiesForEvent(event: MediaTelemetryEvent): Record<string, string | number | boolean | null> {
  return {
    family: event.family ?? null,
    platform: event.platform ?? "web",
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    sdk_event_at_ms: event.atMs,
    ...(event.fields ?? {}),
  };
}

export const webMediaPostHogSink: MediaTelemetrySink = {
  capture(event) {
    trackEvent(event.name, propertiesForEvent(event));
  },
};
