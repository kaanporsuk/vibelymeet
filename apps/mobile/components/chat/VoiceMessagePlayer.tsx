import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, type AudioStatus } from 'expo-audio';
import Colors from '@/constants/Colors';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeExpoSharedObjectRead,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';
import { useMediaAsset } from '@/hooks/useMediaAsset';
import { ensureVoicePlaybackAudioMode } from '@/lib/safeAudioMode';
import { endVoicePlayback, startVoicePlayback } from '@/lib/voicePlaybackCoordinator';
import { waveformHeightsFromSeed } from '../../../../shared/chat/voiceWaveformSeed';

export function formatVoiceDurationClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type VoiceMessagePlayerProps = {
  uri: string;
  sourceRef?: string | null;
  messageId?: string | null;
  durationSeconds?: number | null;
  isMine: boolean;
  theme: (typeof Colors)['light'];
  footer: ReactNode;
  /** Merged with base wrap (width constraints from parent). */
  wrapStyle?: StyleProp<ViewStyle>;
};

type SafeAudioStatus = Partial<AudioStatus> & { error?: unknown };

const EMPTY_AUDIO_STATUS: SafeAudioStatus = {
  currentTime: 0,
  duration: 0,
  playing: false,
  isBuffering: false,
};

function readAudioPlayerStatusSafely(player: unknown): SafeAudioStatus {
  return safeExpoSharedObjectRead(
    () => {
      const currentStatus = (player as { currentStatus?: AudioStatus | null }).currentStatus;
      return currentStatus ?? EMPTY_AUDIO_STATUS;
    },
    EMPTY_AUDIO_STATUS,
    'voice.player.currentStatus',
  );
}

/**
 * Voice bubble player: idle state never shows misleading 0:00 as “elapsed”; uses DB duration when known.
 */
export function VoiceMessagePlayer({
  uri,
  sourceRef,
  messageId,
  durationSeconds,
  isMine,
  theme,
  footer,
  wrapStyle,
}: VoiceMessagePlayerProps) {
  const { url: mediaAssetUrl, refresh: refreshMediaAsset } = useMediaAsset({
    kind: 'voice',
    messageId,
    sourceRef,
    initialUrl: uri,
    autoResolve: false,
  });
  const [playableUri, setPlayableUri] = useState(mediaAssetUrl ?? uri);
  const [refreshing, setRefreshing] = useState(false);
  const refreshAttemptedForUriRef = useRef<string | null>(null);
  const pendingPlayAfterRefreshRef = useRef(false);
  const player = useAudioPlayer(playableUri);
  const [status, setStatus] = useState<SafeAudioStatus>(() => readAudioPlayerStatusSafely(player));
  const [hasError, setHasError] = useState(false);
  const playing = status.playing === true;
  const positionRaw = status.currentTime ?? 0;
  const fromDb = durationSeconds != null && durationSeconds > 0 ? durationSeconds : 0;
  const fromPlayer = status.duration != null && status.duration > 0 ? status.duration : 0;
  const totalDuration = fromDb > 0 ? fromDb : fromPlayer;

  const position =
    totalDuration > 0 ? Math.min(Math.max(0, positionRaw), totalDuration) : Math.max(0, positionRaw);
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, position / totalDuration)) : 0;

  const barCount = 22;
  const waveform = useMemo(
    () => waveformHeightsFromSeed(`${sourceRef ?? playableUri}|${fromDb || fromPlayer}`, barCount),
    [sourceRef, playableUri, fromDb, fromPlayer],
  );
  const playheadIdx =
    totalDuration > 0 ? Math.min(barCount - 1, Math.floor(progress * barCount)) : -1;

  const fg = isMine ? 'rgba(255,255,255,0.95)' : theme.text;
  const track = isMine ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
  const fill = isMine ? 'rgba(255,255,255,0.95)' : theme.tint;
  const sub = isMine ? 'rgba(255,255,255,0.75)' : theme.textSecondary;
  const statusError = (status as { error?: unknown }).error;

  useEffect(() => {
    setStatus(readAudioPlayerStatusSafely(player));
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('playbackStatusUpdate', (nextStatus) => {
        setStatus(nextStatus);
      }),
      {
        label: 'voice.player.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'voice.player.statusListener.remove');
  }, [player]);

  useEffect(
    () => () => {
      safeExpoSharedObjectCall(() => player.pause(), {
        label: 'voice.player.pause.unmount',
        swallowAll: true,
      });
    },
    [player],
  );

  // One-voice-at-a-time: when this player is the active one, the coordinator pauses any
  // other voice message that was playing.
  const instanceId = useId();
  const pauseSelf = useCallback(() => {
    safeExpoSharedObjectCall(() => player.pause(), {
      label: 'voice.player.pause.coordinator',
      swallowAll: true,
    });
  }, [player]);

  useEffect(() => {
    if (playing) {
      startVoicePlayback({ id: instanceId, pause: pauseSelf });
    } else {
      endVoicePlayback(instanceId);
    }
  }, [playing, instanceId, pauseSelf]);

  useEffect(() => () => endVoicePlayback(instanceId), [instanceId]);

  useEffect(() => {
    setPlayableUri(mediaAssetUrl ?? uri);
    setHasError(false);
    refreshAttemptedForUriRef.current = null;
  }, [mediaAssetUrl, uri]);

  const refreshUri = useCallback(async (): Promise<string | null> => {
    if (!messageId || !sourceRef) return null;
    setRefreshing(true);
    try {
      const fresh = await refreshMediaAsset('playback');
      if (fresh) {
        setPlayableUri(fresh);
        return fresh;
      }
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [messageId, refreshMediaAsset, sourceRef]);

  const playCurrent = useCallback((): boolean => {
    const didCall = safeExpoSharedObjectCall(
      () => {
        const result = (player.play as () => unknown)();
        attachSafeExpoSharedObjectPromise(result, () => setHasError(true), 'voice.player.play.async');
        return true;
      },
      {
        label: 'voice.player.play',
        fallback: false,
        swallowAll: true,
      },
    );
    if (didCall !== true) {
      setHasError(true);
      return false;
    }
    return true;
  }, [player]);

  const refreshAndQueuePlay = useCallback(async (): Promise<boolean> => {
    setHasError(false);
    pendingPlayAfterRefreshRef.current = true;
    const fresh = await refreshUri();
    if (!fresh) {
      pendingPlayAfterRefreshRef.current = false;
      setHasError(true);
      return false;
    }
    if (fresh === playableUri) {
      pendingPlayAfterRefreshRef.current = false;
      return playCurrent();
    }
    refreshAttemptedForUriRef.current = playableUri;
    return true;
  }, [playCurrent, playableUri, refreshUri]);

  useEffect(() => {
    if (!statusError) return;
    if (messageId && sourceRef && refreshAttemptedForUriRef.current !== playableUri) {
      void refreshUri()
        .then((fresh) => {
          if (!fresh || fresh === playableUri) {
            setHasError(true);
            return;
          }
          refreshAttemptedForUriRef.current = playableUri;
        })
        .catch(() => setHasError(true));
      return;
    }
    setHasError(true);
  }, [messageId, playableUri, refreshUri, sourceRef, statusError]);

  useEffect(() => {
    if (!pendingPlayAfterRefreshRef.current) return;
    pendingPlayAfterRefreshRef.current = false;
    playCurrent();
  }, [playCurrent, playableUri]);

  const toggle = async () => {
    const shouldAttemptRefresh = !playing && !hasError && messageId && sourceRef && refreshAttemptedForUriRef.current !== playableUri;

    // Before any playback, force the iOS audio session into a playback-audible mode:
    // playsInSilentMode (so the ring/silent switch doesn't mute) and allowsRecording=false
    // (so output isn't stuck on the earpiece after a prior recording).
    if (!playing) {
      await ensureVoicePlaybackAudioMode();
    }

    const didCall = safeExpoSharedObjectCall(
      () => {
        if (playing) {
          const result = player.pause();
          attachSafeExpoSharedObjectPromise(result, () => setHasError(true), 'voice.player.pause.async');
          return true;
        } else if (hasError) {
          void refreshAndQueuePlay().catch(() => setHasError(true));
          return true;
        }

        setHasError(false);
        const result = player.play();
        attachSafeExpoSharedObjectPromise(
          result,
          () => {
            if (shouldAttemptRefresh) {
              void refreshAndQueuePlay().catch(() => setHasError(true));
              return;
            }
            setHasError(true);
          },
          'voice.player.play.async',
        );
        return true;
      },
      {
        label: playing ? 'voice.player.pause' : 'voice.player.play',
        fallback: false,
        swallowAll: true,
      },
    );
    if (didCall !== true) {
      setHasError(true);
    }
  };

  const rightTimeLabel = (() => {
    if (hasError) return 'Tap to retry';
    if (refreshing) return 'Refreshing...';
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
