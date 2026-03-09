// useDropMatches is no longer needed — Daily Drop is handled by useDailyDrop hook directly
// This file is kept as a no-op to avoid breaking imports during transition

import { useQuery } from '@tanstack/react-query';

export function useDropMatches() {
  return useQuery({
    queryKey: ['drop-matches-deprecated'],
    queryFn: async () => [],
    enabled: false,
  });
}
