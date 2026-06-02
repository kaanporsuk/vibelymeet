import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";

const CANONICAL_APP_ORIGIN = "https://www.vibelymeet.com";
const NON_CANONICAL_APEX_ORIGIN = CANONICAL_APP_ORIGIN.replace("://www.", "://");
const SAFE_PUSH_ROUTE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const PUSH_STATIC_APP_PATHS = new Set([
  "/",
  "/credits",
  "/daily-drop",
  "/events",
  "/matches",
  "/premium",
  "/profile",
  "/schedule",
  "/settings",
  "/settings/credits",
  "/settings/notifications",
]);
const PUSH_DYNAMIC_SINGLE_SEGMENT_ROUTES = new Set(["chat", "date", "events", "ready", "user"]);

type PushTelemetryValue = string | number | boolean | null | undefined;
type PushTelemetryProperties = Record<string, PushTelemetryValue>;
type DeepLinkRouteClass = "chat" | "event" | "date" | "matches" | "profile" | "settings" | "unknown";
type DeepLinkUrlKind =
  | "missing"
  | "relative_app_path"
  | "canonical_www_url"
  | "non_canonical_apex_url"
  | "external_url"
  | "invalid_url";

const ALLOWED_PUSH_TELEMETRY_PROPS = new Set([
  "platform",
  "surface",
  "permission_state",
  "sdk_status",
  "client_health_status",
  "sync_result_code",
  "backend_player_present",
  "local_player_present",
  "backend_subscribed",
  "preferences_enabled",
  "paused",
  "deeplink_url_present",
  "deeplink_url_kind",
  "deeplink_route_class",
  "canonical_origin_valid",
]);

function sanitizePushTelemetryProps(properties: PushTelemetryProperties): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PUSH_TELEMETRY_PROPS.has(key) || value === undefined) continue;
    clean[key] = value;
  }
  return clean;
}

export function recordPushDeliveryTelemetry(
  eventName:
    | "push_permission_prompt_result"
    | "push_registration_sync_result"
    | "push_delivery_health_observed"
    | "push_notification_tap"
    | "push_notification_deeplink_result",
  properties: PushTelemetryProperties,
): void {
  const safeProps = sanitizePushTelemetryProps(properties);
  try {
    trackEvent(eventName, safeProps);
  } catch {
    /* telemetry must never affect push behavior */
  }
  try {
    Sentry.addBreadcrumb({
      category: "push.delivery",
      message: eventName,
      level: "info",
      data: safeProps,
    });
  } catch {
    /* telemetry must never affect push behavior */
  }
}

function routeClassForPath(path: string): DeepLinkRouteClass {
  const cleanPath = path.split(/[?#]/)[0] || "/";
  if (cleanPath.startsWith("/chat/")) return "chat";
  if (cleanPath.startsWith("/event/") || cleanPath.startsWith("/events/")) return "event";
  if (cleanPath.startsWith("/date/") || cleanPath.startsWith("/ready/")) return "date";
  if (cleanPath === "/matches" || cleanPath.startsWith("/matches/")) return "matches";
  if (cleanPath === "/profile" || cleanPath.startsWith("/profile/")) return "profile";
  if (cleanPath === "/settings" || cleanPath.startsWith("/settings/")) return "settings";
  return "unknown";
}

function normalizePushRouteSegment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  return SAFE_PUSH_ROUTE_SEGMENT.test(trimmed) ? encodeURIComponent(trimmed) : null;
}

function isAllowedPushAppPath(path: string): boolean {
  if (PUSH_STATIC_APP_PATHS.has(path)) return true;
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 2 && PUSH_DYNAMIC_SINGLE_SEGMENT_ROUTES.has(segments[0])) {
    return normalizePushRouteSegment(segments[1]) === segments[1];
  }
  if (segments.length === 3 && segments[0] === "event" && segments[2] === "lobby") {
    return normalizePushRouteSegment(segments[1]) === segments[1];
  }
  if (segments.length === 3 && segments[0] === "settings" && segments[1] === "ticket") {
    return normalizePushRouteSegment(segments[2]) === segments[2];
  }
  return false;
}

function normalizePushAppPath(rawPath: string): string | null {
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const [cleanPath] = path.split(/[?#]/);
  return isAllowedPushAppPath(cleanPath || "/") ? path : null;
}

export function classifyPushDeepLink(raw: unknown): {
  deeplink_url_present: boolean;
  deeplink_url_kind: DeepLinkUrlKind;
  deeplink_route_class: DeepLinkRouteClass;
  canonical_origin_valid: boolean;
} {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return {
      deeplink_url_present: false,
      deeplink_url_kind: "missing",
      deeplink_route_class: "unknown",
      canonical_origin_valid: false,
    };
  }

  if (value.startsWith("//") || value.includes("\\")) {
    return {
      deeplink_url_present: true,
      deeplink_url_kind: "invalid_url",
      deeplink_route_class: "unknown",
      canonical_origin_valid: false,
    };
  }

  if (value.startsWith("/")) {
    const safePath = normalizePushAppPath(value);
    if (!safePath) {
      return {
        deeplink_url_present: true,
        deeplink_url_kind: "invalid_url",
        deeplink_route_class: "unknown",
        canonical_origin_valid: false,
      };
    }
    return {
      deeplink_url_present: true,
      deeplink_url_kind: "relative_app_path",
      deeplink_route_class: routeClassForPath(safePath),
      canonical_origin_valid: true,
    };
  }

  try {
    const url = new URL(value);
    if (url.origin === CANONICAL_APP_ORIGIN) {
      const safePath = normalizePushAppPath(`${url.pathname || "/"}${url.search}${url.hash}`);
      if (!safePath) {
        return {
          deeplink_url_present: true,
          deeplink_url_kind: "invalid_url",
          deeplink_route_class: "unknown",
          canonical_origin_valid: true,
        };
      }
      return {
        deeplink_url_present: true,
        deeplink_url_kind: "canonical_www_url",
        deeplink_route_class: routeClassForPath(safePath),
        canonical_origin_valid: true,
      };
    }
    if (url.origin === NON_CANONICAL_APEX_ORIGIN) {
      const safePath = normalizePushAppPath(`${url.pathname || "/"}${url.search}${url.hash}`);
      if (!safePath) {
        return {
          deeplink_url_present: true,
          deeplink_url_kind: "invalid_url",
          deeplink_route_class: "unknown",
          canonical_origin_valid: false,
        };
      }
      return {
        deeplink_url_present: true,
        deeplink_url_kind: "non_canonical_apex_url",
        deeplink_route_class: routeClassForPath(safePath),
        canonical_origin_valid: false,
      };
    }
    return {
      deeplink_url_present: true,
      deeplink_url_kind: "external_url",
      deeplink_route_class: routeClassForPath(url.pathname),
      canonical_origin_valid: false,
    };
  } catch {
    return {
      deeplink_url_present: true,
      deeplink_url_kind: "invalid_url",
      deeplink_route_class: "unknown",
      canonical_origin_valid: false,
    };
  }
}

export function normalizePushDeepLinkHref(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.startsWith("//") || value.includes("\\")) return null;
  if (value.startsWith("/")) return normalizePushAppPath(value);

  try {
    const url = new URL(value);
    if (url.origin !== CANONICAL_APP_ORIGIN && url.origin !== NON_CANONICAL_APEX_ORIGIN) return null;
    return normalizePushAppPath(`${url.pathname || "/"}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}
