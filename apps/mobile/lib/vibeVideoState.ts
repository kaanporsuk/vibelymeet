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
import {
  normalizeBunnyVideoUid,
  resolveCanonicalVibeVideoState,
  type BunnyVideoStatusNormalized,
  type CanonicalVibeVideoState,
} from '@clientShared/vibeVideoSemantics';
import { parseMediaCaptions, type MediaCaptions } from '../../../shared/media/captions';

export type VibeVideoState = CanonicalVibeVideoState;

export interface VibeVideoInfo {
  state: VibeVideoState;
  uid: string | null;
  normalizedStatus: BunnyVideoStatusNormalized;
  statusUpdatedAt: string | null;
  statusAgeMs: number | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  captions: MediaCaptions | null;
  isScoreEligible: boolean;
  canPlay: boolean;
  canManage: boolean;
  canDelete: boolean;
  canRecord: boolean;
}

export function resolveVibeVideoState(profile: {
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  bunny_video_updated_at?: string | number | Date | null;
  updated_at?: string | number | Date | null;
  vibe_caption?: string | null;
  vibe_video_captions?: unknown;
  captions?: unknown;
} | null | undefined): VibeVideoInfo {
  const uid = normalizeBunnyVideoUid(profile?.bunny_video_uid);
  const canonical = resolveCanonicalVibeVideoState({
    bunnyVideoUid: uid,
    bunnyVideoStatus: profile?.bunny_video_status,
    bunnyVideoUpdatedAt: profile?.bunny_video_updated_at ?? profile?.updated_at,
  });
  const normStatus = canonical.status;
  const caption = profile?.vibe_caption?.trim() || null;
  const captions = parseMediaCaptions(profile?.vibe_video_captions ?? profile?.captions);

  const NONE: VibeVideoInfo = {
    state: 'none',
    uid: null, normalizedStatus: normStatus,
    statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
    playbackUrl: null, thumbnailUrl: null, caption: null, captions: null,
    isScoreEligible: false,
    canPlay: false, canManage: false, canDelete: false, canRecord: true,
  };

  if (!uid) {
    if (canonical.state === 'none') return NONE;
    return {
      state: 'error',
      uid: null, normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null, thumbnailUrl: null, caption, captions,
      isScoreEligible: false,
      canPlay: false, canManage: false, canDelete: false, canRecord: true,
    };
  }

  if (canonical.state === 'processing' || canonical.state === 'stale_processing') {
    return {
      state: canonical.state,
      uid, normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null, thumbnailUrl: null, caption, captions,
      isScoreEligible: true,
      canPlay: false, canManage: true, canDelete: true, canRecord: canonical.state === 'stale_processing',
    };
  }

  if (canonical.state === 'ready') {
    const playbackUrl = getVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = getVibeVideoThumbnailUrl(uid);
    return {
      state: 'ready',
      uid, normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
      playbackUrl, thumbnailUrl, caption, captions,
      isScoreEligible: true,
      canPlay: !!playbackUrl,
      canManage: true,
      canDelete: true,
      canRecord: true,
    };
  }

  if (canonical.state === 'failed') {
    return {
      state: 'failed',
      uid, normalizedStatus: normStatus,
      statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
      playbackUrl: null, thumbnailUrl: null, caption, captions,
      isScoreEligible: true,
      canPlay: false, canManage: true, canDelete: true, canRecord: true,
    };
  }

  // uid exists but status is non-terminal; stay in pipeline, not empty.
  return {
    state: 'processing',
    uid, normalizedStatus: normStatus,
    statusUpdatedAt: canonical.statusUpdatedAt, statusAgeMs: canonical.statusAgeMs,
    playbackUrl: null, thumbnailUrl: null, caption, captions,
    isScoreEligible: true,
    canPlay: false, canManage: true, canDelete: true, canRecord: false,
  };
}
