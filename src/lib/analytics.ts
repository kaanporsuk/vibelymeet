import posthog from 'posthog-js';
import { hasAnalyticsConsent } from "@/lib/consent";

type AnalyticsProperties = Record<string, unknown>;

const POSTHOG_HOST_FALLBACK = "https://eu.i.posthog.com";
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST || POSTHOG_HOST_FALLBACK;

let initialized = false;

function isLocalBrowserOrigin(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export const initAnalytics = (): boolean => {
  if (initialized) return true;
  if (typeof window === "undefined") return false;
  if (!hasAnalyticsConsent()) return false;

  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!apiKey) return false;

  posthog.init(apiKey, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    persistence: 'localStorage+cookie',
    disable_session_recording: true,
    session_recording: {
      maskAllInputs: true,
      blockClass: 'ph-no-capture',
    },
    loaded: (posthogInstance) => {
      if (isLocalBrowserOrigin()) {
        posthogInstance.opt_out_capturing();
      }
    },
  });

  initialized = true;
  return true;
};

export const disableAnalytics = () => {
  try {
    posthog.opt_out_capturing();
    posthog.reset();
  } catch {
    /* analytics shutdown must never affect app behavior */
  }
};

function canCaptureAnalytics(): boolean {
  if (!hasAnalyticsConsent()) return false;
  return initAnalytics();
}

// Identify user (call on login)
export const identifyUser = (userId: string, properties?: AnalyticsProperties) => {
  if (!canCaptureAnalytics()) return;
  posthog.identify(userId, properties);
};

// Reset identity (call on logout)
export const resetAnalytics = () => {
  if (!canCaptureAnalytics()) return;
  posthog.reset();
};

// Track a custom event
export const trackEvent = (eventName: string, properties?: AnalyticsProperties) => {
  if (!canCaptureAnalytics()) return;
  posthog.capture(eventName, properties);
};

// Set user properties (non-event, just profile updates)
export const setUserProperties = (properties: AnalyticsProperties) => {
  if (!canCaptureAnalytics()) return;
  posthog.people.set(properties);
};
