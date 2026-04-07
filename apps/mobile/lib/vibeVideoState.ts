/**
 * Canonical vibe video state resolver — single source of truth for ALL native surfaces.
 * Every component that renders video state MUST use resolveVibeVideoState().
 *
 * Contract: `bunny_video_uid` + `bunny_video_status` on `profiles` are backend-owned (create-video-upload,
 * webhooks / media-session RPCs). Clients only read them and derive UI via this resolver.
 * `canPlay` requires normalized `ready` plus a constructible HLS URL — not merely a uid.
 * Vibe Score video points use non-empty `bunny_video_uid` only; `canPlay` still follows `ready` +
 * playback URL (same split as web `resolveWebVibeVideoState`). Incomplete-actions for vibe_video
 * use uid-only to mirror score eligibility.
 */
import { getVibeVideoPlaybackUrl, getVibeVideoThumbnailUrl } from '@/lib/vibeVideoPlaybackUrl';
import { normalizeBunnyVideoStatus } from '@/lib/vibeVideoStatus';

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
  const normStatus = normalizeBunnyVideoStatus(profile?.bunny_video_status);
  const caption = profile?.vibe_caption?.trim() || null;

  const NONE: VibeVideoInfo = {
    state: 'none',
    uid: null, playbackUrl: null, thumbnailUrl: null, caption: null,
    canPlay: false, canManage: false, canDelete: false, canRecord: true,
  };

  if (!uid) {
    if (normStatus === 'none') return NONE;
    return {
      state: 'error',
      uid: null, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: false, canRecord: true,
    };
  }

  if (normStatus === 'unknown') {
    return {
      state: 'processing',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: false,
    };
  }

  if (normStatus === 'uploading') {
    return {
      state: 'uploading',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: false,
    };
  }

  if (normStatus === 'processing') {
    return {
      state: 'processing',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: false,
    };
  }

  if (normStatus === 'ready') {
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

  if (normStatus === 'failed') {
    return {
      state: 'failed',
      uid, playbackUrl: null, thumbnailUrl: null, caption,
      canPlay: false, canManage: false, canDelete: true, canRecord: true,
    };
  }

  // uid exists but status is `none` — webhook lag or partial write; stay in pipeline, not "no video".
  return {
    state: 'processing',
    uid, playbackUrl: null, thumbnailUrl: null, caption,
    canPlay: false, canManage: false, canDelete: true, canRecord: false,
  };
}
