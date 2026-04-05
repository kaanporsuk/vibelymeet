/**
 * Vibely identity contract.
 *
 * Canonical account identity lives in `auth.users.id`.
 * Social/domain identity lives in `public.profiles.id`.
 *
 * Today those UUIDs are expected to be the same for a given person, but we keep
 * the aliases separate so callers can document which layer they mean.
 */
export type AuthUserId = string;
export type ProfileId = string;
export type ViewerProfileId = ProfileId;

export function asAuthUserId(value: string): AuthUserId {
  return value;
}

export function asProfileId(value: string): ProfileId {
  return value;
}

export function authUserIdToProfileId(userId: AuthUserId): ProfileId {
  return userId;
}

export function profileIdToAuthUserId(profileId: ProfileId): AuthUserId {
  return profileId;
}
