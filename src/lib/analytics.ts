import posthog from 'posthog-js';

type AnalyticsProperties = Record<string, unknown>;

// Identify user (call on login)
export const identifyUser = (userId: string, properties?: AnalyticsProperties) => {
  posthog.identify(userId, properties);
};

// Reset identity (call on logout)
export const resetAnalytics = () => {
  posthog.reset();
};

// Track a custom event
export const trackEvent = (eventName: string, properties?: AnalyticsProperties) => {
  posthog.capture(eventName, properties);
};

// Set user properties (non-event, just profile updates)
export const setUserProperties = (properties: AnalyticsProperties) => {
  posthog.people.set(properties);
};
