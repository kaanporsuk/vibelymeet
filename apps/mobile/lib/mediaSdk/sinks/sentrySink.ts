import * as Sentry from '@sentry/react-native';
import type { MediaTelemetryEvent, MediaTelemetryFields, MediaTelemetrySink } from '@clientShared/media-sdk';

function fieldsForEvent(event: MediaTelemetryEvent): MediaTelemetryFields {
  return {
    family: event.family ?? null,
    platform: event.platform ?? 'native',
    state: event.state ?? null,
    client_request_id: event.clientRequestId ?? null,
    ...(event.fields ?? {}),
  };
}

export const nativeMediaSentrySink: MediaTelemetrySink = {
  capture(event) {
    Sentry.addBreadcrumb({
      category: 'media-sdk',
      message: event.name,
      level: event.state === 'failed' ? 'error' : 'info',
      data: fieldsForEvent(event),
    });
  },
  captureException(error, fields) {
    Sentry.captureException(error, {
      tags: {
        feature: 'media-sdk',
        family: typeof fields?.family === 'string' ? fields.family : undefined,
        platform: typeof fields?.platform === 'string' ? fields.platform : 'native',
      },
      extra: fields,
    });
  },
};
