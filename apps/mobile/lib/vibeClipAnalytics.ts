import { Platform } from 'react-native';
import type { MediaTelemetryProperties } from '@clientShared/media/telemetry';
import { trackMediaTelemetryEvent } from '@/lib/mediaTelemetry';
import type { VibeClipEventName } from '../../../shared/chat/vibeClipAnalytics';

type Props = MediaTelemetryProperties;

const base = () => ({
  surface: 'native' as const,
  platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
});

export function trackVibeClipEvent(name: VibeClipEventName, properties?: Props): void {
  trackMediaTelemetryEvent(name, properties, { defaults: base() });
}
