import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { VibeClipDisplayMeta } from '../../../../shared/chat/messageRouting';

type Props = {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
};

const ACCENT = 'rgba(139,92,246,1)';
const ACCENT_DIM = 'rgba(139,92,246,0.55)';

export function VibeClipCard({ meta, isMine }: Props) {
  const theme = Colors[useColorScheme()];
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

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
      <View style={styles.videoWrap}>
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
    aspectRatio: 9 / 16,
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
});
