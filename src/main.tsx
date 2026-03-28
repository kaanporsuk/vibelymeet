import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { initOneSignal } from "./lib/onesignal";
import { isOneSignalWebOriginAllowed } from "./lib/oneSignalWebOrigin";
import { vibelyOsLog } from "./lib/onesignalWebDiagnostics";
import posthog from 'posthog-js';
import App from "./App.tsx";
import "./index.css";

const SENTRY_DSN_FALLBACK =
  "https://64343f6a6cacbaf88c3aa31954a1da26@o4511012069113856.ingest.de.sentry.io/4511012079403088";
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN || SENTRY_DSN_FALLBACK;

const POSTHOG_HOST_FALLBACK = "https://eu.i.posthog.com";
const POSTHOG_HOST =
  import.meta.env.VITE_POSTHOG_HOST || POSTHOG_HOST_FALLBACK;

Sentry.init({
  dsn: SENTRY_DSN,
  environment:
    window.location.hostname === "vibelymeet.com" || window.location.hostname === "www.vibelymeet.com"
      ? "production"
      : "development",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    if (window.location.hostname === "localhost") {
      return null;
    }
    return event;
  },
});

posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
  api_host: POSTHOG_HOST,
  person_profiles: 'identified_only',
  capture_pageview: true,
  capture_pageleave: true,
  autocapture: true,
  persistence: 'localStorage+cookie',
  disable_session_recording: false,
  session_recording: {
    maskAllInputs: true,
    blockClass: 'ph-no-capture',
  },
  loaded: (posthog) => {
    if (window.location.hostname === 'localhost') {
      posthog.opt_out_capturing();
    }
  },
});

// Init OneSignal only on allowlisted hosts (see `src/lib/oneSignalWebOrigin.ts`) to avoid dashboard domain errors.
const origin = typeof window !== "undefined" ? window.location.origin : "";
const oneSignalInitAllowed = typeof window !== "undefined" && isOneSignalWebOriginAllowed();
vibelyOsLog("main:boot", { origin, oneSignalInitAllowed });
if (oneSignalInitAllowed) {
  try {
    initOneSignal();
  } catch (e) {
    vibelyOsLog("main:initOneSignal threw", { error: String(e) });
    if (typeof Sentry?.captureMessage === "function") {
      Sentry.captureMessage("OneSignal init skipped or failed", { level: "warning", extra: { error: String(e) } });
    }
  }
} else {
  vibelyOsLog("main:initOneSignal skipped (host not allowlisted)", { origin });
}

createRoot(document.getElementById("root")!).render(<App />);
