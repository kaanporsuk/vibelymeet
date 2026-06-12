/**
 * PostHog analytics — matches web src/lib/analytics.ts taxonomy.
 * Initialize PostHog in app/_layout.tsx; then use trackEvent / identifyUser / resetAnalytics here.
 */

import PostHog from 'posthog-react-native';
import { sanitizeProductIntelligenceProperties } from '@clientShared/analytics/productIntelligence';

let client: PostHog | null = null;
let analyticsConsentGranted = false;

type CleanProps = Record<string, string | number | boolean>;

function sanitize(props?: Record<string, string | number | boolean | null | undefined>): CleanProps | undefined {
  return sanitizeProductIntelligenceProperties(props, { platform: 'native' });
}

export function setPostHogClient(instance: PostHog | null) {
  client = analyticsConsentGranted ? instance : null;
}

export function getPostHogClient(): PostHog | null {
  return analyticsConsentGranted ? client : null;
}

export function setRuntimeAnalyticsConsent(granted: boolean) {
  analyticsConsentGranted = granted;
  if (!granted) {
    try {
      client?.reset();
    } catch {
      /* analytics shutdown must never affect app behavior */
    }
    client = null;
  }
}

export function hasRuntimeAnalyticsConsent(): boolean {
  return analyticsConsentGranted;
}

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean | null>) {
  if (!analyticsConsentGranted) return;
  client?.identify(userId, sanitize(properties));
}

export function resetAnalytics() {
  if (!analyticsConsentGranted) return;
  client?.reset();
}

export function trackEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) {
  if (!analyticsConsentGranted) return;
  client?.capture(eventName, sanitize(properties));
}

/** Update person properties (after profile load / changes). */
export function setUserProperties(properties: Record<string, string | number | boolean | null>) {
  if (!analyticsConsentGranted) return;
  const p = sanitize(properties);
  if (!client || !p) return;
  const c = client as PostHog & { getDistinctId?: () => string };
  const id = typeof c.getDistinctId === 'function' ? c.getDistinctId() : null;
  if (id) {
    c.identify(id, p);
  }
}

export function screen(screenName: string, properties?: Record<string, string | number | boolean | null>) {
  if (!analyticsConsentGranted) return;
  client?.capture('$screen', sanitize({ ...properties, $screen_name: screenName }));
}
