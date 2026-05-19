import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
import {
  refreshCachedChatMediaUrl,
  syncChatVibeClipStatus,
  type ChatVibeClipProcessingStatus,
} from '@/lib/chatMediaResolver';

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
  onRequestImmersive?: (media?: { videoUrl: string; thumbnailUrl?: string | null }) => void;
  /** Pause inline preview while immersive viewer is open for this URL. */
  immersiveActive?: boolean;
  /** Mount the native player only after an explicit play/open request. */
  shouldMountPlayer?: boolean;
  /** Parent-owned poster cache so FlatList remounts do not replay the preview loader. */
  posterPreviewState?: VibeClipPosterPreviewState;
  onPosterPreviewStateChange?: (state: VibeClipPosterPreviewState, thumbnailUrl?: string | null) => void;
  threadVisualRecede?: boolean;
  localRecovery?: VibeClipLocalRecovery | null;
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
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;
const MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS = 1;
const CHAT_VIBE_CLIP_STATUS_SYNC_DELAY_MS = 2500;
const CHAT_VIBE_CLIP_STATUS_SYNC_INTERVAL_MS = 12_000;

function isLocalPreviewUri(uri: string): boolean {
  return uri.startsWith('file:') || uri.startsWith('blob:') || uri.startsWith('data:');
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
  return (
    (meta.processingStatus === 'uploading' || meta.processingStatus === 'processing') &&
    !isLocalPreviewUri(meta.videoUrl)
  );
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
        {localRecovery?.error || localRecovery?.stateLabel || 'Still preparing this clip.'}
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
  onRemountPlayer,
  onResetPlaybackRefreshAttempt,
  playRequestToken,
  localRecovery,
  syncAttemptCount,
  isSyncingStatus,
  onManualStatusSync,
}: VibeClipCardInnerProps) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playRequested, setPlayRequested] = useState(() => playRequestToken > 0);
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);

  const player = useVideoPlayer(videoSourceForUri(meta.videoUrl), (p) => {
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
    if (!playRequested || isReady || hasError) return;
    const timeoutId = setTimeout(() => {
      void onRefreshClipMedia('playback')
        .then((didRefresh) => {
          if (!didRefresh) setHasError(true);
        })
        .catch(() => setHasError(true));
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [hasError, isReady, onRefreshClipMedia, playRequested]);

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
            <Text
              style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 }}
            >
              {"Couldn't load clip"}
            </Text>
            <Pressable
              onPress={() => {
                onResetPlaybackRefreshAttempt();
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
              <Text style={styles.clipRetryLabel}>Try again</Text>
            </Pressable>
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
}: VibeClipPosterProps) {
  const cardAspectRatio = cardAspectRatioForMeta(meta);
  const posterState = posterStateForMeta(meta, posterPreviewState);
  const hasPosterVisual = !!meta.thumbnailUrl && posterState !== 'failed';
  const isProcessing = isServerProcessingClip(meta);
  const isFailed = isFailedClip(meta);
  const canOpenImmersive = isRemotePlaybackUri(meta.videoUrl) || isLocalPreviewUri(meta.videoUrl);

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
            <Text style={styles.clipUnavailableText}>Clip unavailable</Text>
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
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
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
  const posterRefreshAttemptedForRef = useRef<string | null>(null);
  const playableVideoUrlRef = useRef(meta.videoUrl);
  const playableThumbnailUrlRef = useRef<string | null>(meta.thumbnailUrl ?? null);
  const statusSyncInFlightRef = useRef(false);
  const statusSyncRunIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    playableVideoUrlRef.current = meta.videoUrl;
    playableThumbnailUrlRef.current = meta.thumbnailUrl ?? null;
    setForceMountPlayer(false);
    setInlinePlayRequestToken(0);
    setRetryNonce(0);
    setPlayableVideoUrl(meta.videoUrl);
    setPlayableThumbnailUrl(meta.thumbnailUrl ?? null);
    setSyncedProcessingStatus(null);
    setSyncAttemptCount(0);
    setIsSyncingStatus(false);
    setFallbackPosterPreviewState('unknown');
    playbackRefreshAttemptCountRef.current = 0;
    posterRefreshAttemptedForRef.current = null;
    statusSyncRunIdRef.current += 1;
    statusSyncInFlightRef.current = false;
  }, [meta.processingStatus, meta.thumbnailUrl, meta.videoUrl, sparkMessageId]);

  const processingStatus = syncedProcessingStatus ?? meta.processingStatus;
  const isSyncableServerProcessing =
    (processingStatus === 'uploading' || processingStatus === 'processing') && !isLocalPreviewUri(playableVideoUrl);

  useEffect(() => {
    if (!isSyncableServerProcessing || !sparkMessageId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const syncStatus = async () => {
      if (statusSyncInFlightRef.current) return;
      const runId = statusSyncRunIdRef.current + 1;
      statusSyncRunIdRef.current = runId;
      statusSyncInFlightRef.current = true;
      setIsSyncingStatus(true);
      try {
        const status = await syncChatVibeClipStatus(sparkMessageId);
        if (!cancelled) {
          setSyncAttemptCount((count) => count + 1);
          if (status) {
            setSyncedProcessingStatus(status);
            if (status === 'ready' || status === 'failed') {
              if (intervalId) clearInterval(intervalId);
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

    const timeoutId = setTimeout(() => {
      void syncStatus();
      intervalId = setInterval(() => {
        void syncStatus();
      }, CHAT_VIBE_CLIP_STATUS_SYNC_INTERVAL_MS);
    }, CHAT_VIBE_CLIP_STATUS_SYNC_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSyncableServerProcessing, sparkMessageId]);

  useEffect(() => {
    if (!isSyncableServerProcessing) {
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
      setIsSyncingStatus(false);
    }
  }, [isSyncableServerProcessing]);

  const requestManualStatusSync = useCallback(() => {
    if (!sparkMessageId || statusSyncInFlightRef.current) return;
    const runId = statusSyncRunIdRef.current + 1;
    statusSyncRunIdRef.current = runId;
    statusSyncInFlightRef.current = true;
    setIsSyncingStatus(true);
    void syncChatVibeClipStatus(sparkMessageId)
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
  }, [sparkMessageId]);

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
    const refreshOptions = reason === 'manual' ? { bypassFailureCooldown: true } : undefined;
    if (reason === 'playback') {
      if (!videoSourceRef) return false;
      if (playbackRefreshAttemptCountRef.current >= MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS) return false;
      playbackRefreshAttemptCountRef.current += 1;
    }
    const freshThumbnailUri = thumbnailSourceRef
      ? await refreshCachedChatMediaUrl(sparkMessageId, 'thumbnail', thumbnailSourceRef, refreshOptions)
      : null;
    if (freshThumbnailUri) {
      playableThumbnailUrlRef.current = freshThumbnailUri;
      if (freshThumbnailUri !== playableThumbnailUrl) setFallbackPosterPreviewState('unknown');
      setPlayableThumbnailUrl(freshThumbnailUri);
      onResolvedThumbnailUrl?.(freshThumbnailUri);
    }
    if (reason === 'preview') return !!freshThumbnailUri;
    if (!videoSourceRef) return false;

    const freshVideoUri = await refreshCachedChatMediaUrl(sparkMessageId, 'vibe_clip', videoSourceRef, refreshOptions);
    if (!freshVideoUri || freshVideoUri === playableVideoUrl) return false;
    playableVideoUrlRef.current = freshVideoUri;
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

  const requestImmersiveWithCurrentMedia = useCallback(() => {
    onRequestImmersive?.({
      videoUrl: playableVideoUrlRef.current,
      thumbnailUrl: playableThumbnailUrlRef.current,
    });
  }, [onRequestImmersive]);

  useEffect(() => {
    const posterResolveKey = thumbnailSourceRef ?? playableThumbnailUrl ?? '';
    const shouldResolvePosterPreview =
      !isSyncableServerProcessing &&
      !!thumbnailSourceRef &&
      (!playableThumbnailUrl || isResolvableMediaRef(playableThumbnailUrl));
    if (
      !shouldResolvePosterPreview ||
      !posterResolveKey ||
      posterRefreshAttemptedForRef.current === posterResolveKey
    ) {
      return;
    }
    posterRefreshAttemptedForRef.current = posterResolveKey;
    void refreshClipMedia('preview');
  }, [isSyncableServerProcessing, playableThumbnailUrl, refreshClipMedia, thumbnailSourceRef]);

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
  };

  const canMountPlayer = isRemotePlaybackUri(playableVideoUrl) || isLocalPreviewUri(playableVideoUrl);
  const isProcessing = isServerProcessingClip(resolvedMeta);
  const isFailed = isFailedClip(resolvedMeta);
  const shouldMountPlayer = !isProcessing && !isFailed && canMountPlayer && (shouldMountPlayerProp || forceMountPlayer);
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
      onRemountPlayer={() => setRetryNonce((n) => n + 1)}
      onResetPlaybackRefreshAttempt={() => {
        playbackRefreshAttemptCountRef.current = 0;
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
