import { supabase } from '@/lib/supabase';

export type PhotoVerificationState = 'none' | 'pending' | 'approved' | 'rejected' | 'expired';
export type LatestPhotoVerificationStatus = 'pending' | 'approved' | 'rejected' | null | undefined;

export function resolvePhotoVerificationState(params: {
  photoVerified: boolean | null | undefined;
  photoVerificationExpiresAt: string | null | undefined;
  latestPhotoVerificationStatus: LatestPhotoVerificationStatus;
}): PhotoVerificationState {
  const { photoVerified, photoVerificationExpiresAt, latestPhotoVerificationStatus } = params;
  if (photoVerified) {
    if (photoVerificationExpiresAt && new Date(photoVerificationExpiresAt) < new Date()) return 'expired';
    return 'approved';
  }
  if (latestPhotoVerificationStatus === 'pending') return 'pending';
  if (latestPhotoVerificationStatus === 'rejected') return 'rejected';
  return 'none';
}

export async function fetchMyPhotoVerificationState(userId: string): Promise<{
  state: PhotoVerificationState;
  photoVerified: boolean;
  photoVerificationExpiresAt: string | null;
  latestStatus: LatestPhotoVerificationStatus;
}> {
  const { data: profileData } = await supabase
    .from('profiles')
    .select('photo_verified, photo_verification_expires_at')
    .eq('id', userId)
    .maybeSingle();

  const photoVerified = !!(profileData as { photo_verified?: boolean } | null)?.photo_verified;
  const photoVerificationExpiresAt =
    ((profileData as { photo_verification_expires_at?: string | null } | null)?.photo_verification_expires_at as
      | string
      | null
      | undefined) ?? null;

  if (photoVerified) {
    return {
      state: resolvePhotoVerificationState({
        photoVerified,
        photoVerificationExpiresAt,
        latestPhotoVerificationStatus: null,
      }),
      photoVerified,
      photoVerificationExpiresAt,
      latestStatus: null,
    };
  }

  const { data: latestVerification } = await supabase
    .from('photo_verifications')
    .select('status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestStatus = (latestVerification as { status?: LatestPhotoVerificationStatus } | null)?.status ?? null;

  return {
    state: resolvePhotoVerificationState({
      photoVerified,
      photoVerificationExpiresAt,
      latestPhotoVerificationStatus: latestStatus,
    }),
    photoVerified,
    photoVerificationExpiresAt,
    latestStatus,
  };
}

