import { getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import {
  type SearchHitKind,
  type SearchableMatch,
  getMatchSearchHitKind as getSharedMatchSearchHitKind,
  matchPassesClientSearch as sharedMatchPassesClientSearch,
} from "../../shared/matches/search";

export {
  MATCHES_SEARCH_HINT,
  MATCHES_SEARCH_LEAD,
} from "../../shared/matches/searchUi";

function buildIntentSearchHaystack(lookingFor: string): string {
  if (!lookingFor) return "";
  // Never include raw internal ids (e.g. `long_term`, `not_sure`) in search haystacks.
  // We only search by canonical id/label/emoji vocabulary.
  const safe = getRelationshipIntentDisplaySafe(lookingFor);
  return [safe.id, safe.label, safe.emoji].join(" ").toLowerCase();
}

export function getMatchSearchHitKind(match: SearchableMatch, query: string): SearchHitKind {
  return getSharedMatchSearchHitKind(match, query, buildIntentSearchHaystack);
}

export function matchPassesClientSearch(match: SearchableMatch, query: string): boolean {
  return sharedMatchPassesClientSearch(match, query, buildIntentSearchHaystack);
}
