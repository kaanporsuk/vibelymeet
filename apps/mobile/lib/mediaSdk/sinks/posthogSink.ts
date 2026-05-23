import type { MediaTelemetryEvent, MediaTelemetrySink } from '@clientShared/media-sdk';
import { sanitizeMediaTelemetryProperties } from '@clientShared/media/telemetry';
import { trackEvent } from '@/lib/analytics';

function propertiesForEvent(event: MediaTelemetryEvent): Record<string, string | number | boolean | null> {
  return sanitizeMediaTelemetryProperties({
    family: event.family ?? null,
    platform: event.platform ?? 'native',
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    sdk_event_at_ms: event.atMs,
    ...(event.fields ?? {}),
  }, { allowSensitiveKeys: ['path', 'path_selected'] });
}

export const nativeMediaPostHogSink: MediaTelemetrySink = {
  capture(event) {
    trackEvent(event.name, propertiesForEvent(event));
  },
};
