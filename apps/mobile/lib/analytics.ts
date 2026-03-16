/**
 * PostHog analytics — matches web src/lib/analytics.ts taxonomy.
 * Initialize PostHog in app/_layout.tsx; then use trackEvent / identifyUser / resetAnalytics here.
 */

import PostHog from 'posthog-react-native';

let client: PostHog | null = null;

export function setPostHogClient(instance: PostHog | null) {
  client = instance;
}

export function getPostHogClient(): PostHog | null {
  return client;
}

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean | null>) {
  client?.identify(userId, properties as Record<string, string | number | boolean>);
}

export function resetAnalytics() {
  client?.reset();
}

export function trackEvent(eventName: string, properties?: Record<string, string | number | boolean | null>) {
  client?.capture(eventName, properties as Record<string, string | number | boolean>);
}

export function screen(screenName: string, properties?: Record<string, string | number | boolean | null>) {
  client?.capture('$screen', { $screen_name: screenName, ...properties } as Record<string, string | number | boolean>);
}
