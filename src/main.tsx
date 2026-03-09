import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { initOneSignal } from "./lib/onesignal";
import posthog from 'posthog-js';
import App from "./App.tsx";
import "./index.css";

Sentry.init({
  dsn: "https://64343f6a6cacbaf88c3aa31954a1da26@o4511012069113856.ingest.de.sentry.io/4511012079403088",
  environment: window.location.hostname === "vibelymeet.com" ? "production" : "development",
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
  api_host: 'https://eu.i.posthog.com',
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

initOneSignal();

createRoot(document.getElementById("root")!).render(<App />);
