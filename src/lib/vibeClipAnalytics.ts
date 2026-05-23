import type { MediaTelemetryProperties } from '@clientShared/media/telemetry';
import { trackMediaTelemetryEvent } from '@/lib/mediaTelemetry';
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
  trackMediaTelemetryEvent(name, properties, { defaults: base() });
}
