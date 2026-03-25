import { MATCHES_SPOTLIGHT_CATALOG_V1 } from "./spotlightCatalog";
import type { MatchesSpotlightItem } from "./spotlightTypes";

/** UTC calendar day YYYY-MM-DD — same string in JS on web and React Native for a given instant. */
export function getUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function fnv1a32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isEligibleOnDate(item: MatchesSpotlightItem, dateKey: string): boolean {
  if (item.startAt && dateKey < item.startAt) return false;
  if (item.endAt && dateKey > item.endAt) return false;
  return true;
}

function mergeByIdLastWins(
  base: readonly MatchesSpotlightItem[],
  extra: readonly MatchesSpotlightItem[] | undefined
): MatchesSpotlightItem[] {
  if (!extra?.length) return [...base];
  const map = new Map<string, MatchesSpotlightItem>();
  for (const x of base) map.set(x.id, x);
  for (const x of extra) map.set(x.id, x);
  return Array.from(map.values());
}

function pickIndexDeterministic(itemsLength: number, seed: string): number {
  if (itemsLength <= 0) return 0;
  return fnv1a32(seed) % itemsLength;
}

export type ResolveMatchesSpotlightInput = {
  userId: string;
  dateKey: string;
  /** Override or extend default catalog (e.g. future server merge). */
  catalog?: readonly MatchesSpotlightItem[];
  /** Injected promos/recs for the day — merged last (wins on duplicate id). */
  runtimeItems?: readonly MatchesSpotlightItem[];
};

/**
 * Deterministic daily spotlight for Matches:
 * 1) Eligible promo + recommendation items (by date window), highest priority then stable id order; pick by hash(userId|dateKey|promo).
 * 2) Else eligible tips pool; pick by hash(userId|dateKey|tip).
 */
export function resolveMatchesSpotlight(input: ResolveMatchesSpotlightInput): MatchesSpotlightItem {
  const base = input.catalog ?? MATCHES_SPOTLIGHT_CATALOG_V1;
  const merged = mergeByIdLastWins(base, input.runtimeItems);
  const { userId, dateKey } = input;

  const promoOrRec = merged.filter(
    (i) =>
      (i.kind === "promo" || i.kind === "recommendation") && isEligibleOnDate(i, dateKey)
  );
  promoOrRec.sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pb !== pa) return pb - pa;
    return a.id.localeCompare(b.id);
  });

  if (promoOrRec.length > 0) {
    const idx = pickIndexDeterministic(
      promoOrRec.length,
      `${userId}|${dateKey}|matches-spotlight:promo`
    );
    return promoOrRec[idx]!;
  }

  const tips = merged.filter((i) => i.kind === "tip" && isEligibleOnDate(i, dateKey));
  const pool = tips.length > 0 ? tips : merged.filter((i) => i.kind === "tip");
  const fallback = pool[0] ?? merged[0] ?? MATCHES_SPOTLIGHT_CATALOG_V1[0]!;
  if (pool.length === 0) return fallback;

  const idx = pickIndexDeterministic(pool.length, `${userId}|${dateKey}|matches-spotlight:tip`);
  return pool[idx]!;
}
