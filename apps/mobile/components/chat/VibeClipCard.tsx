import { useEffect, useRef, useState } from 'react';
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
import { safeVideoPlayerCall } from '@/lib/expoVideoSafe';
import { durationBucketFromSeconds, threadBucketFromCount } from '../../../../shared/chat/vibeClipAnalytics';

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
  /** Opens full-screen chat video viewer. */
  onRequestImmersive?: () => void;
  /** Pause inline preview while immersive viewer is open for this URL. */
  immersiveActive?: boolean;
  threadVisualRecede?: boolean;
};

type VibeClipCardInnerProps = Props & { onRemountPlayer: () => void };

const ACCENT = 'rgba(139,92,246,1)';
const ACCENT_DIM = 'rgba(139,92,246,0.55)';
const SECONDARY = 'rgba(255,255,255,0.55)';

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
  onRemountPlayer,
}: VibeClipCardInnerProps) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);

  const player = useVideoPlayer(meta.videoUrl, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    setIsReady(false);
    setHasError(false);
  }, [meta.videoUrl]);

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        setHasError(true);
        return;
      }
      if (payload.status === 'readyToPlay') {
        setIsReady(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (immersiveActive) safeVideoPlayerCall(() => player.pause());
  }, [immersiveActive, player]);

  useEffect(() => {
    const sub = player.addListener('playingChange', (ev) => {
      if (ev.isPlaying) setHasPlayed(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    playStartTracked.current = false;
    playCompleteTracked.current = false;
  }, [meta.videoUrl]);

  useEffect(() => {
    const sub1 = player.addListener('playingChange', (ev) => {
      if (!ev.isPlaying || playStartTracked.current) return;
      playStartTracked.current = true;
      trackVibeClipEvent('clip_play_started', {
        thread_bucket: threadBucketFromCount(threadMessageCount),
        is_sender: isMine,
        duration_bucket: durationBucketFromSeconds(meta.durationSec),
        has_poster: !!meta.thumbnailUrl,
      });
    });
    const sub2 = player.addListener('playToEnd', () => {
      if (playCompleteTracked.current) return;
      playCompleteTracked.current = true;
      trackVibeClipEvent('clip_play_completed', {
        thread_bucket: threadBucketFromCount(threadMessageCount),
        is_sender: isMine,
        duration_bucket: durationBucketFromSeconds(meta.durationSec),
        has_poster: !!meta.thumbnailUrl,
      });
    });
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [player, isMine, threadMessageCount, meta.videoUrl, meta.durationSec, meta.thumbnailUrl]);

  const hasPrimary = !!onReplyWithClip || !!onVoiceReply;
  const hasSecondary = !!onSuggestDate || !!onReact;
  const showActions = hasPlayed && !isMine && (hasPrimary || hasSecondary);
  const reactionSummary = compactReactionLabel(reactionPair ?? null);
  const replySpark =
    showActions && sparkMessageId
      ? replyPromptForContext(threadMessageCount, sparkMessageId)
      : null;
  const cardAspectRatio =
    typeof meta.aspectRatio === 'number' && Number.isFinite(meta.aspectRatio) && meta.aspectRatio > 0
      ? Math.max(0.5, Math.min(1.2, meta.aspectRatio))
      : 9 / 16;

  if (hasError) {
    return (
      <View
        style={[
          styles.outer,
          styles.errorOuter,
          { borderColor: 'rgba(139,92,246,0.35)', backgroundColor: 'rgba(17,17,24,0.92)' },
        ]}
      >
        <Ionicons name="videocam-off-outline" size={28} color="rgba(196,181,253,0.88)" />
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 16 }}>
          {"Couldn't load clip"}
        </Text>
        <Pressable
          onPress={onRemountPlayer}
          style={({ pressed }) => [
            styles.clipRetryBtn,
            pressed && { opacity: 0.88 },
          ]}
        >
          <Text style={styles.clipRetryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

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

      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio }]}>
        {meta.thumbnailUrl && !isReady && (
          <Image source={{ uri: meta.thumbnailUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        )}
        <VideoView style={styles.video} player={player} nativeControls contentFit="cover" />

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

        {!isReady && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <View style={styles.loadingInner}>
              <ActivityIndicator color="rgba(255,255,255,0.92)" size="small" />
              <Text style={styles.loadingLabel}>Loading clip…</Text>
              <Text style={styles.loadingHint}>Tap the video for controls when ready</Text>
            </View>
          </View>
        )}

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

export function VibeClipCard(props: Props) {
  const [retryNonce, setRetryNonce] = useState(0);
  return (
    <VibeClipCardInner
      key={`${props.meta.videoUrl}-${retryNonce}`}
      {...props}
      onRemountPlayer={() => setRetryNonce((n) => n + 1)}
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
  errorOuter: {
    aspectRatio: 9 / 16,
    alignItems: 'center',
    justifyContent: 'center',
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
  loadingLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingHint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 200,
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
