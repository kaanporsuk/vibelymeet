import { hasAnalyticsConsent } from "@/lib/consent";

type AnalyticsProperties = Record<string, unknown>;
type PostHogClient = typeof import("posthog-js").default;

const POSTHOG_HOST_FALLBACK = "https://eu.i.posthog.com";
const viteEnv = (
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
) as Record<string, string | undefined>;
const POSTHOG_HOST =
  viteEnv.VITE_POSTHOG_HOST || POSTHOG_HOST_FALLBACK;

let initialized = false;
let loadPromise: Promise<PostHogClient> | null = null;
let posthogClient: PostHogClient | null = null;
const recentEventKeys = new Map<string, number>();

function primitiveProperty(properties: AnalyticsProperties | undefined, key: string): string {
  const value = properties?.[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "none";
}

function dedupeConfigForEvent(
  eventName: string,
  properties: AnalyticsProperties | undefined,
): { key: string; ttlMs: number } | null {
  if (eventName === "$pageview") {
    return { key: `${eventName}:${primitiveProperty(properties, "$current_url")}`, ttlMs: 1000 };
  }

  if (eventName === "push_delivery_health_observed") {
    return {
      key: [
        eventName,
        primitiveProperty(properties, "permission_state"),
        primitiveProperty(properties, "sdk_status"),
        primitiveProperty(properties, "client_health_status"),
        primitiveProperty(properties, "sync_result_code"),
        primitiveProperty(properties, "local_player_present"),
        primitiveProperty(properties, "backend_player_present"),
        primitiveProperty(properties, "backend_subscribed"),
      ].join(":"),
      ttlMs: 60_000,
    };
  }

  if (eventName === "ready_gate_to_date_latency_checkpoint") {
    return {
      key: [
        eventName,
        primitiveProperty(properties, "session_id"),
        primitiveProperty(properties, "checkpoint"),
        primitiveProperty(properties, "source_action"),
        primitiveProperty(properties, "outcome"),
      ].join(":"),
      ttlMs: 2000,
    };
  }

  return null;
}

function shouldSkipDuplicateEvent(eventName: string, properties: AnalyticsProperties | undefined): boolean {
  const config = dedupeConfigForEvent(eventName, properties);
  if (!config) return false;

  const now = Date.now();
  const lastSeenAt = recentEventKeys.get(config.key);
  if (lastSeenAt && now - lastSeenAt < config.ttlMs) return true;

  recentEventKeys.set(config.key, now);
  if (recentEventKeys.size > 256) {
    for (const [key, seenAt] of recentEventKeys) {
      if (now - seenAt > 60_000) recentEventKeys.delete(key);
    }
  }
  return false;
}

function loadPostHog(): Promise<PostHogClient> {
  loadPromise ??= import("posthog-js").then((mod) => {
    posthogClient = mod.default;
    return mod.default;
  });
  return loadPromise;
}

function isLocalBrowserOrigin(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

async function ensureAnalytics(): Promise<PostHogClient | null> {
  if (typeof window === "undefined") return null;
  if (!hasAnalyticsConsent()) return null;

  const apiKey = viteEnv.VITE_POSTHOG_API_KEY;
  if (!apiKey) return null;

  const posthog = await loadPostHog();

  if (!initialized) {
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
        } else {
          posthogInstance.opt_in_capturing();
        }
      },
    });

    initialized = true;
    return posthog;
  }

  if (!isLocalBrowserOrigin()) {
    posthog.opt_in_capturing();
  }

  return posthog;
}

export const initAnalytics = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!hasAnalyticsConsent()) return false;
  void ensureAnalytics();
  return true;
};

export const disableAnalytics = () => {
  if (!posthogClient) return;
  try {
    posthogClient.opt_out_capturing();
    posthogClient.reset();
  } catch {
    /* analytics shutdown must never affect app behavior */
  }
};

async function getAnalyticsForCapture(): Promise<PostHogClient | null> {
  if (!hasAnalyticsConsent()) return null;
  return ensureAnalytics();
}

// Identify user (call on login)
export const identifyUser = (userId: string, properties?: AnalyticsProperties) => {
  void getAnalyticsForCapture().then((posthog) => {
    posthog?.identify(userId, properties);
  });
};

// Reset identity (call on logout)
export const resetAnalytics = () => {
  if (!hasAnalyticsConsent()) return;
  void getAnalyticsForCapture().then((posthog) => {
    posthog?.reset();
  });
};

// Track a custom event
export const trackEvent = (eventName: string, properties?: AnalyticsProperties) => {
  if (shouldSkipDuplicateEvent(eventName, properties)) return;
  void getAnalyticsForCapture().then((posthog) => {
    posthog?.capture(eventName, properties);
  });
};

// Set user properties (non-event, just profile updates)
export const setUserProperties = (properties: AnalyticsProperties) => {
  void getAnalyticsForCapture().then((posthog) => {
    posthog?.people.set(properties);
  });
};
