import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";

type DiagnosticPrimitive = string | number | boolean | null;
type DiagnosticValue =
  | DiagnosticPrimitive
  | DiagnosticValue[]
  | { [key: string]: DiagnosticValue };

export type BrowserDiagnosticPayload = Record<string, unknown>;

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_PAYLOAD_CHARS = 8_000;
const SLOW_EXCHANGE_MS = 10_000;
const STALE_BUNDLE_RELOAD_KEY_PREFIX = "vibely.stale_bundle_reload.v1:";
const STALE_BUNDLE_WINDOW_NAME_PREFIX = "vibely_stale_bundle_reload:";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SECRET_PARAM_RE = /\b(?:access_token|refresh_token|token|code|signature|sig|jwt|apikey|api_key|session|password)=([^&#\s]+)/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const MEDIA_EXT_RE = /\.(?:m3u8|mp4|webm|mov|m4a|mp3|wav|jpg|jpeg|png|webp|gif)(?:$|[?#])/i;
const MEDIA_HOST_RE = /\b(?:bunnycdn|b-cdn|supabase|storage|cloudfront|stream)\b/i;

const REDACTED_KEY_RE =
  /(authorization|apikey|api_key|access_token|refresh_token|jwt|secret|password|otp|code|signed|signature|cookie|session|player_id|onesignal_player_id|mobile_onesignal_player_id)/i;
const CONTENT_KEY_RE =
  /(^|_)(body|message|preview|content|text|name|email|phone|title|caption|about_me|tagline)(_|$)/i;
const URL_KEY_RE = /(url|uri|href|path|route|pathname|src|link|deep_link|current_url)/i;
const ENTRY_MODULE_RE = /^\/assets\/index-[^/]+\.js$/;
const STALE_BUNDLE_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Unable to preload CSS for/i,
  /Expected a JavaScript(?:-or-Wasm)? module script[\s\S]*MIME type(?: of)? ["']?text\/html/i,
  /Failed to load module script[\s\S]*text\/html/i,
];

export const BROWSER_DIAGNOSTIC_EVENTS = [
  "browser.route_view",
  "browser.runtime_error",
  "browser.unhandled_rejection",
  "browser.security_policy_violation",
  "browser.page_lifecycle",
  "browser.network_state",
  "browser.service_worker_state",
  "browser.user_action",
  "browser.api_exchange",
  "browser.react_error_boundary",
  "browser.stale_bundle_recovery",
] as const;

type BrowserDiagnosticEventName = (typeof BROWSER_DIAGNOSTIC_EVENTS)[number];

const ALLOWED_EVENTS = new Set<string>(BROWSER_DIAGNOSTIC_EVENTS);

let initialized = false;
let fetchPatched = false;
let staleBundleReloadScheduled = false;

function safeImportEnvFlag(name: string): boolean {
  const env = import.meta.env as Record<string, unknown> | undefined;
  return env?.[name] === "true";
}

function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function truncate(value: string, maxLength = MAX_STRING_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactScalar(value: string, maxLength = MAX_STRING_LENGTH): string {
  return truncate(
    value
      .replace(SECRET_PARAM_RE, (match) => `${match.split("=")[0]}=[redacted]`)
      .replace(BEARER_RE, "Bearer [redacted]")
      .replace(JWT_RE, "[redacted-jwt]")
      .replace(EMAIL_RE, "[redacted-email]")
      .replace(UUID_RE, "[uuid]")
      .replace(LONG_TOKEN_RE, "[redacted-token]"),
    maxLength,
  );
}

function isMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (MEDIA_EXT_RE.test(trimmed)) return true;
  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "https://www.vibelymeet.com");
    return MEDIA_HOST_RE.test(url.hostname) || MEDIA_EXT_RE.test(url.pathname);
  } catch {
    return MEDIA_HOST_RE.test(trimmed);
  }
}

export function sanitizeDiagnosticText(raw: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? raw : String(raw);
  if (!value.trim()) return null;
  if (isMediaUrl(value)) return "[redacted-media-url]";
  return redactScalar(value, maxLength);
}

export function sanitizeDiagnosticUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (isMediaUrl(value)) return "[redacted-media-url]";

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://www.vibelymeet.com";
    const url = new URL(value, base);
    const path = `${url.pathname || "/"}${url.hash ? "#[hash]" : ""}`;
    return redactScalar(path.replace(UUID_RE, ":uuid"));
  } catch {
    return redactScalar(value.split(/[?#]/)[0].replace(UUID_RE, ":uuid"));
  }
}

function isContentKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized === "error_message" || normalized === "exception_message") return false;
  return CONTENT_KEY_RE.test(key);
}

function sanitizeKeyValue(key: string, value: unknown, depth: number): DiagnosticValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (REDACTED_KEY_RE.test(key)) return "[redacted]";
  if (isContentKey(key)) return "[redacted]";
  if (URL_KEY_RE.test(key)) return sanitizeDiagnosticUrl(value);

  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (isMediaUrl(value)) return "[redacted-media-url]";
    return redactScalar(value);
  }

  if (depth <= 0) return "[truncated]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry, index) => sanitizeKeyValue(String(index), entry, depth - 1))
      .filter((entry): entry is DiagnosticValue => entry !== undefined);
  }

  if (value instanceof Error) {
    return {
      name: redactScalar(value.name),
      message: redactScalar(value.message),
    };
  }

  if (typeof value === "object") {
    const clean: Record<string, DiagnosticValue> = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const sanitized = sanitizeKeyValue(childKey, childValue, depth - 1);
      if (sanitized !== undefined) clean[childKey] = sanitized;
    }
    return clean;
  }

  return undefined;
}

function sanitizeErrorForSentry(error: unknown): Error {
  if (error instanceof Error) {
    const clean = new Error(sanitizeDiagnosticText(error.message) ?? "Error");
    clean.name = sanitizeDiagnosticText(error.name) ?? "Error";
    if (error.stack) clean.stack = sanitizeDiagnosticText(error.stack, 4_000) ?? clean.stack;
    return clean;
  }
  return new Error(sanitizeDiagnosticText(error, 1_000) ?? "Non-error thrown");
}

function appendErrorSearchText(parts: string[], value: unknown, depth: number): void {
  if (value === null || value === undefined || depth < 0) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }

  if (value instanceof Error) {
    parts.push(value.name, value.message);
    if (value.stack) parts.push(value.stack);
    appendErrorSearchText(parts, (value as Error & { cause?: unknown }).cause, depth - 1);
    return;
  }

  if (typeof value !== "object") return;

  for (const key of ["name", "message", "stack", "reason", "payload", "cause"]) {
    try {
      const child = (value as Record<string, unknown>)[key];
      appendErrorSearchText(parts, child, depth - 1);
    } catch {
      /* diagnostic inspection must never affect app behavior */
    }
  }
}

function staleBundleErrorSearchText(error: unknown): string {
  const parts: string[] = [];
  appendErrorSearchText(parts, error, 3);
  return parts.join(" ");
}

export function isLikelyStaleBundleError(error: unknown): boolean {
  const text = staleBundleErrorSearchText(error);
  if (!text) return false;
  return STALE_BUNDLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getCurrentEntryModulePath(): string | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null;

  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const script of scripts) {
    try {
      const pathname = new URL(script.src, window.location.origin).pathname;
      if (ENTRY_MODULE_RE.test(pathname)) return pathname;
    } catch {
      if (ENTRY_MODULE_RE.test(script.src)) return script.src;
    }
  }
  return null;
}

function staleBundleReloadKey(entryModulePath: string | null): string {
  return `${STALE_BUNDLE_RELOAD_KEY_PREFIX}${entryModulePath ?? "unknown-entry"}`;
}

function staleBundleWindowNameMarker(entryModulePath: string | null): string {
  return `${STALE_BUNDLE_WINDOW_NAME_PREFIX}${encodeURIComponent(entryModulePath ?? "unknown-entry")}`;
}

function windowNameHasStaleBundleMarker(entryModulePath: string | null): boolean {
  if (typeof window === "undefined") return false;
  return window.name.split("|").includes(staleBundleWindowNameMarker(entryModulePath));
}

function markStaleBundleReloadInWindowName(entryModulePath: string | null): void {
  if (typeof window === "undefined") return;
  const marker = staleBundleWindowNameMarker(entryModulePath);
  const parts = window.name ? window.name.split("|") : [];
  if (parts.includes(marker)) return;
  parts.push(marker);
  window.name = parts.filter(Boolean).slice(-12).join("|");
}

export function hasStaleBundleReloadAlreadyAttempted(entryModulePath = getCurrentEntryModulePath()): boolean {
  if (windowNameHasStaleBundleMarker(entryModulePath)) return true;

  const storage = sessionStorageOrNull();
  if (!storage) return false;

  try {
    return storage.getItem(staleBundleReloadKey(entryModulePath)) === "true";
  } catch {
    return false;
  }
}

function markStaleBundleReloadAttempted(entryModulePath: string | null): void {
  markStaleBundleReloadInWindowName(entryModulePath);

  const storage = sessionStorageOrNull();
  if (!storage) return;

  try {
    storage.setItem(staleBundleReloadKey(entryModulePath), "true");
  } catch {
    /* storage failures should not block the recovery reload */
  }
}

export type StaleBundleRecoverySource =
  | "vite_preload_error"
  | "window_error"
  | "unhandled_rejection"
  | "react_error_boundary";

export type StaleBundleRecoveryResult = {
  isStaleBundleError: boolean;
  reloadAlreadyAttempted: boolean;
  reloadScheduled: boolean;
  entryModulePath: string | null;
};

export function recoverFromStaleBundleError(
  error: unknown,
  source: StaleBundleRecoverySource,
  payload: BrowserDiagnosticPayload = {},
): StaleBundleRecoveryResult {
  const isStaleBundleError = isLikelyStaleBundleError(error);
  const entryModulePath = getCurrentEntryModulePath();

  if (!isStaleBundleError) {
    return {
      isStaleBundleError: false,
      reloadAlreadyAttempted: false,
      reloadScheduled: false,
      entryModulePath,
    };
  }

  if (staleBundleReloadScheduled) {
    return {
      isStaleBundleError: true,
      reloadAlreadyAttempted: false,
      reloadScheduled: true,
      entryModulePath,
    };
  }

  const reloadAlreadyAttempted = hasStaleBundleReloadAlreadyAttempted(entryModulePath);
  const reloadScheduled = !reloadAlreadyAttempted && typeof window !== "undefined";

  recordBrowserEvent("browser.stale_bundle_recovery", {
    source,
    action: reloadScheduled ? "reload" : "show_error",
    entry_module_path: entryModulePath,
    reload_already_attempted: reloadAlreadyAttempted,
    ...payload,
  });

  if (reloadScheduled) {
    staleBundleReloadScheduled = true;
    markStaleBundleReloadAttempted(entryModulePath);
    window.setTimeout(() => {
      window.location.reload();
    }, 75);
  }

  return {
    isStaleBundleError: true,
    reloadAlreadyAttempted,
    reloadScheduled,
    entryModulePath,
  };
}

export function sanitizeBrowserDiagnosticPayload(payload: BrowserDiagnosticPayload = {}): Record<string, DiagnosticValue> {
  const clean: Record<string, DiagnosticValue> = {};
  for (const [key, value] of Object.entries(payload).slice(0, MAX_OBJECT_KEYS)) {
    const sanitized = sanitizeKeyValue(key, value, 4);
    if (sanitized !== undefined) clean[key] = sanitized;
  }

  const serialized = JSON.stringify(clean);
  if (serialized.length <= MAX_PAYLOAD_CHARS) return clean;
  return {
    diagnostic_payload_truncated: true,
    diagnostic_payload_chars: serialized.length,
  };
}

export function recordBrowserEvent(
  eventName: BrowserDiagnosticEventName | string,
  payload: BrowserDiagnosticPayload = {},
): boolean {
  if (!ALLOWED_EVENTS.has(eventName)) return false;

  const data = sanitizeBrowserDiagnosticPayload({
    ...payload,
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
  });

  try {
    Sentry.addBreadcrumb({
      category: "browser.diagnostics",
      message: eventName,
      level: "info",
      data,
    });
  } catch {
    /* diagnostics must never affect app behavior */
  }

  try {
    trackEvent(eventName, data);
  } catch {
    /* diagnostics must never affect app behavior */
  }

  if (safeImportEnvFlag("VITE_BROWSER_DIAGNOSTICS_DEBUG") || (import.meta.env?.DEV && !isLocalhost())) {
    console.info("[BrowserDiagnostics]", eventName, data);
  }

  return true;
}

export function recordBrowserError(
  eventName: "browser.runtime_error" | "browser.unhandled_rejection" | "browser.react_error_boundary",
  error: unknown,
  payload: BrowserDiagnosticPayload = {},
): void {
  const data = sanitizeBrowserDiagnosticPayload({
    ...payload,
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: error instanceof Error ? error.message : String(error),
  });

  recordBrowserEvent(eventName, data);

  try {
    Sentry.captureException(sanitizeErrorForSentry(error), {
      tags: { source: "browser_diagnostics", event: eventName },
      extra: data,
    });
  } catch {
    /* diagnostics must never affect app behavior */
  }
}

export function recordUserAction(action: string, payload: BrowserDiagnosticPayload = {}): void {
  recordBrowserEvent("browser.user_action", {
    action,
    ...payload,
  });
}

export function recordApiExchange(payload: {
  url: string;
  method?: string | null;
  status?: number | null;
  durationMs?: number | null;
  outcome: "http_error" | "network_error" | "slow";
  source?: string;
}): void {
  recordBrowserEvent("browser.api_exchange", {
    url: payload.url,
    method: payload.method ?? "GET",
    status: payload.status ?? null,
    duration_ms: payload.durationMs ?? null,
    outcome: payload.outcome,
    source: payload.source ?? "fetch",
  });
}

function urlFromFetchInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodFromFetch(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input && typeof input.method === "string") {
    return input.method.toUpperCase();
  }
  return "GET";
}

function patchFetchForDiagnostics(): void {
  if (fetchPatched || typeof window === "undefined" || typeof window.fetch !== "function") return;
  fetchPatched = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const url = urlFromFetchInput(input);
    const method = methodFromFetch(input, init);
    try {
      const response = await originalFetch(input, init);
      const durationMs = Math.round(performance.now() - startedAt);
      if (response.status >= 400) {
        recordApiExchange({ url, method, status: response.status, durationMs, outcome: "http_error" });
      } else if (durationMs >= SLOW_EXCHANGE_MS) {
        recordApiExchange({ url, method, status: response.status, durationMs, outcome: "slow" });
      }
      return response;
    } catch (error) {
      recordApiExchange({
        url,
        method,
        status: null,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: "network_error",
      });
      throw error;
    }
  };
}

type ServiceWorkerScriptClass = "onesignal" | "legacy_sw" | "none" | "unknown";

function classifyServiceWorkerScript(scriptURL?: string | null): ServiceWorkerScriptClass {
  if (!scriptURL) return "none";
  if (/OneSignalSDK(?:Worker)?\.js|OneSignalSDK\.sw\.js/i.test(scriptURL)) return "onesignal";
  try {
    const pathname = new URL(scriptURL).pathname;
    if (pathname === "/sw.js") return "legacy_sw";
  } catch {
    if (scriptURL.includes("/sw.js")) return "legacy_sw";
  }
  return "unknown";
}

function scriptUrlsForRegistration(registration: ServiceWorkerRegistration): string[] {
  return [registration.active, registration.waiting, registration.installing]
    .map((worker) => worker?.scriptURL)
    .filter((value): value is string => Boolean(value));
}

export async function getServiceWorkerDiagnosticsSnapshot(): Promise<Record<string, DiagnosticValue>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { supported: false };
  }

  const controllerScript = navigator.serviceWorker.controller?.scriptURL ?? null;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      supported: true,
      controller_present: Boolean(navigator.serviceWorker.controller),
      controller_script_class: classifyServiceWorkerScript(controllerScript),
      registration_count: registrations.length,
      registrations: registrations.map((registration) => {
        const scriptUrls = scriptUrlsForRegistration(registration);
        return {
          scope: sanitizeDiagnosticUrl(registration.scope),
          script_classes: scriptUrls.map(classifyServiceWorkerScript),
          has_legacy_sw: scriptUrls.some((url) => classifyServiceWorkerScript(url) === "legacy_sw"),
          has_onesignal_sw: scriptUrls.some((url) => classifyServiceWorkerScript(url) === "onesignal"),
        };
      }),
    };
  } catch (error) {
    return {
      supported: true,
      snapshot_error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function recordServiceWorkerState(phase: string, payload: BrowserDiagnosticPayload = {}): Promise<void> {
  const snapshot = await getServiceWorkerDiagnosticsSnapshot();
  recordBrowserEvent("browser.service_worker_state", {
    phase,
    ...snapshot,
    ...payload,
  });
}

export function initializeBrowserDiagnostics(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("vite:preloadError", (event) => {
    const recovery = recoverFromStaleBundleError(
      (event as Event & { payload?: unknown }).payload,
      "vite_preload_error",
    );
    if (recovery.reloadScheduled) event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    const payload = {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    };
    const recovery = recoverFromStaleBundleError(event.error ?? event.message, "window_error", payload);
    if (recovery.reloadScheduled) {
      event.preventDefault();
      return;
    }
    recordBrowserError("browser.runtime_error", event.error ?? event.message, payload);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const recovery = recoverFromStaleBundleError(event.reason ?? "unhandled rejection", "unhandled_rejection");
    if (recovery.reloadScheduled) {
      event.preventDefault();
      return;
    }
    recordBrowserError("browser.unhandled_rejection", event.reason ?? "unhandled rejection");
  });

  window.addEventListener("securitypolicyviolation", (event) => {
    recordBrowserEvent("browser.security_policy_violation", {
      blocked_uri: event.blockedURI,
      violated_directive: event.violatedDirective,
      effective_directive: event.effectiveDirective,
      disposition: event.disposition,
    });
  });

  window.addEventListener("online", () => {
    recordBrowserEvent("browser.network_state", { state: "online" });
  });

  window.addEventListener("offline", () => {
    recordBrowserEvent("browser.network_state", { state: "offline" });
  });

  document.addEventListener("visibilitychange", () => {
    recordBrowserEvent("browser.page_lifecycle", { visibility_state: document.visibilityState });
  });

  window.addEventListener("pagehide", (event) => {
    recordBrowserEvent("browser.page_lifecycle", {
      lifecycle_event: "pagehide",
      persisted: event.persisted,
    });
  });

  patchFetchForDiagnostics();
  void recordServiceWorkerState("diagnostics_initialized");
}
