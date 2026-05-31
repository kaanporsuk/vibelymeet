import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { VibeClipDisplayMeta } from '../../../../shared/chat/messageRouting';
import type { ReactionPair } from '../../../../shared/chat/messageReactionModel';
import { compactReactionLabel } from '../../../../shared/chat/messageReactionModel';
import { replyPromptForContext } from '../../../../shared/chat/vibeClipPrompts';
import { CLIP_DATE_ACTION_HINT } from '../../../../shared/dateSuggestions/dateComposerLaunch';
import { trackVibeClipEvent } from '@/lib/vibeClipAnalytics';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';
import { durationBucketFromSeconds, threadBucketFromCount } from '../../../../shared/chat/vibeClipAnalytics';
import { captionTextFromMediaCaptions } from '../../../../shared/media/captions';
import { useMediaAsset } from '@/hooks/useMediaAsset';
import { useNativeMediaPlaybackQoE } from '@/hooks/useNativeMediaPlaybackQoE';
import { useReduceMotionState } from '@/hooks/useReduceMotion';
import { MediaPlaceholder } from '@/components/media/MediaPlaceholder';
import type { MediaPlaceholderKind } from '@clientShared/media/placeholders';
import {
  resolveMediaFallbackCopy,
  resolveNativeMediaPlaybackFallbackReason,
  type MediaFallbackReason,
} from '@clientShared/media/mediaFallbackCopy';
import {
  syncChatVibeClipUploadStatus,
  type ChatVibeClipProcessingStatus,
} from '@/lib/mediaAssetResolver';

type Props = {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
  /** Secondary: opens existing date-suggestion composer (gated upstream). */
  onSuggestDate?: () => void;
  /** Secondary: opens existing reaction picker for this message. */
  onReact?: () => void;
  reactionPair?: ReactionPair | null;
  /** For optional reply spark copy (received clips). */
  threadMessageCount?: number;
  sparkMessageId?: string;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  onResolvedVideoUrl?: (url: string) => void;
  onResolvedThumbnailUrl?: (url: string) => void;
  /** Canonical upload idempotency key for QoE/upload correlation. */
  clientRequestId?: string | null;
  /** Opens full-screen chat video viewer. */
  onRequestImmersive?: (media?: { videoUrl: string; thumbnailUrl?: string | null }) => void;
  /** Pause inline preview while immersive viewer is open for this URL. */
  immersiveActive?: boolean;
  /** Mount the native player only after an explicit play/open request. */
  shouldMountPlayer?: boolean;
  /** Parent FlatList viewability guard; false unmounts/pauses inline native player. */
  isViewportActive?: boolean;
  /** Parent-owned poster cache so FlatList remounts do not replay the preview loader. */
  posterPreviewState?: VibeClipPosterPreviewState;
  onPosterPreviewStateChange?: (state: VibeClipPosterPreviewState, thumbnailUrl?: string | null) => void;
  threadVisualRecede?: boolean;
  localRecovery?: VibeClipLocalRecovery | null;
  thumbnailPlaceholderKind?: MediaPlaceholderKind | null;
  thumbnailPlaceholderHash?: string | null;
  thumbnailDominantColor?: string | null;
};

export type VibeClipPosterPreviewState = 'unknown' | 'ready' | 'failed';
export type VibeClipLocalRecovery = {
  stateLabel?: string;
  error?: string;
  canResume?: boolean;
  canDiscard?: boolean;
  onResume?: () => void;
  onDiscardAndSendAgain?: () => void;
};
type VibeClipMediaRefreshReason = 'preview' | 'initial' | 'playback' | 'manual';

type VibeClipCardInnerProps = Props & {
  onRefreshClipMedia: (reason?: VibeClipMediaRefreshReason) => Promise<boolean>;
  onLocalPreviewUnavailable: () => void;
  onRemountPlayer: () => void;
  onResetPlaybackRefreshAttempt: () => void;
  playRequestToken: number;
  syncAttemptCount: number;
  isSyncingStatus: boolean;
  onManualStatusSync: () => void;
};
type VibeClipPosterProps = Props & {
  onRefreshClipMedia: (reason?: VibeClipMediaRefreshReason) => Promise<boolean>;
  onRequestInlinePlay: () => void;
  syncAttemptCount: number;
  isSyncingStatus: boolean;
  onManualStatusSync: () => void;
};
type ClipPreviewState =
  | 'poster_ready'
  | 'player_loading'
  | 'ready'
  | 'buffering'
  | 'failed';

const ACCENT = 'rgba(139,92,246,1)';
const ACCENT_DIM = 'rgba(139,92,246,0.55)';
const SECONDARY = 'rgba(255,255,255,0.55)';
const INLINE_CLIP_MIN_ASPECT_RATIO = 0.78;
const INLINE_CLIP_MAX_ASPECT_RATIO = 1.2;
const INLINE_CLIP_MAX_HEIGHT = 360;
const POSTER_PREVIEW_TIMEOUT_MS = 3500;
// First-go poster reliability: Bunny can return a thumbnail URL before the image is
// generated. Re-sign + reload on a bounded backoff so the first frame appears as soon
// as Bunny catches up, without hammering the resolver. Mirrors the web VibeClipBubble.
const POSTER_PREVIEW_RETRY_DELAYS_MS = [1000, 3000, 8000];
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;
const MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS = 1;
const CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS = 30_000;
const VIBE_CLIP_CAPTIONS_PREF_KEY = 'vibely:vibe-clip-captions';

function isLocalPreviewUri(uri: string): boolean {
  return uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:');
}

function isUploadPendingStatus(status: VibeClipDisplayMeta['processingStatus']): boolean {
  return status === 'uploading' || status === 'processing';
}

function isPendingLocalPreviewClip(meta: VibeClipDisplayMeta): boolean {
  return isUploadPendingStatus(meta.processingStatus) && isLocalPreviewUri(meta.videoUrl);
}

function isRemotePlaybackUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function isResolvableMediaRef(uri: string | null | undefined): boolean {
  return !!uri && !isLocalPreviewUri(uri) && !isRemotePlaybackUri(uri);
}

function isHlsUri(uri: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(uri);
}

function videoSourceForUri(uri: string): VideoSource {
  return isHlsUri(uri) ? { uri, contentType: 'hls' } : uri;
}

function isServerProcessingClip(meta: VibeClipDisplayMeta): boolean {
  return isUploadPendingStatus(meta.processingStatus) && !isLocalPreviewUri(meta.videoUrl);
}

function isFailedClip(meta: VibeClipDisplayMeta): boolean {
  return meta.processingStatus === 'failed';
}

function cardAspectRatioForMeta(meta: VibeClipDisplayMeta): number {
  return typeof meta.aspectRatio === 'number' && Number.isFinite(meta.aspectRatio) && meta.aspectRatio > 0
    ? Math.max(INLINE_CLIP_MIN_ASPECT_RATIO, Math.min(INLINE_CLIP_MAX_ASPECT_RATIO, meta.aspectRatio))
    : INLINE_CLIP_MIN_ASPECT_RATIO;
}

function posterStateForMeta(
  meta: VibeClipDisplayMeta,
  posterPreviewState?: VibeClipPosterPreviewState,
): VibeClipPosterPreviewState {
  if (!meta.thumbnailUrl) return 'failed';
  return posterPreviewState ?? 'unknown';
}

function VibeClipPosterImage({
  uri,
  previewState,
  placeholderKind,
  placeholderHash,
  dominantColor,
  onPreviewStateChange,
}: {
  uri: string | null;
  previewState: VibeClipPosterPreviewState;
  placeholderKind?: MediaPlaceholderKind | null;
  placeholderHash?: string | null;
  dominantColor?: string | null;
  onPreviewStateChange?: (state: VibeClipPosterPreviewState, thumbnailUrl?: string | null) => void;
}) {
  if (!uri || previewState === 'failed') {
    return (
      <MediaPlaceholder
        kind={placeholderKind}
        hash={placeholderHash}
        dominantColor={dominantColor}
      />
    );
  }
  return (
    <>
      <MediaPlaceholder
        kind={placeholderKind}
        hash={placeholderHash}
        dominantColor={dominantColor}
      />
      <ExpoImage
        source={{ uri }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={uri}
        onLoad={() => onPreviewStateChange?.('ready', uri)}
        onError={() => {
          // Resolved URL but the file 404'd (Bunny still generating). Mark failed and
          // let the parent's bounded retry re-sign + reload rather than firing here.
          onPreviewStateChange?.('failed', uri);
        }}
      />
    </>
  );
}

function VibeClipRecoveryPanel({
  meta,
  isMine,
  localRecovery,
  syncAttemptCount,
  isSyncingStatus,
  onManualStatusSync,
}: {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
  localRecovery?: VibeClipLocalRecovery | null;
  syncAttemptCount: number;
  isSyncingStatus: boolean;
  onManualStatusSync: () => void;
}) {
  const hasLocalRecoveryAction = Boolean(localRecovery?.canResume || localRecovery?.canDiscard || localRecovery?.error);
  const showServerProcessingNudge = isMine && isServerProcessingClip(meta) && syncAttemptCount > 0 && !hasLocalRecoveryAction;
  if (!isMine || (!hasLocalRecoveryAction && !showServerProcessingNudge)) return null;

  return (
    <View style={styles.recoveryPanel} testID="vibe-clip-recovery-panel">
      <Text style={styles.recoveryText}>
        {localRecovery?.error ||
          localRecovery?.stateLabel ||
          (isServerProcessingClip(meta) ? 'Processing - usually about 30 s.' : 'Still preparing this clip.')}
      </Text>
      <View style={styles.recoveryActions}>
        {localRecovery?.canResume && localRecovery.onResume ? (
          <Pressable
            onPress={localRecovery.onResume}
            style={({ pressed }) => [styles.recoveryButton, pressed ? { opacity: 0.82 } : null]}
            accessibilityRole="button"
            accessibilityLabel="Resume upload"
            testID="vibe-clip-resume-upload"
          >
            <Text style={styles.recoveryButtonText}>Resume upload</Text>
          </Pressable>
        ) : null}
        {localRecovery?.canDiscard && localRecovery.onDiscardAndSendAgain ? (
          <Pressable
            onPress={localRecovery.onDiscardAndSendAgain}
            style={({ pressed }) => [styles.recoveryButtonSecondary, pressed ? { opacity: 0.82 } : null]}
            accessibilityRole="button"
            accessibilityLabel="Discard and send again"
            testID="vibe-clip-discard-send-again"
          >
            <Text style={styles.recoveryButtonSecondaryText}>Discard + send again</Text>
          </Pressable>
        ) : null}
        {showServerProcessingNudge ? (
          <Pressable
            onPress={onManualStatusSync}
            disabled={isSyncingStatus}
            style={({ pressed }) => [
              styles.recoveryButtonSecondary,
              (pressed || isSyncingStatus) ? { opacity: 0.72 } : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Check clip status"
            testID="vibe-clip-check-status"
          >
            <Text style={styles.recoveryButtonSecondaryText}>
              {isSyncingStatus ? 'Checking…' : 'Check again'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function VibeClipCardInner({
  meta,
  isMine,
  onReplyWithClip,
  onVoiceReply,
  onSuggestDate,
  onReact,
  reactionPair,
  threadMessageCount = 0,
  sparkMessageId,
  onRequestImmersive,
  immersiveActive,
  threadVisualRecede = false,
  posterPreviewState,
  onPosterPreviewStateChange,
  onRefreshClipMedia,
  onLocalPreviewUnavailable,
  onRemountPlayer,
  onResetPlaybackRefreshAttempt,
  playRequestToken,
  localRecovery,
  clientRequestId,
  syncAttemptCount,
  isSyncingStatus,
  onManualStatusSync,
  thumbnailPlaceholderKind,
  thumbnailPlaceholderHash,
  thumbnailDominantColor,
}: VibeClipCardInnerProps) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<MediaFallbackReason | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playRequested, setPlayRequested] = useState(() => playRequestToken > 0);
  const [showCaptions, setShowCaptions] = useState(true);
  const { reduceMotion, resolved: reduceMotionResolved } = useReduceMotionState();
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);
  const shouldAttachPlayback = !immersiveActive && reduceMotionResolved && (!reduceMotion || playRequested);
  const isPendingLocalPreview = isPendingLocalPreviewClip(meta);
  const playerSource = useMemo<VideoSource>(() => (shouldAttachPlayback ? videoSourceForUri(meta.videoUrl) : null), [
    meta.videoUrl,
    shouldAttachPlayback,
  ]);
  const qoe = useNativeMediaPlaybackQoE({
    enabled: shouldAttachPlayback,
    family: 'vibe_clip',
    surface: 'chat_vibe_clip_card',
    provider: meta.provider ?? 'bunny_stream',
    sourceRef: meta.playbackRef ?? meta.videoUrl,
    messageId: sparkMessageId ?? null,
    clientRequestId: clientRequestId ?? meta.clientRequestId ?? null,
    muted: false,
    autoplay: false,
  });

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(VIBE_CLIP_CAPTIONS_PREF_KEY)
      .then((value) => {
        if (mounted && value === '0') setShowCaptions(false);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const toggleCaptions = useCallback(() => {
    setShowCaptions((visible) => {
      const next = !visible;
      void AsyncStorage.setItem(VIBE_CLIP_CAPTIONS_PREF_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    setIsReady(false);
    setIsBuffering(false);
    setHasError(false);
    setFallbackReason(null);
    setHasPlayed(false);
    setPlayRequested(false);
  }, [meta.videoUrl]);

  useEffect(() => {
    if (playRequestToken <= 0) return;
    setPlayRequested(true);
  }, [playRequestToken]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const result = safeExpoSharedObjectCall(() => player.replace(videoSourceForUri(meta.videoUrl)), {
      label: 'vibeClip.player.replace',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.replace');
  }, [meta.videoUrl, player, shouldAttachPlayback]);

  const handlePendingLocalPreviewFailure = useCallback(() => {
    onLocalPreviewUnavailable();
    setHasError(false);
    setIsBuffering(false);
    setIsReady(false);
    setPlayRequested(false);
  }, [onLocalPreviewUnavailable]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        if (payload.status === 'error') {
          const reason = resolveNativeMediaPlaybackFallbackReason({ uri: meta.videoUrl, error: payload });
          qoe.markError();
          if (isPendingLocalPreview) {
            handlePendingLocalPreviewFailure();
            return;
          }
          void onRefreshClipMedia('playback')
            .then((didRefresh) => {
              if (!didRefresh) {
                setFallbackReason(reason);
                setHasError(true);
              }
            })
            .catch(() => {
              setFallbackReason(reason);
              setHasError(true);
            });
          setIsBuffering(false);
          return;
        }
        setIsBuffering(payload.status === 'loading');
        if (payload.status === 'loading') qoe.markBuffering();
        if (payload.status === 'readyToPlay') {
          qoe.markReady();
          setHasError(false);
          setIsBuffering(false);
          setIsReady(true);
        }
      }),
      {
        label: 'vibeClip.player.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeClip.player.statusListener.remove');
  }, [
    handlePendingLocalPreviewFailure,
    isPendingLocalPreview,
    meta.videoUrl,
    onRefreshClipMedia,
    player,
    qoe,
    shouldAttachPlayback,
  ]);

  const playInline = useCallback(() => {
    setPlayRequested(true);
    if (!isReady) return;
    const result = safeExpoSharedObjectCall(() => player.play(), {
      label: 'vibeClip.player.playInline',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.playInline');
  }, [isReady, player]);

  useEffect(() => {
    if (!shouldAttachPlayback || !playRequested || !isReady) return;
    const result = safeExpoSharedObjectCall(() => player.play(), {
      label: 'vibeClip.player.playRequested',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.playRequested');
  }, [isReady, playRequested, player, shouldAttachPlayback]);

  useEffect(() => {
    if (!playRequested || isReady || hasError) return;
    const timeoutId = setTimeout(() => {
      if (isPendingLocalPreview) {
        handlePendingLocalPreviewFailure();
        return;
      }
      void onRefreshClipMedia('playback')
        .then((didRefresh) => {
          if (!didRefresh) {
            setFallbackReason(resolveNativeMediaPlaybackFallbackReason({ uri: meta.videoUrl }));
            setHasError(true);
          }
        })
        .catch(() => {
          setFallbackReason(resolveNativeMediaPlaybackFallbackReason({ uri: meta.videoUrl }));
          setHasError(true);
        });
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [handlePendingLocalPreviewFailure, hasError, isPendingLocalPreview, isReady, meta.videoUrl, onRefreshClipMedia, playRequested]);

  useEffect(() => {
    if (!immersiveActive) return;
    const result = safeExpoSharedObjectCall(() => player.pause(), {
      label: 'vibeClip.player.pause.immersive',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.pause.immersive');
  }, [immersiveActive, player]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('playingChange', (ev) => {
        if (ev.isPlaying) setHasPlayed(true);
      }),
      {
        label: 'vibeClip.player.playingListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeClip.player.playingListener.remove');
  }, [player, shouldAttachPlayback]);

  useEffect(() => {
    playStartTracked.current = false;
    playCompleteTracked.current = false;
  }, [meta.videoUrl]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const sub1 = safeExpoSharedObjectCall(
      () => player.addListener('playingChange', (ev) => {
        if (!ev.isPlaying || playStartTracked.current) return;
        playStartTracked.current = true;
        trackVibeClipEvent('clip_play_started', {
          thread_bucket: threadBucketFromCount(threadMessageCount),
          is_sender: isMine,
          duration_bucket: durationBucketFromSeconds(meta.durationSec),
          has_poster: !!meta.thumbnailUrl,
        });
      }),
      {
        label: 'vibeClip.player.analyticsPlayingListener',
        fallback: null,
        swallowAll: true,
      },
    );
    const sub2 = safeExpoSharedObjectCall(
      () => player.addListener('playToEnd', () => {
        if (playCompleteTracked.current) return;
        playCompleteTracked.current = true;
        qoe.markEnded();
        trackVibeClipEvent('clip_play_completed', {
          thread_bucket: threadBucketFromCount(threadMessageCount),
          is_sender: isMine,
          duration_bucket: durationBucketFromSeconds(meta.durationSec),
          has_poster: !!meta.thumbnailUrl,
        });
      }),
      {
        label: 'vibeClip.player.playToEndListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => {
      safeRemoveExpoSharedObjectSubscription(sub1, 'vibeClip.player.analyticsPlayingListener.remove');
      safeRemoveExpoSharedObjectSubscription(sub2, 'vibeClip.player.playToEndListener.remove');
    };
  }, [player, isMine, threadMessageCount, meta.videoUrl, meta.durationSec, meta.thumbnailUrl, qoe, shouldAttachPlayback]);

  useEffect(
    () => () => {
      const result = safeExpoSharedObjectCall(() => player.pause(), {
        label: 'vibeClip.player.pause.unmount',
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.pause.unmount');
    },
    [player],
  );

  const hasPrimary = !!onReplyWithClip || !!onVoiceReply;
  const hasSecondary = !!onSuggestDate || !!onReact;
  const showActions = hasPlayed && !isMine && (hasPrimary || hasSecondary);
  const reactionSummary = compactReactionLabel(reactionPair ?? null);
  const replySpark =
    showActions && sparkMessageId
      ? replyPromptForContext(threadMessageCount, sparkMessageId)
      : null;
  const cardAspectRatio = cardAspectRatioForMeta(meta);
  const posterState = posterStateForMeta(meta, posterPreviewState);
  const captionText = captionTextFromMediaCaptions(meta.captions);
  const hasPosterVisual = !!meta.thumbnailUrl && posterState !== 'failed';
  const previewState: ClipPreviewState = hasError
    ? 'failed'
    : isBuffering || (playRequested && !isReady)
      ? 'buffering'
      : isReady
        ? 'ready'
        : hasPosterVisual
          ? 'poster_ready'
          : 'player_loading';
  const showPlayAffordance =
    !hasPlayed && !hasError && previewState !== 'buffering';
  const fallbackCopy = resolveMediaFallbackCopy({ reason: fallbackReason ?? 'unknown' });

  return (
    <View
      testID="vibe-clip-bubble"
      style={[
        styles.outer,
        {
          borderColor: isMine ? ACCENT_DIM : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
          opacity: threadVisualRecede ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio, maxHeight: INLINE_CLIP_MAX_HEIGHT }]}>
        {!isReady ? (
          <VibeClipPosterImage
            uri={meta.thumbnailUrl}
            previewState={posterState}
            placeholderKind={thumbnailPlaceholderKind}
            placeholderHash={thumbnailPlaceholderHash}
            dominantColor={thumbnailDominantColor}
            onPreviewStateChange={onPosterPreviewStateChange}
          />
        ) : null}
        {!isReady && !hasPosterVisual ? (
          <View style={styles.posterFallback} pointerEvents="none">
            <MediaPlaceholder
              kind={thumbnailPlaceholderKind}
              hash={thumbnailPlaceholderHash}
              dominantColor={thumbnailDominantColor}
            />
            <Ionicons name="film-outline" size={34} color="rgba(216,180,254,0.42)" />
          </View>
        ) : null}
        <VideoView
          style={[styles.video, !isReady || hasError ? { opacity: 0 } : null]}
          player={player}
          nativeControls
          contentFit="cover"
        />
        {captionText && showCaptions ? (
          <View style={styles.captionOverlay} pointerEvents="none">
            <Text style={styles.captionOverlayText}>{captionText}</Text>
          </View>
        ) : null}

        {onRequestImmersive ? (
          <Pressable
            onPress={() => onRequestImmersive()}
            style={({ pressed }) => [
              styles.expandBtn,
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(255,255,255,0.18)',
                backgroundColor: 'rgba(0,0,0,0.48)',
              },
              pressed && { opacity: 0.88 },
            ]}
            accessibilityLabel="Open clip full screen"
            hitSlop={6}
          >
            <Ionicons name="expand-outline" size={20} color="rgba(255,255,255,0.95)" />
          </Pressable>
        ) : null}
        {captionText ? (
          <Pressable
            onPress={toggleCaptions}
            style={({ pressed }) => [styles.captionToggleBtn, pressed && { opacity: 0.82 }]}
            accessibilityRole="button"
            accessibilityLabel={showCaptions ? 'Hide captions' : 'Show captions'}
            hitSlop={6}
          >
            <Ionicons name="text-outline" size={17} color="rgba(255,255,255,0.95)" />
          </Pressable>
        ) : null}

        {previewState === 'buffering' ? (
          <View style={styles.playOverlay} pointerEvents="none">
            <View style={styles.playButton}>
              <ActivityIndicator color="rgba(255,255,255,0.95)" size="small" />
            </View>
            <Text style={styles.playHint}>Preparing clip…</Text>
          </View>
        ) : null}

        {showPlayAffordance ? (
          <Pressable
            onPress={playInline}
            style={({ pressed }) => [styles.playOverlay, pressed && { opacity: 0.86 }]}
            accessibilityRole="button"
            accessibilityLabel="Play clip"
          >
            <View style={styles.playButton}>
              <Ionicons name="play" size={24} color="rgba(255,255,255,0.96)" style={styles.playIcon} />
            </View>
          </Pressable>
        ) : null}

        {hasError ? (
          <View style={[styles.loadingOverlay, styles.clipErrorOverlay]}>
            <Ionicons name="videocam-off-outline" size={28} color="rgba(196,181,253,0.88)" />
            <Text style={styles.clipUnavailableTitle}>{fallbackCopy.title}</Text>
            <Text
              style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 }}
            >
              {fallbackCopy.message}
            </Text>
            {fallbackCopy.actionLabel ? (
              <Pressable
                onPress={() => {
                  onResetPlaybackRefreshAttempt();
                  setFallbackReason(null);
                  setHasError(false);
                  setIsBuffering(true);
                  void onRefreshClipMedia('manual')
                    .then((didRefresh) => {
                      if (!didRefresh) onRemountPlayer();
                    })
                    .catch(onRemountPlayer);
                }}
                style={({ pressed }) => [styles.clipRetryBtn, pressed && { opacity: 0.88 }]}
              >
                <Text style={styles.clipRetryLabel}>{fallbackCopy.actionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{meta.durationLabel}</Text>
        </View>
      </View>

      <VibeClipRecoveryPanel
        meta={meta}
        isMine={isMine}
        localRecovery={localRecovery}
        syncAttemptCount={syncAttemptCount}
        isSyncingStatus={isSyncingStatus}
        onManualStatusSync={onManualStatusSync}
      />

      {showActions && (
        <View style={styles.actionsBlock}>
          {replySpark ? (
            <Text style={[styles.sparkLine, { color: theme.textSecondary }]} accessibilityRole="text">
              {replySpark}
            </Text>
          ) : null}
          {hasPrimary ? (
            <View style={styles.primaryRow}>
              {onReplyWithClip && (
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    trackVibeClipEvent('clip_reply_with_clip_clicked', {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    onReplyWithClip();
                  }}
                  accessibilityLabel="Reply with a Vibe Clip"
                >
                  <Ionicons name="film-outline" size={14} color={ACCENT} />
                  <Text style={styles.primaryLabel}>Reply with clip</Text>
                </Pressable>
              )}
              {onVoiceReply && (
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    trackVibeClipEvent('clip_voice_reply_clicked', {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    onVoiceReply();
                  }}
                  accessibilityLabel="Reply with voice"
                >
                  <Ionicons name="mic-outline" size={14} color={ACCENT} />
                  <Text style={styles.primaryLabel}>Voice reply</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {hasSecondary ? (
            <View style={styles.secondaryRow}>
              {onSuggestDate && (
                <View style={styles.dateBridgeCol}>
                  <Pressable
                    style={({ pressed }) => [styles.dateBridgeBtn, pressed && { opacity: 0.88 }]}
                    onPress={() => {
                      trackVibeClipEvent('clip_date_cta_clicked', {
                        thread_bucket: threadBucketFromCount(threadMessageCount),
                        is_receiver: true,
                        launched_from: 'clip_context',
                      });
                      onSuggestDate();
                    }}
                    accessibilityLabel="Suggest a date"
                  >
                    <Ionicons name="calendar-outline" size={14} color="rgba(254,205,211,0.95)" />
                    <Text style={styles.dateBridgeLabel}>Suggest a date</Text>
                  </Pressable>
                  <Text style={styles.dateBridgeHint} accessibilityLabel={CLIP_DATE_ACTION_HINT}>
                    {CLIP_DATE_ACTION_HINT}
                  </Text>
                </View>
              )}
              {onReact && (
                <Pressable
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.75 }]}
                  onPress={() => {
                    trackVibeClipEvent('clip_react_clicked', {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    onReact();
                  }}
                  accessibilityLabel="React"
                >
                  <Ionicons name="heart-outline" size={13} color={SECONDARY} />
                  <Text style={styles.secondaryLabel}>React</Text>
                </Pressable>
              )}
              {reactionSummary ? (
                <Text style={styles.reactionSummary} accessibilityLabel={`Reactions ${reactionSummary}`}>
                  {reactionSummary}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function VibeClipCardPosterOnly({
  meta,
  isMine,
  onRequestImmersive,
  posterPreviewState,
  onPosterPreviewStateChange,
  onRefreshClipMedia,
  onRequestInlinePlay,
  threadVisualRecede = false,
  localRecovery,
  syncAttemptCount,
  isSyncingStatus,
  onManualStatusSync,
  thumbnailPlaceholderKind,
  thumbnailPlaceholderHash,
  thumbnailDominantColor,
}: VibeClipPosterProps) {
  const cardAspectRatio = cardAspectRatioForMeta(meta);
  const posterState = posterStateForMeta(meta, posterPreviewState);
  const hasPosterVisual = !!meta.thumbnailUrl && posterState !== 'failed';
  const isProcessing = isServerProcessingClip(meta);
  const isFailed = isFailedClip(meta);
  const canOpenImmersive = isRemotePlaybackUri(meta.videoUrl) || isLocalPreviewUri(meta.videoUrl);
  const unavailableCopy = resolveMediaFallbackCopy({ reason: 'asset_deleted' });

  return (
    <View
      testID="vibe-clip-bubble"
      style={[
        styles.outer,
        {
          borderColor: isMine ? ACCENT_DIM : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
          opacity: threadVisualRecede ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio, maxHeight: INLINE_CLIP_MAX_HEIGHT }]}>
        <VibeClipPosterImage
          uri={meta.thumbnailUrl}
          previewState={posterState}
          placeholderKind={thumbnailPlaceholderKind}
          placeholderHash={thumbnailPlaceholderHash}
          dominantColor={thumbnailDominantColor}
          onPreviewStateChange={onPosterPreviewStateChange}
        />
        {!hasPosterVisual ? (
          <View style={styles.posterFallback} pointerEvents="none">
            <MediaPlaceholder
              kind={thumbnailPlaceholderKind}
              hash={thumbnailPlaceholderHash}
              dominantColor={thumbnailDominantColor}
            />
            <Ionicons name="film-outline" size={34} color="rgba(216,180,254,0.42)" />
          </View>
        ) : null}

        {onRequestImmersive && !isProcessing && !isFailed ? (
          <Pressable
            onPress={() => {
              if (!canOpenImmersive) {
                void onRefreshClipMedia('initial').then((didRefresh) => {
                  if (didRefresh) onRequestImmersive();
                });
                return;
              }
              onRequestImmersive();
            }}
            style={({ pressed }) => [
              styles.expandBtn,
              {
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(255,255,255,0.18)',
                backgroundColor: 'rgba(0,0,0,0.48)',
              },
              pressed && { opacity: 0.88 },
            ]}
            accessibilityLabel="Open clip full screen"
            hitSlop={6}
          >
            <Ionicons name="expand-outline" size={20} color="rgba(255,255,255,0.95)" />
          </Pressable>
        ) : null}

        {isFailed ? (
          <View style={[styles.loadingOverlay, styles.clipErrorOverlay]} pointerEvents="none">
            <Ionicons name="videocam-off-outline" size={28} color="rgba(196,181,253,0.88)" />
            <Text style={styles.clipUnavailableTitle}>{unavailableCopy.title}</Text>
            <Text style={styles.clipUnavailableText}>{unavailableCopy.message}</Text>
          </View>
        ) : isProcessing ? (
          <View style={styles.playOverlay} pointerEvents="none">
            <View style={styles.playButton}>
              <ActivityIndicator color="rgba(255,255,255,0.95)" size="small" />
            </View>
            <Text style={styles.playHint}>Preparing clip…</Text>
          </View>
        ) : (
          <Pressable
            onPress={onRequestInlinePlay}
            style={({ pressed }) => [styles.playOverlay, pressed && { opacity: 0.86 }]}
            accessibilityRole="button"
            accessibilityLabel="Play clip"
          >
            <View style={styles.playButton}>
              <Ionicons name="play" size={24} color="rgba(255,255,255,0.96)" style={styles.playIcon} />
            </View>
          </Pressable>
        )}

        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{meta.durationLabel}</Text>
        </View>
      </View>
      <VibeClipRecoveryPanel
        meta={meta}
        isMine={isMine}
        localRecovery={localRecovery}
        syncAttemptCount={syncAttemptCount}
        isSyncingStatus={isSyncingStatus}
        onManualStatusSync={onManualStatusSync}
      />
    </View>
  );
}

export function VibeClipCard(props: Props) {
  const {
    meta,
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    onRequestImmersive,
    onPosterPreviewStateChange,
    posterPreviewState,
    shouldMountPlayer: shouldMountPlayerProp,
    isViewportActive = true,
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
    clientRequestId,
  } = props;
  const [retryNonce, setRetryNonce] = useState(0);
  const [forceMountPlayer, setForceMountPlayer] = useState(false);
  const [inlinePlayRequestToken, setInlinePlayRequestToken] = useState(0);
  const [playableVideoUrl, setPlayableVideoUrl] = useState(meta.videoUrl);
  const [playableThumbnailUrl, setPlayableThumbnailUrl] = useState(meta.thumbnailUrl ?? null);
  const [syncedProcessingStatus, setSyncedProcessingStatus] = useState<ChatVibeClipProcessingStatus | null>(null);
  const [syncAttemptCount, setSyncAttemptCount] = useState(0);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [fallbackPosterPreviewState, setFallbackPosterPreviewState] =
    useState<VibeClipPosterPreviewState>('unknown');
  const playbackRefreshAttemptCountRef = useRef(0);
  const posterRetryStateRef = useRef<{ key: string; attempts: number }>({ key: '', attempts: 0 });
  const posterNotReadyRef = useRef(false);
  const localPreviewUnavailableForRef = useRef<string | null>(null);
  const playableVideoUrlRef = useRef(meta.videoUrl);
  const playableThumbnailUrlRef = useRef<string | null>(meta.thumbnailUrl ?? null);
  const readyRefreshKeyRef = useRef<string | null>(null);
  const statusSyncInFlightRef = useRef(false);
  const statusSyncRunIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const handleRealtimeProcessingStatus = useCallback((status: ChatVibeClipProcessingStatus) => {
    setSyncedProcessingStatus(status);
  }, []);
  const { url: videoAssetUrl, refresh: refreshVideoAsset } = useMediaAsset({
    kind: 'vibe_clip',
    messageId: sparkMessageId,
    sourceRef: videoSourceRef,
    initialUrl: meta.videoUrl,
    autoResolve: false,
    processingStatus: syncedProcessingStatus ?? meta.processingStatus,
    onResolvedUrl: onResolvedVideoUrl,
    onProcessingStatusChange: handleRealtimeProcessingStatus,
  });
  const {
    url: thumbnailAssetUrl,
    placeholderKind: thumbnailPlaceholderKind,
    placeholderHash: thumbnailPlaceholderHash,
    dominantColor: thumbnailDominantColor,
    refresh: refreshThumbnailAsset,
  } = useMediaAsset({
    kind: 'thumbnail',
    messageId: sparkMessageId,
    sourceRef: thumbnailSourceRef,
    initialUrl: meta.thumbnailUrl,
    autoResolve: false,
    onResolvedUrl: onResolvedThumbnailUrl,
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isUploadPendingStatus(meta.processingStatus) || localPreviewUnavailableForRef.current !== meta.videoUrl) {
      localPreviewUnavailableForRef.current = null;
    }
    const nextVideoUrl = localPreviewUnavailableForRef.current === meta.videoUrl ? '' : meta.videoUrl;
    playableVideoUrlRef.current = nextVideoUrl;
    playableThumbnailUrlRef.current = meta.thumbnailUrl ?? null;
    setForceMountPlayer(false);
    setInlinePlayRequestToken(0);
    setRetryNonce(0);
    setPlayableVideoUrl(nextVideoUrl);
    setPlayableThumbnailUrl(meta.thumbnailUrl ?? null);
    setSyncedProcessingStatus(null);
    setSyncAttemptCount(0);
    setIsSyncingStatus(false);
    setFallbackPosterPreviewState('unknown');
    playbackRefreshAttemptCountRef.current = 0;
    posterRetryStateRef.current = { key: '', attempts: 0 };
    readyRefreshKeyRef.current = null;
    statusSyncRunIdRef.current += 1;
    statusSyncInFlightRef.current = false;
  }, [meta.processingStatus, meta.thumbnailUrl, meta.videoUrl, sparkMessageId]);

  useEffect(() => {
    if (!videoAssetUrl || videoAssetUrl === playableVideoUrlRef.current) return;
    localPreviewUnavailableForRef.current = null;
    playableVideoUrlRef.current = videoAssetUrl;
    setPlayableVideoUrl(videoAssetUrl);
  }, [videoAssetUrl]);

  useEffect(() => {
    if (isViewportActive) return;
    setForceMountPlayer(false);
    setInlinePlayRequestToken(0);
  }, [isViewportActive]);

  useEffect(() => {
    const nextThumbnailUrl = thumbnailAssetUrl ?? null;
    if (!nextThumbnailUrl || nextThumbnailUrl === playableThumbnailUrlRef.current) return;
    playableThumbnailUrlRef.current = nextThumbnailUrl;
    setPlayableThumbnailUrl(nextThumbnailUrl);
  }, [thumbnailAssetUrl]);

  const processingStatus = syncedProcessingStatus ?? meta.processingStatus;
  const isSyncableServerProcessing =
    isUploadPendingStatus(processingStatus) && !isLocalPreviewUri(playableVideoUrl);
  const effectiveClientRequestId = clientRequestId ?? meta.clientRequestId ?? null;
  const shouldAutoSyncProcessingStatus = isSyncableServerProcessing;

  const handleLocalPreviewUnavailable = useCallback(() => {
    const currentPreviewUri = playableVideoUrlRef.current;
    if (!isUploadPendingStatus(processingStatus) || !isLocalPreviewUri(currentPreviewUri)) return;
    localPreviewUnavailableForRef.current = currentPreviewUri;
    playableVideoUrlRef.current = '';
    setPlayableVideoUrl('');
    setForceMountPlayer(false);
    setInlinePlayRequestToken(0);
  }, [processingStatus]);

  const syncCurrentClipStatus = useCallback(async (): Promise<ChatVibeClipProcessingStatus | null> => {
    const result = await syncChatVibeClipUploadStatus({
      messageId: sparkMessageId,
      clientRequestId: effectiveClientRequestId,
    });
    return result?.status ?? null;
  }, [effectiveClientRequestId, sparkMessageId]);

  useEffect(() => {
    if (!shouldAutoSyncProcessingStatus) return;
    let cancelled = false;
    let terminalReached = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const syncStatus = async () => {
      if (statusSyncInFlightRef.current) return;
      const runId = statusSyncRunIdRef.current + 1;
      statusSyncRunIdRef.current = runId;
      statusSyncInFlightRef.current = true;
      setIsSyncingStatus(true);
      try {
        const status = await syncCurrentClipStatus();
        if (!cancelled) {
          setSyncAttemptCount((count) => count + 1);
          if (status) {
            setSyncedProcessingStatus(status);
            if (status === 'ready' || status === 'failed') {
              terminalReached = true;
              if (timeoutId) clearTimeout(timeoutId);
            }
          }
        }
      } catch {
        if (!cancelled) setSyncAttemptCount((count) => count + 1);
      } finally {
        if (statusSyncRunIdRef.current === runId) {
          statusSyncInFlightRef.current = false;
          if (!cancelled) setIsSyncingStatus(false);
        }
      }
    };

    const scheduleNextSync = () => {
      if (cancelled || terminalReached) return;
      timeoutId = setTimeout(() => {
        void syncStatus().finally(scheduleNextSync);
      }, CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS);
    };

    void syncStatus().finally(scheduleNextSync);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [shouldAutoSyncProcessingStatus, syncCurrentClipStatus]);

  useEffect(() => {
    if (!shouldAutoSyncProcessingStatus) {
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
      setIsSyncingStatus(false);
    }
  }, [shouldAutoSyncProcessingStatus]);

  const requestManualStatusSync = useCallback(() => {
    if (statusSyncInFlightRef.current) return;
    const runId = statusSyncRunIdRef.current + 1;
    statusSyncRunIdRef.current = runId;
    statusSyncInFlightRef.current = true;
    setIsSyncingStatus(true);
    void syncCurrentClipStatus()
      .then((status) => {
        if (!isMountedRef.current) return;
        setSyncAttemptCount((count) => count + 1);
        if (status) setSyncedProcessingStatus(status);
      })
      .catch(() => {
        if (isMountedRef.current) setSyncAttemptCount((count) => count + 1);
      })
      .finally(() => {
        if (statusSyncRunIdRef.current === runId) {
          statusSyncInFlightRef.current = false;
          if (isMountedRef.current) setIsSyncingStatus(false);
        }
      });
  }, [syncCurrentClipStatus]);

  const parentPosterPreviewState =
    playableThumbnailUrl === (meta.thumbnailUrl ?? null) ? posterPreviewState : undefined;
  const effectivePosterPreviewState = !playableThumbnailUrl
    ? 'failed'
    : parentPosterPreviewState === 'ready' || parentPosterPreviewState === 'failed'
      ? parentPosterPreviewState
      : fallbackPosterPreviewState;
  const setPosterPreviewState = useCallback(
    (state: VibeClipPosterPreviewState, thumbnailUrl: string | null = playableThumbnailUrl) => {
      setFallbackPosterPreviewState(state);
      onPosterPreviewStateChange?.(state, thumbnailUrl);
    },
    [onPosterPreviewStateChange, playableThumbnailUrl],
  );

  useEffect(() => {
    if (!playableThumbnailUrl || effectivePosterPreviewState !== 'unknown') return;
    const timeout = setTimeout(() => setPosterPreviewState('failed', playableThumbnailUrl), POSTER_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [effectivePosterPreviewState, playableThumbnailUrl, setPosterPreviewState]);

  const refreshClipMedia = useCallback(async (reason: VibeClipMediaRefreshReason = 'preview'): Promise<boolean> => {
    if (
      !sparkMessageId ||
      (!videoSourceRef && !thumbnailSourceRef)
    ) {
      return false;
    }
    const refreshOptions =
      reason === 'manual'
        ? { bypassFailureCooldown: true }
        : reason === 'preview'
          ? { bypassFailureCooldown: true, suppressFailureCache: true }
          : undefined;
    if (reason === 'playback') {
      if (!videoSourceRef) return false;
      if (playbackRefreshAttemptCountRef.current >= MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS) return false;
      playbackRefreshAttemptCountRef.current += 1;
    }
    const freshThumbnailUri = thumbnailSourceRef
      ? await refreshThumbnailAsset(reason === 'manual' ? 'manual' : 'preview', refreshOptions)
      : null;
    if (freshThumbnailUri) {
      playableThumbnailUrlRef.current = freshThumbnailUri;
      setPosterPreviewState('unknown', freshThumbnailUri);
      setPlayableThumbnailUrl(freshThumbnailUri);
      onResolvedThumbnailUrl?.(freshThumbnailUri);
    }
    if (reason === 'preview') return !!freshThumbnailUri;
    if (!videoSourceRef) return false;

    const freshVideoUri = await refreshVideoAsset(reason, refreshOptions);
    if (!freshVideoUri || freshVideoUri === playableVideoUrl) return false;
    localPreviewUnavailableForRef.current = null;
    playableVideoUrlRef.current = freshVideoUri;
    setPlayableVideoUrl(freshVideoUri);
    onResolvedVideoUrl?.(freshVideoUri);
    return true;
  }, [
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    playableVideoUrl,
    refreshThumbnailAsset,
    refreshVideoAsset,
    setPosterPreviewState,
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
  ]);

  useEffect(() => {
    if (processingStatus !== 'ready' || syncedProcessingStatus !== 'ready' || !sparkMessageId) return;
    if (!videoSourceRef && !thumbnailSourceRef) return;
    const refreshKey = `${sparkMessageId}:${videoSourceRef ?? ''}:${thumbnailSourceRef ?? ''}`;
    if (readyRefreshKeyRef.current === refreshKey) return;
    readyRefreshKeyRef.current = refreshKey;
    // The poster becomes available right as the clip turns ready — give it a fresh budget.
    posterRetryStateRef.current = { key: '', attempts: 0 };
    void refreshClipMedia('manual');
  }, [processingStatus, refreshClipMedia, sparkMessageId, syncedProcessingStatus, thumbnailSourceRef, videoSourceRef]);

  const requestImmersiveWithCurrentMedia = useCallback(() => {
    onRequestImmersive?.({
      videoUrl: playableVideoUrlRef.current,
      thumbnailUrl: playableThumbnailUrlRef.current,
    });
  }, [onRequestImmersive]);

  // True while a poster is still expected but not displaying: unresolved ref, or
  // resolved-but-broken (a 404 / load timeout before Bunny generated the thumbnail.jpg).
  const posterNotReady =
    !isSyncableServerProcessing &&
    !!thumbnailSourceRef &&
    (!playableThumbnailUrl ||
      isResolvableMediaRef(playableThumbnailUrl) ||
      effectivePosterPreviewState === 'failed');
  useEffect(() => {
    posterNotReadyRef.current = posterNotReady;
  }, [posterNotReady]);

  // Bounded first-go poster retry mirroring web: re-sign the thumbnail (new URL →
  // <Image> reloads) on a [1s, 3s, 8s] backoff, capped per target so a thumbnail Bunny
  // never generates cannot loop. Reset on target change / ready / manual retry.
  useEffect(() => {
    if (!sparkMessageId || !thumbnailSourceRef || !posterNotReady) return;
    const retryKey = `${sparkMessageId}:${thumbnailSourceRef}`;
    if (posterRetryStateRef.current.key !== retryKey) {
      posterRetryStateRef.current = { key: retryKey, attempts: 0 };
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const state = posterRetryStateRef.current;
      if (cancelled || state.attempts >= POSTER_PREVIEW_RETRY_DELAYS_MS.length) return;
      const delay = POSTER_PREVIEW_RETRY_DELAYS_MS[state.attempts];
      timer = setTimeout(() => {
        timer = null;
        if (cancelled || !posterNotReadyRef.current) return;
        posterRetryStateRef.current.attempts += 1;
        void refreshClipMedia('preview').finally(() => {
          if (!cancelled && posterNotReadyRef.current) run();
        });
      }, delay);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [effectivePosterPreviewState, posterNotReady, refreshClipMedia, sparkMessageId, thumbnailSourceRef]);

  const resolvedMeta = {
    ...meta,
    processingStatus,
    videoUrl: playableVideoUrl,
    thumbnailUrl: playableThumbnailUrl,
  };

  const resolvedProps = {
    ...props,
    meta: resolvedMeta,
    posterPreviewState: effectivePosterPreviewState,
    onPosterPreviewStateChange: setPosterPreviewState,
    onRequestImmersive: requestImmersiveWithCurrentMedia,
    thumbnailPlaceholderKind,
    thumbnailPlaceholderHash,
    thumbnailDominantColor,
  };

  const canMountPlayer = isRemotePlaybackUri(playableVideoUrl) || isLocalPreviewUri(playableVideoUrl);
  const isProcessing = isServerProcessingClip(resolvedMeta);
  const isFailed = isFailedClip(resolvedMeta);
  const shouldMountPlayer =
    isViewportActive && !isProcessing && !isFailed && canMountPlayer && (shouldMountPlayerProp || forceMountPlayer);
  if (!shouldMountPlayer) {
    return (
      <VibeClipCardPosterOnly
        {...resolvedProps}
        onRefreshClipMedia={refreshClipMedia}
        onRequestInlinePlay={() => {
          if (!canMountPlayer) {
            void refreshClipMedia('initial').then((didRefresh) => {
              if (!didRefresh) return;
              setInlinePlayRequestToken((token) => token + 1);
              setForceMountPlayer(true);
            });
            return;
          }
          setInlinePlayRequestToken((token) => token + 1);
          setForceMountPlayer(true);
        }}
        syncAttemptCount={syncAttemptCount}
        isSyncingStatus={isSyncingStatus}
        onManualStatusSync={requestManualStatusSync}
      />
    );
  }
  return (
    <VibeClipCardInner
      key={`${playableVideoUrl}-${retryNonce}`}
      {...resolvedProps}
      onRefreshClipMedia={refreshClipMedia}
      onLocalPreviewUnavailable={handleLocalPreviewUnavailable}
      onRemountPlayer={() => setRetryNonce((n) => n + 1)}
      onResetPlaybackRefreshAttempt={() => {
        playbackRefreshAttemptCountRef.current = 0;
        posterRetryStateRef.current = { key: '', attempts: 0 };
      }}
      playRequestToken={inlinePlayRequestToken}
      syncAttemptCount={syncAttemptCount}
      isSyncingStatus={isSyncingStatus}
      onManualStatusSync={requestManualStatusSync}
    />
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  videoWrap: {
    width: '100%',
    backgroundColor: 'rgba(22,22,30,0.22)',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,18,30,0.84)',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  expandBtn: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 8,
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionToggleBtn: {
    position: 'absolute',
    top: 8,
    left: 48,
    zIndex: 8,
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  captionOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 34,
    zIndex: 7,
    alignItems: 'center',
  },
  captionOverlayText: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,14,22,0.28)',
  },
  clipErrorOverlay: {
    zIndex: 20,
    backgroundColor: 'rgba(17,17,24,0.94)',
  },
  clipUnavailableTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  clipUnavailableText: {
    color: 'rgba(226,232,240,0.78)',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  playIcon: {
    marginLeft: 3,
  },
  playHint: {
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    color: 'rgba(255,255,255,0.88)',
    backgroundColor: 'rgba(0,0,0,0.46)',
    fontSize: 11,
    fontWeight: '700',
  },
  clipRetryBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.4)',
    backgroundColor: 'rgba(139,92,246,0.12)',
  },
  clipRetryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(216,180,254,0.95)',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: 'rgba(17,17,24,0.78)',
  },
  durationText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  recoveryPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139,92,246,0.18)',
    backgroundColor: 'rgba(0,0,0,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  recoveryText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    lineHeight: 15,
  },
  recoveryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  recoveryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(167,139,250,0.42)',
    backgroundColor: 'rgba(139,92,246,0.18)',
  },
  recoveryButtonSecondary: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  recoveryButtonText: {
    color: 'rgba(245,243,255,0.96)',
    fontSize: 11,
    fontWeight: '700',
  },
  recoveryButtonSecondaryText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 11,
    fontWeight: '700',
  },
  sparkLine: {
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 2,
    opacity: 0.92,
  },
  actionsBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139,92,246,0.18)',
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 3,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  primaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
  secondaryRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 6,
    paddingTop: 2,
    justifyContent: 'flex-start',
  },
  dateBridgeCol: {
    maxWidth: '78%',
    gap: 3,
  },
  dateBridgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,63,94,0.38)',
    backgroundColor: 'rgba(244,63,94,0.12)',
  },
  dateBridgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(254,226,230,0.96)',
  },
  dateBridgeHint: {
    fontSize: 9,
    lineHeight: 12,
    color: 'rgba(255,255,255,0.48)',
    paddingLeft: 2,
  },
  reactionSummary: {
    marginLeft: 'auto',
    fontSize: 13,
    lineHeight: 16,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  secondaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },
});
