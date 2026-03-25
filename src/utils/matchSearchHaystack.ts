import { intentOptions } from "@/components/RelationshipIntent";
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
  const opt = intentOptions.find((i) => i.id === lookingFor);
  if (opt) return [lookingFor, opt.label, opt.emoji].join(" ").toLowerCase();
  return `${lookingFor} 💫`.toLowerCase();
}

export function getMatchSearchHitKind(match: SearchableMatch, query: string): SearchHitKind {
  return getSharedMatchSearchHitKind(match, query, buildIntentSearchHaystack);
}

export function matchPassesClientSearch(match: SearchableMatch, query: string): boolean {
  return sharedMatchPassesClientSearch(match, query, buildIntentSearchHaystack);
}
