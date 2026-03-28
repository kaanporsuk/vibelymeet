/**
 * Single source of truth for when the Vibely web app should call OneSignal.init.
 * Keep in sync with `src/main.tsx` (must match exactly).
 *
 * Production: HTTPS on vibelymeet.com or www.vibelymeet.com (both supported in code;
 * OneSignal dashboard "Site URL" must include whichever host you use, or init may fail).
 * Local: http(s)://localhost for dev.
 */
export function isOneSignalWebOriginAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "[::1]") {
    return protocol === "http:" || protocol === "https:";
  }
  if (hostname === "vibelymeet.com" || hostname === "www.vibelymeet.com") {
    return protocol === "https:";
  }
  return false;
}
