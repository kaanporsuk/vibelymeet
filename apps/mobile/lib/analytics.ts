/**
 * PostHog analytics — matches web src/lib/analytics.ts taxonomy.
 * Initialize PostHog in app/_layout.tsx; then use trackEvent / identifyUser / resetAnalytics here.
 */

import PostHog from 'posthog-react-native';

let client: PostHog | null = null;

type CleanProps = Record<string, string | number | boolean>;

function sanitize(props?: Record<string, string | number | boolean | null | undefined>): CleanProps | undefined {
  if (!props) return undefined;
  const clean: CleanProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function setPostHogClient(instance: PostHog | null) {
  client = instance;
}

export function getPostHogClient(): PostHog | null {
  return client;
}

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean | null>) {
  client?.identify(userId, sanitize(properties));
}

export function resetAnalytics() {
  client?.reset();
}

export function trackEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>
) {
  client?.capture(eventName, sanitize(properties));
}

/** Update person properties (after profile load / changes). */
export function setUserProperties(properties: Record<string, string | number | boolean | null>) {
  const p = sanitize(properties);
  if (!client || !p) return;
  const c = client as PostHog & { getDistinctId?: () => string };
  const id = typeof c.getDistinctId === 'function' ? c.getDistinctId() : null;
  if (id) {
    c.identify(id, p);
  }
}

export function screen(screenName: string, properties?: Record<string, string | number | boolean | null>) {
  client?.capture('$screen', { $screen_name: screenName, ...sanitize(properties) });
}
