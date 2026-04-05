import { getRelationshipIntentDisplaySafe } from '@shared/profileContracts';
import {
  type SearchHitKind,
  type SearchableMatch,
  getMatchSearchHitKind as getSharedMatchSearchHitKind,
} from '../../../shared/matches/search';

function buildIntentSearchHaystack(intentId: string): string {
  if (!intentId) return '';
  const safe = getRelationshipIntentDisplaySafe(intentId);
  return [safe.id, safe.label, safe.emoji].join(' ').toLowerCase();
}

export function getMatchSearchHitKind(match: SearchableMatch, query: string): SearchHitKind {
  return getSharedMatchSearchHitKind(match, query, buildIntentSearchHaystack);
}
