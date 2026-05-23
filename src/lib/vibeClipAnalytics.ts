import { trackEvent } from '@/lib/analytics';
import {
  sanitizeMediaTelemetryProperties,
  type MediaTelemetryProperties,
} from '@clientShared/media/telemetry';
import type { VibeClipEventName } from '../../shared/chat/vibeClipAnalytics';

type Props = MediaTelemetryProperties;

const base = () => ({
  surface: 'web' as const,
  platform: 'web' as const,
});

/**
 * Single entry for Vibe Clip funnel events on web.
 */
export function trackVibeClipEvent(name: VibeClipEventName, properties?: Props): void {
  trackEvent(name, sanitizeMediaTelemetryProperties(properties, { defaults: base() }));
}
