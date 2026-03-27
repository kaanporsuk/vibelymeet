import { useEffect, useState, useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { VibeClipDisplayMeta } from '../../../../shared/chat/messageRouting';

type Props = {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
};

const ACCENT = 'rgba(139,92,246,1)';
const ACCENT_DIM = 'rgba(139,92,246,0.55)';

export function VibeClipCard({ meta, isMine, onReplyWithClip, onVoiceReply }: Props) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);

  const player = useVideoPlayer(meta.videoUrl, (p) => {
    p.loop = false;
  });

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
    const sub = player.addListener('playingChange', (ev) => {
      if (ev.isPlaying) setHasPlayed(true);
    });
    return () => sub.remove();
  }, [player]);

  const showActions = hasPlayed && !isMine && (!!onReplyWithClip || !!onVoiceReply);
  const cardAspectRatio =
    typeof meta.aspectRatio === 'number' && Number.isFinite(meta.aspectRatio) && meta.aspectRatio > 0
      ? Math.max(0.5, Math.min(1.2, meta.aspectRatio))
      : 9 / 16;

  if (hasError) {
    return (
      <View style={[styles.outer, styles.errorOuter, { borderColor: theme.glassBorder }]}>
        <Ionicons name="videocam-off-outline" size={28} color={theme.textSecondary} />
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 6 }}>
          Couldn't load clip
        </Text>
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
        },
      ]}
    >
      {/* Branded header strip */}
      <View style={styles.header}>
        <View style={styles.brandPill}>
          <Ionicons name="film-outline" size={11} color={ACCENT} />
          <Text style={styles.brandLabel}>Vibe Clip</Text>
        </View>
      </View>

      {/* Video surface */}
      <View style={[styles.videoWrap, { aspectRatio: cardAspectRatio }]}>
        {meta.thumbnailUrl && !isReady && (
          <Image source={{ uri: meta.thumbnailUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        )}
        <VideoView style={styles.video} player={player} nativeControls contentFit="cover" />

        {!isReady && (
          <View style={styles.fallback}>
            <Ionicons name="play-circle" size={40} color="rgba(255,255,255,0.9)" />
          </View>
        )}

        {/* Duration badge — bottom-right, always visible */}
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{meta.durationLabel}</Text>
        </View>
      </View>

      {/* After-play interaction scaffold */}
      {showActions && (
        <View style={styles.actionsRow}>
          {onReplyWithClip && (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
              onPress={onReplyWithClip}
              accessibilityLabel="Reply with a Vibe Clip"
            >
              <Ionicons name="film-outline" size={14} color={ACCENT} />
              <Text style={styles.actionLabel}>Reply with clip</Text>
            </Pressable>
          )}
          {onVoiceReply && (
            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
              onPress={onVoiceReply}
              accessibilityLabel="Reply with voice"
            >
              <Ionicons name="mic-outline" size={14} color={ACCENT} />
              <Text style={styles.actionLabel}>Voice reply</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorOuter: {
    aspectRatio: 9 / 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.3)',
  },
  brandLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.3,
  },
  videoWrap: {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,18,0.35)',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(17,17,24,0.78)',
  },
  durationText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139,92,246,0.18)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
});
