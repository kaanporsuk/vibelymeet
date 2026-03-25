import { useQuery } from "@tanstack/react-query";
import { fetchUserProfile, type UserProfileView } from "@/services/fetchUserProfile";

export function useUserProfile(userId: string | null | undefined) {
  return useQuery<UserProfileView | null>({
    queryKey: ["user-profile", userId],
    queryFn: async () => {
      if (!userId) return null;
      return fetchUserProfile(userId);
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

