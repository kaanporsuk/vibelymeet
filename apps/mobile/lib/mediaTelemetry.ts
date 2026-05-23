import * as Sentry from '@sentry/react-native';
import {
  sanitizeMediaEventProperties,
  type MediaTelemetryEventSanitizeOptions,
  type MediaTelemetrySanitizedProperties,
} from '@clientShared/media/mediaTelemetry';
import type { MediaTelemetryProperties } from '@clientShared/media/telemetry';
import { trackEvent } from '@/lib/analytics';

type TrackMediaTelemetryOptions = MediaTelemetryEventSanitizeOptions & {
  breadcrumbCategory?: string;
  breadcrumbLevel?: Sentry.SeverityLevel;
};

type CaptureMediaTelemetryOptions = MediaTelemetryEventSanitizeOptions & {
  feature?: string;
  tags?: Record<string, string | undefined>;
  level?: Sentry.SeverityLevel;
};

export type { MediaTelemetryProperties };

export function sanitizeNativeMediaTelemetryProperties(
  properties: MediaTelemetryProperties = {},
  options: MediaTelemetryEventSanitizeOptions = {},
): MediaTelemetrySanitizedProperties {
  return sanitizeMediaEventProperties(properties, {
    ...options,
    defaults: { platform: 'native', ...(options.defaults ?? {}) },
  });
}

export function trackMediaTelemetryEvent(
  eventName: string,
  properties: MediaTelemetryProperties = {},
  options: TrackMediaTelemetryOptions = {},
): void {
  const sanitized = sanitizeNativeMediaTelemetryProperties(properties, options);
  try {
    trackEvent(eventName, sanitized);
  } catch {
    // Telemetry is diagnostic only.
  }
  if (!options.breadcrumbCategory) return;
  try {
    Sentry.addBreadcrumb({
      category: options.breadcrumbCategory,
      message: eventName,
      level: options.breadcrumbLevel ?? 'info',
      data: sanitized,
    });
  } catch {
    // Breadcrumb capture is best-effort.
  }
}

export function addMediaTelemetryBreadcrumb(
  category: string,
  message: string,
  properties: MediaTelemetryProperties = {},
  level: Sentry.SeverityLevel = 'info',
  options: MediaTelemetryEventSanitizeOptions = {},
): void {
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      level,
      data: sanitizeNativeMediaTelemetryProperties(properties, options),
    });
  } catch {
    // Breadcrumb capture is best-effort.
  }
}

export function captureMediaTelemetryException(
  error: unknown,
  properties: MediaTelemetryProperties = {},
  options: CaptureMediaTelemetryOptions = {},
): void {
  try {
    Sentry.captureException(error, {
      tags: { feature: options.feature ?? 'media', ...(options.tags ?? {}) },
      extra: sanitizeNativeMediaTelemetryProperties(properties, options),
    });
  } catch {
    // Sentry capture is diagnostic only.
  }
}

export function captureMediaTelemetryMessage(
  message: string,
  properties: MediaTelemetryProperties = {},
  options: CaptureMediaTelemetryOptions = {},
): void {
  try {
    Sentry.captureMessage(message, {
      level: options.level ?? 'warning',
      tags: { feature: options.feature ?? 'media', ...(options.tags ?? {}) },
      extra: sanitizeNativeMediaTelemetryProperties(properties, options),
    });
  } catch {
    // Sentry capture is diagnostic only.
  }
}
