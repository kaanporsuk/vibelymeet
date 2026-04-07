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

/**
 * Navigate to `/premium` with funnel query params and optional PostHog `premium_entry_tapped`.
 */
export function openPremium(navigate: NavigateFunction, options: OpenPremiumOptions): void {
  const platform: PremiumAnalyticsPlatform = options.platform ?? "web";
  const { recordEntryTapped = true, platform: _p, ...navOpts } = options;
  if (recordEntryTapped) {
    trackEvent("premium_entry_tapped", {
      entry_surface: navOpts.entry_surface,
      feature: navOpts.feature,
      source_context: navOpts.source_context,
      platform,
    });
  }
  const search = buildPremiumQueryString(navOpts);
  navigate({ pathname: "/premium", search });
}
