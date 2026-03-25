/**
 * Deterministic "Best Match" scoring for sort + compatibility display.
 * Keep in sync with `src/utils/matchSortScore.ts`.
 */

export type MatchScoreInput = {
  viewerVibeLabels: readonly string[];
  otherVibeLabels: readonly string[];
  viewerLookingFor: string | null | undefined;
  otherLookingFor: string | null | undefined;
  hasSharedEventContext: boolean;
};

function normalizedVibeSet(labels: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of labels) {
    const s = raw.trim().toLowerCase();
    if (s) out.add(s);
  }
  return out;
}

export function countVibeOverlap(
  viewerVibeLabels: readonly string[],
  otherVibeLabels: readonly string[]
): number {
  const a = normalizedVibeSet(viewerVibeLabels);
  if (a.size === 0) return 0;
  let n = 0;
  for (const l of normalizedVibeSet(otherVibeLabels)) {
    if (a.has(l)) n++;
  }
  return n;
}

function normIntent(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function intentAligned(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normIntent(a);
  const nb = normIntent(b);
  return na.length > 0 && na === nb;
}

export function bestMatchSortKey(input: MatchScoreInput): number {
  const overlap = countVibeOverlap(input.viewerVibeLabels, input.otherVibeLabels);
  const intent = intentAligned(input.viewerLookingFor, input.otherLookingFor) ? 1 : 0;
  const ev = input.hasSharedEventContext ? 1 : 0;
  return overlap * 1_000_000 + intent * 10_000 + ev * 100;
}

export function compatibilityPercent(input: MatchScoreInput): number {
  const overlap = countVibeOverlap(input.viewerVibeLabels, input.otherVibeLabels);
  const intent = intentAligned(input.viewerLookingFor, input.otherLookingFor) ? 1 : 0;
  const ev = input.hasSharedEventContext ? 1 : 0;
  const raw = 52 + overlap * 4 + intent * 6 + ev * 2;
  return Math.min(99, Math.max(50, raw));
}

export function formatConversationCount(n: number): string {
  if (n === 1) return '1 match';
  return `${n} matches`;
}
