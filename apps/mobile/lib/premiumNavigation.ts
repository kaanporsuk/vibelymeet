import { Platform } from "react-native";
import type { Href } from "expo-router";
import {
  buildPremiumQueryString,
  type PremiumAnalyticsPlatform,
  type PremiumFunnelNavOptions,
} from "@shared/premiumFunnel";
import { trackEvent } from "@/lib/analytics";

export type OpenPremiumOptions = PremiumFunnelNavOptions & {
  recordEntryTapped?: boolean;
  platform?: PremiumAnalyticsPlatform;
};

const PREMIUM_NAV_DEDUPE_MS = 1000;
let lastPremiumNavigation: { routeKey: string; at: number } | null = null;

function nativePlatform(): PremiumAnalyticsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "ios";
}

function premiumRouteKey(path: string): string {
  return path.split(/[?#]/, 1)[0] || path;
}

function shouldSkipDuplicatePremiumNavigation(path: string): boolean {
  const now = Date.now();
  const routeKey = premiumRouteKey(path);
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
 * Push `/premium` with funnel query params and optional `premium_entry_tapped`.
 */
export function openPremium(
  push: (href: Href) => void,
  options: OpenPremiumOptions
): boolean {
  const platform = options.platform ?? nativePlatform();
  const { recordEntryTapped = true, platform: _p, ...navOpts } = options;
  const qs = buildPremiumQueryString(navOpts);
  const path = qs ? `/premium?${qs}` : "/premium";
  if (shouldSkipDuplicatePremiumNavigation(path)) return false;
  if (recordEntryTapped) {
    trackEvent("premium_entry_tapped", {
      entry_surface: navOpts.entry_surface,
      feature: navOpts.feature,
      source_context: navOpts.source_context,
      platform,
    });
  }
  push(path as Href);
  return true;
}
