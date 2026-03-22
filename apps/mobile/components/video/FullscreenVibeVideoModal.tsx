/**
 * Full-window vibe video — parity with web fullscreen HLS player on ProfileStudio.
 * Uses expo-video (VideoView + useVideoPlayer); expo-av Audio only for iOS silent-mode playback.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  Image,
} from 'react-native';
import { Audio } from 'expo-av';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { resolveVibeVideoStreamHostnameSync } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

const CAPTION_MAX_WIDTH = 400;

export interface FullscreenVibeVideoModalProps {
  visible: boolean;
  onClose: () => void;
  /** Local file:// or remote https HLS (.m3u8) — must match web URL shape */
  playbackUrl: string | null;
  /** Helps distinguish “still processing” vs CDN/config issues when URL is null */
  bunnyVideoUid?: string | null;
  vibeCaption?: string;
  /** Bunny thumbnail while the HLS buffer starts */
  posterUrl?: string | null;
}

function HlsVideoBody({
  playbackUrl,
  visible,
  posterUrl,
  onPlaybackIssue,
}: {
  playbackUrl: string;
  visible: boolean;
  posterUrl?: string | null;
  onPlaybackIssue: () => void;
}) {
  const warnedRef = useRef(false);
  const [showPoster, setShowPoster] = useState(!!posterUrl);
  const player = useVideoPlayer(playbackUrl, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    warnedRef.current = false;
  }, [playbackUrl, visible]);

  useEffect(() => {
    setShowPoster(!!posterUrl);
  }, [playbackUrl, posterUrl]);

  useEffect(() => {
    player.replace(playbackUrl);
  }, [playbackUrl, player]);

  useEffect(() => {
    if (visible) {
      void player.play();
    } else {
      player.pause();
    }
  }, [visible, player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error' && !warnedRef.current) {
        warnedRef.current = true;
        vibeVideoDiagVerbose('fullscreen.player_status_error', {
          hint: 'Often Bunny CDN hotlink/referrer, 403 manifest, or HLS not ready yet.',
        });
        onPlaybackIssue();
      }
    });
    return () => sub.remove();
  }, [player, onPlaybackIssue]);

  return (
    <>
      {showPoster && posterUrl ? (
        <Image source={{ uri: posterUrl }} style={[StyleSheet.absoluteFill, { zIndex: 0 }]} resizeMode="cover" />
      ) : null}
      <VideoView
        style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
        player={player}
        nativeControls
        contentFit="contain"
        onFirstFrameRender={() => setShowPoster(false)}
      />
    </>
  );
}

export function FullscreenVibeVideoModal({
  visible,
  onClose,
  playbackUrl,
  bunnyVideoUid,
  vibeCaption = '',
  posterUrl,
}: FullscreenVibeVideoModalProps) {
  const insets = useSafeAreaInsets();
  const [playbackSurfaceError, setPlaybackSurfaceError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const { source: hostnameSource } = resolveVibeVideoStreamHostnameSync();
  const configMissing = hostnameSource === 'none';
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';

  const errorKind: 'none' | 'config' | 'url' | 'playback' = (() => {
    if (!visible) return 'none';
    if (configMissing) return 'config';
    if (!playbackUrl) return uid ? 'url' : 'url';
    if (playbackSurfaceError) return 'playback';
    return 'none';
  })();

  useEffect(() => {
    setPlaybackSurfaceError(false);
    setRetryKey(0);
  }, [visible, playbackUrl]);

  useEffect(() => {
    if (!visible) return;

    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      interruptionModeAndroid: 2,
    });

    return () => {
      void Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        interruptionModeAndroid: 2,
      });
    };
  }, [visible]);

  const handlePlaybackIssue = useCallback(() => {
    setPlaybackSurfaceError(true);
  }, []);

  const handleRetryPlayback = useCallback(() => {
    setPlaybackSurfaceError(false);
    setRetryKey((k) => k + 1);
  }, []);

  const renderErrorCard = (title: string, body: string, showRetry?: boolean) => (
    <View style={styles.errorWrap}>
      <Ionicons name="alert-circle-outline" size={40} color="#fbbf24" />
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorBody}>{body}</Text>
      {showRetry ? (
        <Pressable onPress={handleRetryPlayback} style={styles.errorSecondary}>
          <Text style={styles.errorSecondaryText}>Try again</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onClose} style={styles.errorClose}>
        <Text style={styles.errorCloseText}>Close</Text>
      </Pressable>
    </View>
  );

  const configBody =
    'Set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME to match web (see apps/mobile/.env.example), or upload a video once so the app can cache the hostname from the server.';

  const urlBody = uid
    ? 'The video may still be processing, or the stream is not reachable from this device (CDN hotlink/referrer rules, 403/404). Pull to refresh on Profile.'
    : 'No video ID on your profile. Pull to refresh or record again.';

  const playbackBody =
    'Manifest or HLS failed to load. If this persists, check Bunny Stream/CDN settings (hotlink, token auth) or try again after refresh.';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden={visible} />
      <View style={styles.root}>
        {errorKind === 'config'
          ? renderErrorCard('Video unavailable', configBody, false)
          : errorKind === 'url'
            ? renderErrorCard('Video unavailable', urlBody, false)
            : errorKind === 'playback'
              ? renderErrorCard('Video unavailable', playbackBody, true)
              : playbackUrl
                ? (
                    <>
                      <HlsVideoBody
                        key={retryKey}
                        playbackUrl={playbackUrl}
                        visible={visible}
                        posterUrl={posterUrl}
                        onPlaybackIssue={handlePlaybackIssue}
                      />

                      <Pressable
                        onPress={onClose}
                        style={[styles.closeBtn, { top: insets.top + 12 }]}
                        hitSlop={12}
                        accessibilityLabel="Close video"
                      >
                        <Ionicons name="close" size={26} color="#fff" />
                      </Pressable>
                    </>
                  )
                : null}

        {vibeCaption.trim() && errorKind === 'none' && playbackUrl ? (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={[styles.captionWrap, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
            pointerEvents="none"
          >
            <Text style={styles.captionLabel}>VIBING ON</Text>
            <Text style={[styles.captionText, { maxWidth: CAPTION_MAX_WIDTH }]} numberOfLines={3}>
              {vibeCaption.trim()}
            </Text>
          </LinearGradient>
        ) : null}
      </View>
    </Modal>
  );
}

export default FullscreenVibeVideoModal;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorSecondary: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  errorSecondaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  errorClose: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  errorCloseText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 48,
  },
  captionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#22d3ee',
    marginBottom: 6,
  },
  captionText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
