import type { MediaTelemetryEvent, MediaTelemetrySink } from '@clientShared/media-sdk';
import { sanitizeMediaSdkTelemetryProperties } from '@clientShared/media/mediaTelemetry';
import { trackEvent } from '@/lib/analytics';

function propertiesForEvent(event: MediaTelemetryEvent): Record<string, string | number | boolean | null> {
  return sanitizeMediaSdkTelemetryProperties({
    family: event.family ?? null,
    platform: event.platform ?? 'native',
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    sdk_event_at_ms: event.atMs,
    ...(event.fields ?? {}),
  });
}

export const nativeMediaPostHogSink: MediaTelemetrySink = {
  capture(event) {
    trackEvent(event.name, propertiesForEvent(event));
  },
};
