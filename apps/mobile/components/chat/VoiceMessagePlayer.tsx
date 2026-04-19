import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Colors from '@/constants/Colors';
import { waveformHeightsFromSeed } from '../../../../shared/chat/voiceWaveformSeed';

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
  const [hasError, setHasError] = useState(false);
  const playing = status.playing;
  const positionRaw = status.currentTime ?? 0;
  const fromDb = durationSeconds != null && durationSeconds > 0 ? durationSeconds : 0;
  const fromPlayer = status.duration != null && status.duration > 0 ? status.duration : 0;
  const totalDuration = fromDb > 0 ? fromDb : fromPlayer;

  const position =
    totalDuration > 0 ? Math.min(Math.max(0, positionRaw), totalDuration) : Math.max(0, positionRaw);
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, position / totalDuration)) : 0;

  const barCount = 22;
  const waveform = useMemo(
    () => waveformHeightsFromSeed(`${uri}|${fromDb || fromPlayer}`, barCount),
    [uri, fromDb, fromPlayer],
  );
  const playheadIdx =
    totalDuration > 0 ? Math.min(barCount - 1, Math.floor(progress * barCount)) : -1;

  const fg = isMine ? 'rgba(255,255,255,0.95)' : theme.text;
  const track = isMine ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
  const fill = isMine ? 'rgba(255,255,255,0.95)' : theme.tint;
  const sub = isMine ? 'rgba(255,255,255,0.75)' : theme.textSecondary;
  const statusError = (status as { error?: unknown }).error;

  useEffect(() => {
    setHasError(false);
  }, [uri]);

  useEffect(() => {
    if (statusError) setHasError(true);
  }, [statusError]);

  const toggle = () => {
    try {
      let result: unknown;
      if (playing) {
        result = player.pause();
      } else {
        setHasError(false);
        result = player.play();
      }
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => setHasError(true));
      }
    } catch {
      setHasError(true);
    }
  };

  const rightTimeLabel = (() => {
    if (hasError) return 'Tap to retry';
    if (!playing) {
      if (totalDuration > 0) return formatVoiceDurationClock(totalDuration);
      return 'Voice message';
    }
    if (totalDuration > 0) return formatVoiceDurationClock(totalDuration);
    return '—';
  })();
  const leftElapsed =
    playing && totalDuration > 0 ? formatVoiceDurationClock(position) : null;

  return (
    <View style={[styles.wrap, wrapStyle]}>
      <Text
        style={[
          styles.voiceKicker,
          { color: isMine ? 'rgba(255,255,255,0.5)' : theme.textSecondary },
        ]}
        numberOfLines={1}
      >
        VOICE
      </Text>
      <Pressable
        onPress={toggle}
        style={[styles.row, hasError ? styles.rowError : null]}
        accessibilityRole="button"
        accessibilityLabel={
          hasError
            ? 'Retry voice message playback'
            : totalDuration > 0
            ? `${playing ? 'Pause' : 'Play'} voice message, ${formatVoiceDurationClock(totalDuration)}`
            : `${playing ? 'Pause' : 'Play'} voice message`
        }
      >
        <View
          style={[
            styles.playSide,
            isMine ? styles.playSideMine : styles.playSideThem,
            !isMine && { borderColor: 'rgba(236,72,153,0.35)', borderWidth: StyleSheet.hairlineWidth },
          ]}
        >
          <Ionicons name={hasError ? 'alert-circle-outline' : playing ? 'pause' : 'play'} size={20} color={fg} />
          {status.isBuffering && playing && !hasError ? (
            <ActivityIndicator size="small" color={fg} style={styles.bufferSpinner} />
          ) : null}
        </View>
        <View style={styles.mid}>
          <View style={[styles.waveRow, { backgroundColor: track, borderColor: isMine ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)' }]}>
            {waveform.map((h, i) => {
              const played = !hasError && playheadIdx >= 0 && i <= playheadIdx;
              const barH = 4 + h * 16;
              return (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      height: barH,
                      backgroundColor: played ? fill : isMine ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.14)',
                    },
                  ]}
                />
              );
            })}
          </View>
          <View style={styles.timeMetaRow}>
            <Text numberOfLines={1} style={[styles.elapsed, { color: fg }]}>
              {leftElapsed ?? ' '}
            </Text>
            <Text numberOfLines={1} style={[styles.timeRow, { color: sub }]}>
              {playing && totalDuration > 0 ? `· ${rightTimeLabel}` : rightTimeLabel}
            </Text>
          </View>
        </View>
      </Pressable>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 0, width: '100%' },
  voiceKicker: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
    opacity: 0.9,
  },
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  rowError: { opacity: 0.92 },
  playSide: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  playSideMine: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  playSideThem: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(236,72,153,0.12)',
  },
  bufferSpinner: { width: 16, height: 16 },
  mid: { flex: 1, minWidth: 0, marginLeft: 8 },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 24,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
    overflow: 'hidden',
  },
  waveBar: { width: 3, borderRadius: 1.5, minHeight: 4 },
  timeMetaRow: { marginTop: 4, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  elapsed: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false, minWidth: 36 },
  timeRow: { fontSize: 10, flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'], includeFontPadding: false },
});
