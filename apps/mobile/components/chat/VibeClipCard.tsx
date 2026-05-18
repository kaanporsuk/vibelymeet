import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
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
import { refreshCachedChatMediaUrl } from '@/lib/chatMediaResolver';

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
  /** Opens full-screen chat video viewer. */
  onRequestImmersive?: () => void;
  /** Pause inline preview while immersive viewer is open for this URL. */
  immersiveActive?: boolean;
  /** Mount the native player only after an explicit play/open request. */
  shouldMountPlayer?: boolean;
  /** Parent-owned poster cache so FlatList remounts do not replay the preview loader. */
  posterPreviewState?: VibeClipPosterPreviewState;
  onPosterPreviewStateChange?: (state: VibeClipPosterPreviewState, thumbnailUrl?: string | null) => void;
  threadVisualRecede?: boolean;
};

export type VibeClipPosterPreviewState = 'unknown' | 'ready' | 'failed';
type VibeClipMediaRefreshReason = 'preview' | 'playback';

type VibeClipCardInnerProps = Props & {
  onRefreshClipMedia: (reason?: VibeClipMediaRefreshReason) => Promise<boolean>;
  onRemountPlayer: () => void;
  playRequestToken: number;
};
type VibeClipPosterProps = Props & {
  onRefreshClipMedia: (reason?: VibeClipMediaRefreshReason) => Promise<boolean>;
  onRequestInlinePlay: () => void;
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
  onPreviewStateChange,
  onRefreshClipMedia,
}: {
  uri: string | null;
  previewState: VibeClipPosterPreviewState;
  onPreviewStateChange?: (state: VibeClipPosterPreviewState, thumbnailUrl?: string | null) => void;
  onRefreshClipMedia: (reason?: VibeClipMediaRefreshReason) => Promise<boolean>;
}) {
  if (!uri || previewState === 'failed') return null;
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      resizeMode="cover"
      onLoad={() => onPreviewStateChange?.('ready', uri)}
      onError={() => {
        void onRefreshClipMedia('preview')
          .then((didRefresh) => {
            if (!didRefresh) onPreviewStateChange?.('failed', uri);
          })
          .catch(() => onPreviewStateChange?.('failed', uri));
      }}
    />
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
  onRemountPlayer,
  playRequestToken,
}: VibeClipCardInnerProps) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(() => playRequestToken > 0);
  const [playRequested, setPlayRequested] = useState(() => playRequestToken > 0);
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);

  const player = useVideoPlayer(meta.videoUrl, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    setIsReady(false);
    setIsBuffering(false);
    setHasError(false);
    setHasPlayed(false);
    setPlayRequested(false);
  }, [meta.videoUrl]);

  useEffect(() => {
    if (playRequestToken <= 0) return;
    setPlayRequested(true);
    setHasPlayed(true);
  }, [playRequestToken]);

  useEffect(() => {
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        if (payload.status === 'error') {
          void onRefreshClipMedia('playback')
            .then((didRefresh) => {
              if (!didRefresh) setHasError(true);
            })
            .catch(() => setHasError(true));
          setIsBuffering(false);
          return;
        }
        setIsBuffering(payload.status === 'loading');
        if (payload.status === 'readyToPlay') {
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
  }, [onRefreshClipMedia, player]);

  const playInline = useCallback(() => {
    setPlayRequested(true);
    setHasPlayed(true);
    if (!isReady) return;
    const result = safeExpoSharedObjectCall(() => player.play(), {
      label: 'vibeClip.player.playInline',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.playInline');
  }, [isReady, player]);

  useEffect(() => {
    if (!playRequested || !isReady) return;
    const result = safeExpoSharedObjectCall(() => player.play(), {
      label: 'vibeClip.player.playRequested',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.playRequested');
  }, [isReady, playRequested, player]);

  useEffect(() => {
    if (!immersiveActive) return;
    const result = safeExpoSharedObjectCall(() => player.pause(), {
      label: 'vibeClip.player.pause.immersive',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeClip.player.pause.immersive');
  }, [immersiveActive, player]);

  useEffect(() => {
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
  }, [player]);

  useEffect(() => {
    playStartTracked.current = false;
    playCompleteTracked.current = false;
  }, [meta.videoUrl]);

  useEffect(() => {
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
  }, [player, isMine, threadMessageCount, meta.videoUrl, meta.durationSec, meta.thumbnailUrl]);

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

  return (
    <View
      style={[
        styles.outer,
        {
          borderColor: isMine ? ACCENT_DIM : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
          opacity: threadVisualRecede ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.brandPill}>
          <Ionicons name="film-outline" size={10} color={ACCENT} />
          <Text style={styles.brandLabel}>Clip</Text>
        </View>
      </View>

      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio, maxHeight: INLINE_CLIP_MAX_HEIGHT }]}>
        {!isReady ? (
          <VibeClipPosterImage
            uri={meta.thumbnailUrl}
            previewState={posterState}
            onPreviewStateChange={onPosterPreviewStateChange}
            onRefreshClipMedia={onRefreshClipMedia}
          />
        ) : null}
        {!isReady && !hasPosterVisual ? (
          <View style={styles.posterFallback} pointerEvents="none">
            <Ionicons name="film-outline" size={34} color="rgba(216,180,254,0.42)" />
          </View>
        ) : null}
        <VideoView
          style={[styles.video, !isReady || hasError ? { opacity: 0 } : null]}
          player={player}
          nativeControls
          contentFit="cover"
        />

        {onRequestImmersive ? (
          <Pressable
            onPress={onRequestImmersive}
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
            <Text style={styles.playHint}>Tap to play</Text>
          </Pressable>
        ) : null}

        {hasError ? (
          <View style={[styles.loadingOverlay, styles.clipErrorOverlay]}>
            <Ionicons name="videocam-off-outline" size={28} color="rgba(196,181,253,0.88)" />
            <Text
              style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 }}
            >
              {"Couldn't load clip"}
            </Text>
            <Pressable
              onPress={() => {
                void onRefreshClipMedia('playback')
                  .then((didRefresh) => {
                    if (!didRefresh) onRemountPlayer();
                  })
                  .catch(onRemountPlayer);
              }}
              style={({ pressed }) => [styles.clipRetryBtn, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.clipRetryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{meta.durationLabel}</Text>
        </View>
      </View>

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
}: VibeClipPosterProps) {
  const cardAspectRatio = cardAspectRatioForMeta(meta);
  const posterState = posterStateForMeta(meta, posterPreviewState);
  const hasPosterVisual = !!meta.thumbnailUrl && posterState !== 'failed';
  const showPreviewLoader = !!meta.thumbnailUrl && posterState === 'unknown';

  return (
    <View
      style={[
        styles.outer,
        {
          borderColor: isMine ? ACCENT_DIM : 'rgba(255,255,255,0.14)',
          backgroundColor: isMine ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
          opacity: threadVisualRecede ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.brandPill}>
          <Ionicons name="film-outline" size={10} color={ACCENT} />
          <Text style={styles.brandLabel}>Clip</Text>
        </View>
      </View>

      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio, maxHeight: INLINE_CLIP_MAX_HEIGHT }]}>
        <VibeClipPosterImage
          uri={meta.thumbnailUrl}
          previewState={posterState}
          onPreviewStateChange={onPosterPreviewStateChange}
          onRefreshClipMedia={onRefreshClipMedia}
        />
        {!hasPosterVisual ? (
          <View style={styles.posterFallback} pointerEvents="none">
            <Ionicons name="film-outline" size={34} color="rgba(216,180,254,0.42)" />
          </View>
        ) : null}

        {onRequestImmersive ? (
          <Pressable
            onPress={onRequestImmersive}
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

        {showPreviewLoader ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <View style={styles.loadingInner}>
              <ActivityIndicator color="rgba(255,255,255,0.92)" size="small" />
            </View>
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
            <Text style={styles.playHint}>Tap to play</Text>
          </Pressable>
        )}

        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{meta.durationLabel}</Text>
        </View>
      </View>
    </View>
  );
}

export function VibeClipCard(props: Props) {
  const {
    meta,
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    onPosterPreviewStateChange,
    posterPreviewState,
    shouldMountPlayer: shouldMountPlayerProp,
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
  } = props;
  const [retryNonce, setRetryNonce] = useState(0);
  const [forceMountPlayer, setForceMountPlayer] = useState(false);
  const [inlinePlayRequestToken, setInlinePlayRequestToken] = useState(0);
  const [playableVideoUrl, setPlayableVideoUrl] = useState(meta.videoUrl);
  const [playableThumbnailUrl, setPlayableThumbnailUrl] = useState(meta.thumbnailUrl ?? null);
  const [fallbackPosterPreviewState, setFallbackPosterPreviewState] =
    useState<VibeClipPosterPreviewState>('unknown');
  const refreshAttemptedForUriRef = useRef<string | null>(null);
  useEffect(() => {
    setForceMountPlayer(false);
    setInlinePlayRequestToken(0);
    setRetryNonce(0);
    setPlayableVideoUrl(meta.videoUrl);
    setPlayableThumbnailUrl(meta.thumbnailUrl ?? null);
    setFallbackPosterPreviewState('unknown');
    refreshAttemptedForUriRef.current = null;
  }, [meta.thumbnailUrl, meta.videoUrl]);

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
      (!videoSourceRef && !thumbnailSourceRef) ||
      refreshAttemptedForUriRef.current === playableVideoUrl
    ) {
      return false;
    }
    const freshVideoUri = videoSourceRef
      ? await refreshCachedChatMediaUrl(sparkMessageId, 'vibe_clip', videoSourceRef)
      : null;
    const freshThumbnailUri = thumbnailSourceRef
      ? await refreshCachedChatMediaUrl(sparkMessageId, 'thumbnail', thumbnailSourceRef)
      : null;
    if (freshThumbnailUri) {
      if (freshThumbnailUri !== playableThumbnailUrl) setFallbackPosterPreviewState('unknown');
      setPlayableThumbnailUrl(freshThumbnailUri);
      onResolvedThumbnailUrl?.(freshThumbnailUri);
    }
    if (!freshVideoUri || freshVideoUri === playableVideoUrl) return reason === 'preview' && !!freshThumbnailUri;
    refreshAttemptedForUriRef.current = playableVideoUrl;
    setPlayableVideoUrl(freshVideoUri);
    onResolvedVideoUrl?.(freshVideoUri);
    return true;
  }, [
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    playableThumbnailUrl,
    playableVideoUrl,
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
  ]);

  const resolvedProps = {
    ...props,
    meta: {
      ...meta,
      videoUrl: playableVideoUrl,
      thumbnailUrl: playableThumbnailUrl,
    },
    posterPreviewState: effectivePosterPreviewState,
    onPosterPreviewStateChange: setPosterPreviewState,
  };

  const shouldMountPlayer = shouldMountPlayerProp || forceMountPlayer;
  if (!shouldMountPlayer) {
    return (
      <VibeClipCardPosterOnly
        {...resolvedProps}
        onRefreshClipMedia={refreshClipMedia}
        onRequestInlinePlay={() => {
          setInlinePlayRequestToken((token) => token + 1);
          setForceMountPlayer(true);
        }}
      />
    );
  }
  return (
    <VibeClipCardInner
      key={`${playableVideoUrl}-${retryNonce}`}
      {...resolvedProps}
      onRefreshClipMedia={refreshClipMedia}
      onRemountPlayer={() => setRetryNonce((n) => n + 1)}
      playRequestToken={inlinePlayRequestToken}
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
  header: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.22)',
  },
  brandLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 0.4,
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
  loadingInner: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.28)',
    backgroundColor: 'rgba(0,0,0,0.52)',
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
