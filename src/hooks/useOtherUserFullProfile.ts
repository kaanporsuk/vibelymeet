import { useMemo } from "react";
import { normalizeOtherUserFullProfile } from "@clientShared/profile/otherUserProfileViewModel";
import { useUserProfile } from "@/hooks/useUserProfile";

export function useOtherUserFullProfile(profileId: string | null | undefined) {
  const query = useUserProfile(profileId);
  const profile = useMemo(
    () => (query.data ? normalizeOtherUserFullProfile(query.data) : null),
    [query.data],
  );

  return {
    ...query,
    data: profile,
    rawProfile: query.data,
  };
}
