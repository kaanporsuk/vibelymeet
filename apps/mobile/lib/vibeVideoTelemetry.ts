import * as Sentry from '@sentry/react-native';
import { MEDIA_VIBE_VIDEO_EVENTS } from '@clientShared/media/mediaTelemetry';
import type { MediaTelemetryProperties } from '@clientShared/media/telemetry';
import {
  addMediaTelemetryBreadcrumb,
  captureMediaTelemetryException,
  captureMediaTelemetryMessage,
  trackMediaTelemetryEvent,
} from '@/lib/mediaTelemetry';

export const VIBE_VIDEO_EVENTS = MEDIA_VIBE_VIDEO_EVENTS;

export type VibeVideoEventName = (typeof VIBE_VIDEO_EVENTS)[keyof typeof VIBE_VIDEO_EVENTS];

export type VibeVideoTelemetryProperties = MediaTelemetryProperties;

const staleProcessingSeen = new Set<string>();

export function trackVibeVideoEvent(
  eventName: VibeVideoEventName,
  properties: VibeVideoTelemetryProperties = {},
): void {
  trackMediaTelemetryEvent(eventName, properties, { breadcrumbCategory: 'vibe-video' });
}

export function trackStaleVibeVideoProcessing(
  properties: VibeVideoTelemetryProperties = {},
): void {
  const userId = String(properties.user_id ?? properties.userId ?? 'unknown');
  const videoGuid = String(properties.video_guid ?? 'unknown');
  const surface = String(properties.surface ?? properties.source ?? 'unknown');
  const key = `${userId}:${videoGuid}:${surface}`;
  if (staleProcessingSeen.has(key)) return;
  staleProcessingSeen.add(key);
  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.staleProcessingObserved, properties);
}

export function addVibeVideoBreadcrumb(
  message: string,
  properties: VibeVideoTelemetryProperties = {},
  level: Sentry.SeverityLevel = 'info',
): void {
  addMediaTelemetryBreadcrumb('vibe-video', message, properties, level);
}

export function captureVibeVideoException(
  error: unknown,
  properties: VibeVideoTelemetryProperties = {},
): void {
  captureMediaTelemetryException(error, properties, { feature: 'vibe_video' });
}

export function captureVibeVideoMessage(
  message: string,
  properties: VibeVideoTelemetryProperties = {},
  level: Sentry.SeverityLevel = 'warning',
): void {
  captureMediaTelemetryMessage(message, properties, { feature: 'vibe_video', level });
}
