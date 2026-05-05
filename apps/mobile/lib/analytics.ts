/**
 * PostHog analytics — matches web src/lib/analytics.ts taxonomy.
 * Initialize PostHog in app/_layout.tsx; then use trackEvent / identifyUser / resetAnalytics here.
 */

import PostHog from 'posthog-react-native';
import { emitVideoDateLaunchLatencyCheckpointObservability } from '@clientShared/observability/videoDateLaunchLatencyCheckpointObservability';
import { supabase } from '@/lib/supabase';

let client: PostHog | null = null;
let analyticsConsentGranted = false;
const LAUNCH_LATENCY_CHECKPOINT_EVENT = 'ready_gate_to_date_latency_checkpoint';

type CleanProps = Record<string, string | number | boolean>;

function recordOperationalLaunchLatencyCheckpoint(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) {
  if (eventName !== LAUNCH_LATENCY_CHECKPOINT_EVENT) return;

  // This is operational reliability telemetry, not PostHog/product analytics:
  // the authenticated RPC stores only allowlisted launch checkpoint fields so
  // operators can debug whether a paid/safety-critical Video Date actually connected.
  void emitVideoDateLaunchLatencyCheckpointObservability({
    client: supabase,
    eventName,
    properties,
  });
}

function sanitize(props?: Record<string, string | number | boolean | null | undefined>): CleanProps | undefined {
  if (!props) return undefined;
  const clean: CleanProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
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
  recordOperationalLaunchLatencyCheckpoint(eventName, properties);
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
  client?.capture('$screen', { $screen_name: screenName, ...sanitize(properties) });
}
