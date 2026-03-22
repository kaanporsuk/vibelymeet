/**
 * Canonical vibe video state resolver — single source of truth for ALL native surfaces.
 * Every component that renders video state MUST use resolveVibeVideoState().
 */
import { getVibeVideoPlaybackUrl, getVibeVideoThumbnailUrl } from '@/lib/vibeVideoPlaybackUrl';

export type VibeVideoState =
  | 'none'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'error';

export interface VibeVideoInfo {
  state: VibeVideoState;
  uid: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  canPlay: boolean;
  canManage: boolean;
  canDelete: boolean;
  canRecord: boolean;
}

export function resolveVibeVideoState(profile: {
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  vibe_caption?: string | null;
} | null | undefined): VibeVideoInfo {
  const uid = profile?.bunny_video_uid?.trim() || null;
  const rawStatus = (profile?.bunny_video_status ?? '').toString().toLowerCase().trim();
  const status = (!rawStatus || rawStatus === 'null' || rawStatus === 'undefined') ? 'none' : rawStatus;
  const caption = profile?.vibe_caption?.trim() || null;

  const NONE: VibeVideoInfo = {
    state: 'none',
    uid: null, playbackUrl: null, thumbnailUrl: null, caption: null,
    canPlay: false, canManage: false, canDelete: false, canRecord: true,
  };

  if (!uid && (status === 'none' || status === '')) return NONE;
  if (!uid) return NONE;

  if (status === 'uploading') {
    return {
      state: 'uploading',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: false,
    };
  }

  if (status === 'processing') {
    return {
      state: 'processing',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: false,
    };
  }

  if (status === 'ready') {
    const playbackUrl = getVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = getVibeVideoThumbnailUrl(uid);
    return {
      state: 'ready',
      uid, playbackUrl, thumbnailUrl, caption,
      canPlay: !!playbackUrl,
      canManage: true,
      canDelete: true,
      canRecord: true,
    };
  }

  if (status === 'failed') {
    return {
      state: 'failed',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: true,
    };
  }

  // uid exists but status is 'none' or unrecognized → assume still in pipeline (webhook lag)
  return {
    state: 'processing',
    uid, playbackUrl: null, thumbnailUrl: null, caption,
    canPlay: false, canManage: false, canDelete: true, canRecord: false,
  };
}
