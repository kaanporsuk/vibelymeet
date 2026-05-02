import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import {
  initializeBrowserDiagnostics,
  recordServiceWorkerState,
  sanitizeBrowserDiagnosticPayload,
  sanitizeDiagnosticText,
  sanitizeDiagnosticUrl,
} from "./lib/browserDiagnostics";
import { initAnalytics } from "./lib/analytics";
import "./lib/webAuthReturnBootstrap";
import App from "./App.tsx";
import "./index.css";

const SENTRY_DSN_FALLBACK =
  "https://64343f6a6cacbaf88c3aa31954a1da26@o4511012069113856.ingest.de.sentry.io/4511012079403088";
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN || SENTRY_DSN_FALLBACK;

function isLocalBrowserOrigin(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

type SentryBeforeSendEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]["beforeSend"]>>[0];

function sanitizeSentryEvent(event: SentryBeforeSendEvent): SentryBeforeSendEvent {
  if (event.request) {
    event.request.url = sanitizeDiagnosticUrl(event.request.url) ?? undefined;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
    delete event.request.query_string;
  }

  event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
    ...breadcrumb,
    message: sanitizeDiagnosticText(breadcrumb.message, 500) ?? breadcrumb.message,
    data:
      breadcrumb.data && typeof breadcrumb.data === "object"
        ? sanitizeBrowserDiagnosticPayload(breadcrumb.data as Record<string, unknown>)
        : breadcrumb.data,
  }));

  if (event.extra && typeof event.extra === "object") {
    event.extra = sanitizeBrowserDiagnosticPayload(event.extra as Record<string, unknown>);
  }

  event.exception?.values?.forEach((value) => {
    value.type = sanitizeDiagnosticText(value.type, 160) ?? value.type;
    value.value = sanitizeDiagnosticText(value.value, 500) ?? value.value;
  });

  return event;
}

Sentry.init({
  dsn: SENTRY_DSN,
  environment:
    window.location.hostname === "vibelymeet.com" || window.location.hostname === "www.vibelymeet.com"
      ? "production"
      : "development",
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.2,
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    if (isLocalBrowserOrigin()) {
      return null;
    }
    return sanitizeSentryEvent(event);
  },
});

initAnalytics();
initializeBrowserDiagnostics();

window.addEventListener("vibely-onesignal-init-settled", (event) => {
  void recordServiceWorkerState("onesignal_init_settled", {
    sdk_usable: Boolean((event as CustomEvent<{ sdkUsable?: boolean }>).detail?.sdkUsable),
  });
});

createRoot(document.getElementById("root")!).render(<App />);
