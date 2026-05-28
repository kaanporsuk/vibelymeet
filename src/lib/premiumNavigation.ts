import type { NavigateFunction } from "react-router-dom";
import {
  buildPremiumQueryString,
  type PremiumAnalyticsPlatform,
  type PremiumFunnelNavOptions,
} from "@shared/premiumFunnel";
import { trackEvent } from "@/lib/analytics";

export type OpenPremiumOptions = PremiumFunnelNavOptions & {
  /** Set false when continuing from an upsell modal (intent already logged). Default true. */
  recordEntryTapped?: boolean;
  platform?: PremiumAnalyticsPlatform;
};

const PREMIUM_NAV_DEDUPE_MS = 1000;
let lastPremiumNavigation: { routeKey: string; at: number } | null = null;

function shouldSkipDuplicatePremiumNavigation(destination: string): boolean {
  const now = Date.now();
  const routeKey = destination;
  if (
    lastPremiumNavigation &&
    lastPremiumNavigation.routeKey === routeKey &&
    now - lastPremiumNavigation.at < PREMIUM_NAV_DEDUPE_MS
  ) {
    return true;
  }
  lastPremiumNavigation = { routeKey, at: now };
  return false;
}

/**
 * Navigate to `/premium` with funnel query params and optional PostHog `premium_entry_tapped`.
 */
export function openPremium(navigate: NavigateFunction, options: OpenPremiumOptions): boolean {
  const platform: PremiumAnalyticsPlatform = options.platform ?? "web";
  const { recordEntryTapped = true, platform: _p, ...navOpts } = options;
  const search = buildPremiumQueryString(navOpts);
  const destination = search ? `/premium?${search}` : "/premium";
  if (shouldSkipDuplicatePremiumNavigation(destination)) return false;
  if (recordEntryTapped) {
    trackEvent("premium_entry_tapped", {
      entry_surface: navOpts.entry_surface,
      feature: navOpts.feature,
      source_context: navOpts.source_context,
      platform,
    });
  }
  navigate({ pathname: "/premium", search });
  return true;
}
