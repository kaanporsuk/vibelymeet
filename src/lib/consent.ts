export type AnalyticsConsentState = "unset" | "granted" | "denied";

const ANALYTICS_CONSENT_STORAGE_KEY = "vibely.analytics_consent.v1";
const ANALYTICS_CONSENT_EVENT = "vibely:analytics-consent";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readAnalyticsConsent(): AnalyticsConsentState {
  if (!canUseBrowserStorage()) return "unset";
  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") return stored;
  } catch {
    /* consent storage must never block app boot */
  }
  return "unset";
}

export function hasAnalyticsConsent(): boolean {
  return readAnalyticsConsent() === "granted";
}

export function setAnalyticsConsent(granted: boolean): void {
  if (canUseBrowserStorage()) {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
    } catch {
      /* consent changes still notify current runtime listeners */
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<{ state: AnalyticsConsentState }>(ANALYTICS_CONSENT_EVENT, {
        detail: { state: granted ? "granted" : "denied" },
      }),
    );
  }
}

export function subscribeAnalyticsConsent(
  callback: (state: AnalyticsConsentState) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ state?: AnalyticsConsentState }>).detail;
    callback(detail?.state ?? readAnalyticsConsent());
  };

  window.addEventListener(ANALYTICS_CONSENT_EVENT, handler);
  return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, handler);
}
