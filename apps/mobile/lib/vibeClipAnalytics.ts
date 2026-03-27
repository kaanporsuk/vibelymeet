import { Platform } from 'react-native';
import { trackEvent } from '@/lib/analytics';
import type { VibeClipEventName } from '../../../shared/chat/vibeClipAnalytics';

type Props = Record<string, string | number | boolean | null | undefined>;

function sanitize(props?: Props): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const base = () => ({
  surface: 'native' as const,
  platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
});

export function trackVibeClipEvent(name: VibeClipEventName, properties?: Props): void {
  trackEvent(name, { ...base(), ...sanitize(properties) });
}
