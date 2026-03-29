import { type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Colors from '@/constants/Colors';

export function formatVoiceDurationClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type VoiceMessagePlayerProps = {
  uri: string;
  durationSeconds?: number | null;
  isMine: boolean;
  theme: (typeof Colors)['light'];
  footer: ReactNode;
  /** Merged with base wrap (width constraints from parent). */
  wrapStyle?: StyleProp<ViewStyle>;
};

/**
 * Voice bubble player: idle state never shows misleading 0:00 as “elapsed”; uses DB duration when known.
 */
export function VoiceMessagePlayer({
  uri,
  durationSeconds,
  isMine,
  theme,
  footer,
  wrapStyle,
}: VoiceMessagePlayerProps) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const positionRaw = status.currentTime ?? 0;
  const fromDb = durationSeconds != null && durationSeconds > 0 ? durationSeconds : 0;
  const fromPlayer = status.duration != null && status.duration > 0 ? status.duration : 0;
  const totalDuration = fromDb > 0 ? fromDb : fromPlayer;

  const position =
    totalDuration > 0 ? Math.min(Math.max(0, positionRaw), totalDuration) : Math.max(0, positionRaw);
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, position / totalDuration)) : 0;

  const fg = isMine ? 'rgba(255,255,255,0.95)' : theme.text;
  const track = isMine ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
  const fill = isMine ? 'rgba(255,255,255,0.95)' : theme.tint;
  const sub = isMine ? 'rgba(255,255,255,0.75)' : theme.textSecondary;

  const toggle = () => {
    if (playing) player.pause();
    else player.play();
  };

  const timeLabel = (() => {
    if (!playing) {
      if (totalDuration > 0) return formatVoiceDurationClock(totalDuration);
      return 'Voice message';
    }
    if (totalDuration > 0) {
      return `${formatVoiceDurationClock(position)} · ${formatVoiceDurationClock(totalDuration)}`;
    }
    return formatVoiceDurationClock(position);
  })();

  return (
    <View style={[styles.wrap, wrapStyle]}>
      <Pressable
        onPress={toggle}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={
          totalDuration > 0
            ? `${playing ? 'Pause' : 'Play'} voice message, ${formatVoiceDurationClock(totalDuration)}`
            : `${playing ? 'Pause' : 'Play'} voice message`
        }
      >
        <View style={[styles.playSide, isMine ? styles.playSideMine : null]}>
          <Ionicons name={playing ? 'pause' : 'play'} size={20} color={fg} />
          {status.isBuffering && playing ? (
            <ActivityIndicator size="small" color={fg} style={styles.bufferSpinner} />
          ) : null}
        </View>
        <View style={styles.mid}>
          <View style={[styles.progressTrack, { backgroundColor: track }]}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: fill }]} />
          </View>
          <Text numberOfLines={1} style={[styles.timeRow, { color: sub }]}>{timeLabel}</Text>
        </View>
      </Pressable>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 0, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  playSide: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playSideMine: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bufferSpinner: { width: 16, height: 16 },
  mid: { flex: 1, minWidth: 0, marginLeft: 8 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  timeRow: { fontSize: 10, marginTop: 5, fontVariant: ['tabular-nums'], includeFontPadding: false },
});
