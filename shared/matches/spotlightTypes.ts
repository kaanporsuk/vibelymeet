export type MatchesSpotlightKind = "tip" | "promo" | "recommendation";

/**
 * v1 local catalog item. Future: server-injected promos / recommendations share this shape.
 */
export type MatchesSpotlightItem = {
  id: string;
  kind: MatchesSpotlightKind;
  /** Small label above the title, e.g. "Pro tip", "This week". */
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel?: string;
  /** URL or deep link — only used when ctaLabel is set. */
  ctaTarget?: string;
  /** Higher = preferred when multiple promos/recommendations are eligible. */
  priority?: number;
  /** Inclusive UTC calendar day YYYY-MM-DD. Omit = no lower bound. */
  startAt?: string;
  /** Inclusive UTC calendar day YYYY-MM-DD. Omit = no upper bound. */
  endAt?: string;
};
