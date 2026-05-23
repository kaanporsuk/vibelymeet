import { Platform } from 'react-native';
import {
  sanitizeMediaTelemetryProperties,
  type MediaTelemetryProperties,
} from '@clientShared/media/telemetry';
import { trackEvent } from '@/lib/analytics';
import type { VibeClipEventName } from '../../../shared/chat/vibeClipAnalytics';

type Props = MediaTelemetryProperties;

const base = () => ({
  surface: 'native' as const,
  platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
});

export function trackVibeClipEvent(name: VibeClipEventName, properties?: Props): void {
  trackEvent(name, sanitizeMediaTelemetryProperties(properties, { defaults: base() }));
}
