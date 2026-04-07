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

function nativePlatform(): PremiumAnalyticsPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "ios";
}

/**
 * Push `/premium` with funnel query params and optional `premium_entry_tapped`.
 */
export function openPremium(
  push: (href: Href) => void,
  options: OpenPremiumOptions
): void {
  const platform = options.platform ?? nativePlatform();
  const { recordEntryTapped = true, platform: _p, ...navOpts } = options;
  if (recordEntryTapped) {
    trackEvent("premium_entry_tapped", {
      entry_surface: navOpts.entry_surface,
      feature: navOpts.feature,
      source_context: navOpts.source_context,
      platform,
    });
  }
  const qs = buildPremiumQueryString(navOpts);
  const path = (qs ? `/premium?${qs}` : "/premium") as Href;
  push(path);
}
