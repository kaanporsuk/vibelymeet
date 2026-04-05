import { useQuery } from '@tanstack/react-query';
import { fetchUserProfile, type UserProfileView } from '@/lib/fetchUserProfile';

export function useUserProfile(profileId: string | null | undefined) {
  return useQuery<UserProfileView | null>({
    queryKey: ['user-profile', profileId],
    queryFn: async () => {
      if (!profileId) return null;
      return fetchUserProfile(profileId);
    },
    enabled: !!profileId,
    staleTime: 60_000,
  });
}
