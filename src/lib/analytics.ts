import posthog from 'posthog-js';

// Identify user (call on login)
export const identifyUser = (userId: string, properties?: Record<string, any>) => {
  posthog.identify(userId, properties);
};

// Reset identity (call on logout)
export const resetAnalytics = () => {
  posthog.reset();
};

// Track a custom event
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  posthog.capture(eventName, properties);
};

// Set user properties (non-event, just profile updates)
export const setUserProperties = (properties: Record<string, any>) => {
  posthog.people.set(properties);
};
