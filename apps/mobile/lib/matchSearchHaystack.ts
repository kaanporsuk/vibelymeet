import { getRelationshipIntentDisplaySafe } from '@shared/profileContracts';
import {
  type SearchHitKind,
  type SearchableMatch,
  getMatchSearchHitKind as getSharedMatchSearchHitKind,
} from '../../../shared/matches/search';

function buildIntentSearchHaystack(lookingFor: string): string {
  if (!lookingFor) return '';
  const safe = getRelationshipIntentDisplaySafe(lookingFor);
  return [safe.id, safe.label, safe.emoji].join(' ').toLowerCase();
}

export function getMatchSearchHitKind(match: SearchableMatch, query: string): SearchHitKind {
  return getSharedMatchSearchHitKind(match, query, buildIntentSearchHaystack);
}
