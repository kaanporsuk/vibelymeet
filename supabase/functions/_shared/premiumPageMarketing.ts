/**
 * Premium paywall marketing copy derived from the tier model (`TIERS.premium`).
 *
 * IMPORTANT: Presentation / conversion copy only. Entitlement enforcement stays in
 * `useEntitlements`, edge functions, and DB — never gate features from this module.
 */

import { TIERS, type TierId } from "./tiers";
import { PREMIUM_ENTRY_SURFACE } from "./premiumFunnel";

const PREMIUM_TIER_ID: TierId = "premium";

export type PremiumEntryNudge = {
  title: string;
  body: string;
  /** When true, surfaces should use caution styling (e.g. VIP mismatch warnings). */
  variant?: "default" | "caution";
};

/**
 * User-facing bullets for the Premium SKU, aligned with `TIERS.premium` defaults.
 * Omits capabilities that are also true on Free (e.g. vibe schedule) and never claims VIP.
 */
export function getPremiumTierMarketingBullets(): string[] {
  const p = TIERS[PREMIUM_TIER_ID];
  const lines: string[] = [];

  if (p.boolean.canSeeLikedYou) {
    lines.push("See who liked you (unblur people who vibed you)");
  }
  if (p.boolean.canCityBrowse) {
    lines.push("Browse and filter events by city — not only near you");
  }
  if (p.boolean.canAccessPremiumEvents) {
    lines.push("Register for Premium-tier events");
  }
  if (p.boolean.hasBadge) {
    lines.push("Premium badge on your profile");
  }

  const credits = p.quotas.monthlyVideoDateCredits;
  if (typeof credits === "number" && credits > 0) {
    lines.push(
      `${credits} video date credits per replenishment cycle (monthly on the standard Premium tier)`,
    );
  }

  if (p.quotas.dailyDropPriority > TIERS.free.quotas.dailyDropPriority) {
    lines.push("Higher Daily Drop priority than Free");
  }

  lines.push("Premium does not include VIP-only events or VIP-tier registration.");

  return lines;
}

export function getPremiumDefaultHero(): { title: string; subtitle: string } {
  return {
    title: "Unlock more real-life meets",
    subtitle:
      "Premium adds discovery, event access, and profile signals Free doesn’t include — same app, more room to connect.",
  };
}

/**
 * Contextual banner when the user arrived via `openPremium` / funnel query params.
 * Returns null when unknown or empty — use `getPremiumDefaultHero` for the main headline.
 *
 * `vip_event_register` is fail-closed: we do not imply Premium checkout unlocks VIP.
 */
export function getPremiumEntryNudge(entrySurface: string | undefined): PremiumEntryNudge | null {
  if (!entrySurface?.trim()) return null;

  switch (entrySurface) {
    case PREMIUM_ENTRY_SURFACE.WHO_LIKED_YOU:
      return {
        title: "You’re here to see who liked you",
        body: "Premium includes unblurred profiles of people who liked you on Vibely. Pick a plan below to continue.",
      };
    case PREMIUM_ENTRY_SURFACE.PREMIUM_EVENT_REGISTER:
      return {
        title: "This event needs Premium access",
        body: "Premium lets you register for Premium-tier events. Complete membership below if your plan matches what this event requires.",
      };
    case PREMIUM_ENTRY_SURFACE.VIP_EVENT_REGISTER:
      return {
        title: "VIP-tier events need VIP access",
        body: "Vibely Premium does not include VIP-only events. Buying or renewing Premium here will not unlock VIP-tier registration by itself. You need a membership tier that explicitly includes VIP events — if you’re unsure, check your plan or contact support before paying.",
        variant: "caution",
      };
    case PREMIUM_ENTRY_SURFACE.CITY_BROWSE_EVENTS_FILTER:
    case PREMIUM_ENTRY_SURFACE.CITY_BROWSE_DISCOVERY:
    case PREMIUM_ENTRY_SURFACE.EVENTS_EMPTY_PROMO:
    case PREMIUM_ENTRY_SURFACE.HAPPENING_ELSEWHERE_PROMO:
      return {
        title: "Explore events beyond your immediate area",
        body: "Premium unlocks city-based event discovery and filters that Free doesn’t include. Choose a plan to keep browsing.",
      };
    case PREMIUM_ENTRY_SURFACE.SETTINGS_UPGRADE_CARD:
    case PREMIUM_ENTRY_SURFACE.ACCOUNT_PREMIUM_LINK:
    case PREMIUM_ENTRY_SURFACE.LOBBY_PREMIUM_PILL:
      return {
        title: "Upgrade from Free",
        body: "You’ll get stronger discovery, Premium-tier events, and who-liked-you access — see exactly what’s included below.",
      };
    default:
      return null;
  }
}
