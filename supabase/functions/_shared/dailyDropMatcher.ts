// Pure, deterministic matching helpers used by generate-daily-drops.
//
// Extracted so the algorithm can be exercised by node:test/tsx without
// requiring Deno or a live Supabase connection. The Edge Function imports
// the same functions from this module.

export type MatcherUser = {
  id: string;
  gender?: string | null;
  interested_in?: string[] | null;
  age?: number | null;
  preferred_age_min?: number | null;
  preferred_age_max?: number | null;
};

export type TagInfo = { label: string; emoji: string };

export type MatcherInput = {
  users: MatcherUser[];
  vibeMap: Record<string, Set<string>>;
  tagMap: Record<string, TagInfo>;
  matchSet: Set<string>;          // canonical "lo:hi" pair keys
  blockSet: Set<string>;          // raw "blocker:blocked" pair keys (both directions inserted)
  reportSet: Set<string>;         // raw "reporter:reported" pair keys (both directions inserted)
  cooldownSet: Set<string>;       // canonical "lo:hi" pair keys
  mutuallyDiscoverable?: (a: MatcherUser, b: MatcherUser) => boolean;
};

export type MatcherPair = {
  user_a_id: string;
  user_b_id: string;
  affinity_score: number;
  pick_reasons: string[];
};

export function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function isGenderCompatible(a: MatcherUser, b: MatcherUser): boolean {
  const aInt = Array.isArray(a.interested_in) ? a.interested_in : [];
  const bInt = Array.isArray(b.interested_in) ? b.interested_in : [];
  // Empty interested_in is still treated as "no preference set yet" - matches
  // the live Edge Function. P1-2 (flip to strict opt-in) is gated on product
  // confirmation; this helper documents but does not enforce.
  const aLikesB = aInt.length === 0 || (b.gender != null && aInt.includes(b.gender));
  const bLikesA = bInt.length === 0 || (a.gender != null && bInt.includes(a.gender));
  return aLikesB && bLikesA;
}

export function isAgeCompatible(a: MatcherUser, b: MatcherUser): boolean {
  const aAccepts = b.age == null
    || ((a.preferred_age_min == null || b.age >= a.preferred_age_min)
      && (a.preferred_age_max == null || b.age <= a.preferred_age_max));
  const bAccepts = a.age == null
    || ((b.preferred_age_min == null || a.age >= b.preferred_age_min)
      && (b.preferred_age_max == null || a.age <= b.preferred_age_max));
  return aAccepts && bAccepts;
}

export function buildPickReasons(args: {
  sharedTagIds: string[];
  tagMap: Record<string, TagInfo>;
  overlap: number;
}): string[] {
  const { sharedTagIds, tagMap, overlap } = args;
  const reasons: string[] = [];
  const sharedLabels = sharedTagIds
    .slice(0, 3)
    .map((id) => {
      const tag = tagMap[id];
      return tag ? `${tag.emoji} ${tag.label}` : null;
    })
    .filter((value): value is string => typeof value === "string");
  if (sharedLabels.length > 0) reasons.push(`Shared vibes: ${sharedLabels.join(", ")}`);
  if (overlap >= 3) reasons.push("Strong vibe alignment");
  if (reasons.length === 0) reasons.push("New connection opportunity");
  return reasons;
}

export function scorePairs(input: MatcherInput): Array<{ id_a: string; id_b: string; score: number; reasons: string[] }> {
  const { users, vibeMap, tagMap, matchSet, blockSet, reportSet, cooldownSet, mutuallyDiscoverable } = input;
  const results: Array<{ id_a: string; id_b: string; score: number; reasons: string[] }> = [];

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const a = users[i];
      const b = users[j];
      const lo = a.id < b.id ? a.id : b.id;
      const hi = a.id < b.id ? b.id : a.id;
      const pairKey = `${lo}:${hi}`;

      if (
        matchSet.has(pairKey)
        || blockSet.has(`${a.id}:${b.id}`)
        || blockSet.has(`${b.id}:${a.id}`)
        || reportSet.has(`${a.id}:${b.id}`)
        || reportSet.has(`${b.id}:${a.id}`)
        || cooldownSet.has(pairKey)
      ) continue;
      if (mutuallyDiscoverable && !mutuallyDiscoverable(a, b)) continue;
      if (!isGenderCompatible(a, b)) continue;
      if (!isAgeCompatible(a, b)) continue;

      const aVibes = vibeMap[a.id] ?? new Set<string>();
      const bVibes = vibeMap[b.id] ?? new Set<string>();
      let overlap = 0;
      const sharedTagIds: string[] = [];
      aVibes.forEach((tagId) => {
        if (bVibes.has(tagId)) {
          overlap++;
          sharedTagIds.push(tagId);
        }
      });

      const reasons = buildPickReasons({ sharedTagIds, tagMap, overlap });
      results.push({ id_a: lo, id_b: hi, score: overlap, reasons });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const c = a.id_a.localeCompare(b.id_a);
    if (c !== 0) return c;
    return a.id_b.localeCompare(b.id_b);
  });

  return results;
}

export function greedyPair(scored: ReturnType<typeof scorePairs>): MatcherPair[] {
  const paired = new Set<string>();
  const out: MatcherPair[] = [];
  for (const candidate of scored) {
    if (paired.has(candidate.id_a) || paired.has(candidate.id_b)) continue;
    paired.add(candidate.id_a);
    paired.add(candidate.id_b);
    out.push({
      user_a_id: candidate.id_a,
      user_b_id: candidate.id_b,
      affinity_score: candidate.score,
      pick_reasons: candidate.reasons,
    });
  }
  return out;
}

export function pickPairs(input: MatcherInput): { pairs: MatcherPair[]; unpairedCount: number } {
  const scored = scorePairs(input);
  const pairs = greedyPair(scored);
  const pairedIds = new Set<string>();
  for (const pair of pairs) {
    pairedIds.add(pair.user_a_id);
    pairedIds.add(pair.user_b_id);
  }
  return { pairs, unpairedCount: input.users.length - pairedIds.size };
}
