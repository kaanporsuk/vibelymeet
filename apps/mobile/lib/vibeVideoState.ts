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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUNNY_STREAM_VIDEO_ID_PATTERN = /^[0-9a-f-]{32,36}$/i;
const PROFILE_VIBE_VIDEO_REF_PATTERN =
  /^profile_vibe_video:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f-]{32,36})$/i;

export function getProfileVibeVideoPlaybackRef(
  profileId: string | null | undefined,
  bunnyVideoUid: string | null | undefined,
): string | null {
  const id = typeof profileId === 'string' ? profileId.trim() : '';
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  if (!UUID_PATTERN.test(id) || !BUNNY_STREAM_VIDEO_ID_PATTERN.test(uid)) return null;
  return `profile_vibe_video:${id}:${uid}`;
}

function normalizeProfileVibeVideoPlaybackRef(value: unknown, uid?: string | null): string | null {
  const ref = typeof value === 'string' ? value.trim() : '';
  const match = PROFILE_VIBE_VIDEO_REF_PATTERN.exec(ref);
  if (!match) return null;
  if (uid && match[2].toLowerCase() !== uid.toLowerCase()) return null;
  return ref;
}

function pickProfileId(profile: {
  id?: string | null;
  profile_id?: string | null;
  profileId?: string | null;
} | null | undefined): string | null {
  const raw = profile?.id ?? profile?.profile_id ?? profile?.profileId;
  return typeof raw === 'string' ? raw.trim() || null : null;
}

function pickPlaybackRef(profile: {
  id?: string | null;
  profile_id?: string | null;
  profileId?: string | null;
  vibe_video_playback_ref?: string | null;
  vibeVideoPlaybackRef?: string | null;
  playbackRef?: string | null;
} | null | undefined, uid: string | null): string | null {
  return (
    normalizeProfileVibeVideoPlaybackRef(profile?.vibe_video_playback_ref, uid) ??
    normalizeProfileVibeVideoPlaybackRef(profile?.vibeVideoPlaybackRef, uid) ??
    normalizeProfileVibeVideoPlaybackRef(profile?.playbackRef, uid) ??
    getProfileVibeVideoPlaybackRef(pickProfileId(profile), uid)
  );
}

export function resolveVibeVideoState(profile: {
  id?: string | null;
  profile_id?: string | null;
  profileId?: string | null;
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  bunny_video_updated_at?: string | number | Date | null;
  updated_at?: string | number | Date | null;
  vibe_video_playback_ref?: string | null;
  vibeVideoPlaybackRef?: string | null;
  playbackRef?: string | null;
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
    const playbackRef = pickPlaybackRef(profile, uid);
    const playbackUrl = playbackRef ?? getVibeVideoPlaybackUrl(uid);
    const thumbnailUrl = playbackRef ? null : getVibeVideoThumbnailUrl(uid);
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
