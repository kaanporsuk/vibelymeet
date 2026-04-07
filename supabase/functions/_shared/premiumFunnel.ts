/**
 * Premium funnel instrumentation — shared query keys and types (web + native).
 * Does not gate features; entitlement checks stay in @shared/tiers + useEntitlements.
 */

export type PremiumAnalyticsPlatform = "web" | "ios" | "android";

/** Known entry surfaces for `premium_entry_tapped` / `premium_page_viewed` enrichment. */
export const PREMIUM_ENTRY_SURFACE = {
  WHO_LIKED_YOU: "who_liked_you",
  PREMIUM_EVENT_REGISTER: "premium_event_register",
  VIP_EVENT_REGISTER: "vip_event_register",
  CITY_BROWSE_EVENTS_FILTER: "city_browse_events_filter",
  CITY_BROWSE_DISCOVERY: "city_browse_discovery",
  EVENTS_EMPTY_PROMO: "events_empty_promo",
  HAPPENING_ELSEWHERE_PROMO: "happening_elsewhere_promo",
  SETTINGS_UPGRADE_CARD: "settings_upgrade_card",
  LOBBY_PREMIUM_PILL: "lobby_premium_pill",
  ACCOUNT_PREMIUM_LINK: "account_premium_link",
} as const;

export type PremiumEntrySurface =
  (typeof PREMIUM_ENTRY_SURFACE)[keyof typeof PREMIUM_ENTRY_SURFACE];

export type PremiumFunnelNavOptions = {
  entry_surface: PremiumEntrySurface | string;
  /** Optional capability or product key, e.g. canSeeLikedYou */
  feature?: string;
  /** Optional opaque id: event_id, screen id, etc. */
  source_context?: string;
};

const QUERY_ENTRY = "entry_surface";
const QUERY_FEATURE = "feature";
const QUERY_SOURCE = "source_context";

export function buildPremiumQueryString(params: PremiumFunnelNavOptions): string {
  const sp = new URLSearchParams();
  sp.set(QUERY_ENTRY, params.entry_surface);
  if (params.feature) sp.set(QUERY_FEATURE, params.feature);
  if (params.source_context) sp.set(QUERY_SOURCE, params.source_context);
  return sp.toString();
}

export type PremiumEntryRouteParams = {
  entry_surface?: string;
  feature?: string;
  source_context?: string;
};

export function readPremiumEntryFromSearchParams(
  get: (key: string) => string | null | undefined
): PremiumEntryRouteParams {
  const entry_surface = get(QUERY_ENTRY) ?? undefined;
  const feature = get(QUERY_FEATURE) ?? undefined;
  const source_context = get(QUERY_SOURCE) ?? undefined;
  return { entry_surface, feature, source_context };
}
