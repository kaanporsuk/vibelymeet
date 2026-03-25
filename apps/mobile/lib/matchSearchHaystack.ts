import { getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import {
  type SearchHitKind,
  type SearchableMatch,
  getMatchSearchHitKind as getSharedMatchSearchHitKind,
} from '../../../shared/matches/search';

function buildIntentSearchHaystack(lookingFor: string): string {
  if (!lookingFor) return '';
  const d = getLookingForDisplay(lookingFor);
  return [lookingFor, d?.label ?? '', d?.emoji ?? ''].join(' ').toLowerCase();
}

export function getMatchSearchHitKind(match: SearchableMatch, query: string): SearchHitKind {
  return getSharedMatchSearchHitKind(match, query, buildIntentSearchHaystack);
}
