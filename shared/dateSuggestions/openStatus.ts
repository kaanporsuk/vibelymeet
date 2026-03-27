/**
 * Open/active statuses for a date suggestion in a match — aligns with
 * `date_suggestion_apply_v2` / one-open-per-match (draft, proposed, viewed, countered).
 */
export const DATE_SUGGESTION_OPEN_STATUSES: readonly string[] = [
  'draft',
  'proposed',
  'viewed',
  'countered',
];

export function matchHasOpenDateSuggestion(
  suggestions: ReadonlyArray<{ status: string }> | null | undefined
): boolean {
  if (!suggestions?.length) return false;
  return suggestions.some((s) => DATE_SUGGESTION_OPEN_STATUSES.includes(s.status));
}
