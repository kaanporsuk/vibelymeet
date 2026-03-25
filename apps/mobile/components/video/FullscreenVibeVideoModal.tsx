/**
 * Full-window vibe video — parity with web fullscreen HLS player on ProfileStudio.
 * Uses `VibeVideoPlayer` (expo-video). setSafeAudioMode is a no-op until native AV is linked.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { resolveVibeVideoStreamHostnameSync } from '@/lib/vibeVideoPlaybackUrl';
import { setSafeAudioMode } from '@/lib/safeAudioMode';
import VibeVideoPlayer from '@/components/video/VibeVideoPlayer';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

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
  /**
   * UI only: invoked when the player reaches a natural end (`playToEnd`).
   * Parent may persist “hide inline metadata” until the stream identity changes.
   */
  onPlayToEnd?: () => void;
}

export function FullscreenVibeVideoModal({
  visible,
  onClose,
  playbackUrl,
  bunnyVideoUid,
  vibeCaption = '',
  posterUrl,
  onPlayToEnd,
}: FullscreenVibeVideoModalProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const captionMaxWidth = Math.round(windowWidth * 0.75);
  const [playbackSurfaceError, setPlaybackSurfaceError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  /** Per fullscreen session: hide top metadata after first natural `playToEnd`; reset when modal/source/retry changes. */
  const [hasCompletedInitialPlayback, setHasCompletedInitialPlayback] = useState(false);

  const { hostname: streamHostname } = resolveVibeVideoStreamHostnameSync();
  const configMissing = !streamHostname.trim();
  const uid = typeof bunnyVideoUid === 'string' ? bunnyVideoUid.trim() : '';
  const expectedPatternUrl =
    uid && streamHostname ? `https://${streamHostname}/${uid}/playlist.m3u8` : null;

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
    setHasCompletedInitialPlayback(false);
  }, [visible, playbackUrl, retryKey]);

  const handlePlayToEnd = useCallback(() => {
    setHasCompletedInitialPlayback(true);
    onPlayToEnd?.();
  }, [onPlayToEnd]);

  useEffect(() => {
    if (!visible) return;

    void setSafeAudioMode({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    return () => {
      void setSafeAudioMode({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    };
  }, [visible]);

  const handlePlaybackIssue = useCallback(() => {
    vibeVideoDiagVerbose('fullscreen.playback_error', {
      bunnyVideoUid: uid || null,
      playbackUrl,
      resolvedHostname: streamHostname,
      errorKind: 'playback',
    });
    setPlaybackSurfaceError(true);
  }, [uid, playbackUrl, streamHostname]);

  const handleRetryPlayback = useCallback(() => {
    setPlaybackSurfaceError(false);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!visible) return;
    vibeVideoDiagVerbose('fullscreen.playback_input', {
      bunnyVideoUid: uid || null,
      resolvedHostname: streamHostname,
      playbackUrl,
      expectedPatternUrl,
      patternMatch: !!(playbackUrl && expectedPatternUrl && playbackUrl === expectedPatternUrl),
    });
    if (errorKind === 'none') return;
    vibeVideoDiagVerbose('fullscreen.error_surface', {
      bunnyVideoUid: uid || null,
      playbackUrl,
      resolvedHostname: streamHostname,
      errorKind,
      configMissing,
      expectedPatternUrl,
    });
  }, [visible, errorKind, uid, playbackUrl, streamHostname, configMissing, expectedPatternUrl]);

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

  const configTitle = 'Playback configuration missing';
  const configBody =
    'Set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME to match web (see apps/mobile/.env.example), or upload a video once so the app can cache the hostname from the server.';

  const urlTitle = uid ? 'Video not ready yet' : 'No video found';
  const urlBody = uid
    ? 'The video may still be processing, or the stream is not reachable from this device. Pull to refresh on Profile.'
    : 'No video ID on your profile. Pull to refresh or record again.';

  const playbackTitle = 'Playback failed';
  const playbackBody =
    'The video stream failed to load. If this persists, try again after pulling to refresh on Profile.';

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
          ? renderErrorCard(configTitle, configBody, false)
          : errorKind === 'url'
            ? renderErrorCard(urlTitle, urlBody, false)
            : errorKind === 'playback'
              ? renderErrorCard(playbackTitle, playbackBody, true)
              : playbackUrl
                ? (
                    <>
                      <VibeVideoPlayer
                        key={retryKey}
                        sourceUri={playbackUrl}
                        posterUri={posterUrl}
                        playing={visible}
                        diagContext="fullscreen"
                        nativeControls
                        contentFit="contain"
                        onPlayerFatalError={handlePlaybackIssue}
                        onPlayToEnd={handlePlayToEnd}
                      />

                      <Pressable
                        onPress={onClose}
                        style={[styles.closeBtn, { top: insets.top + 10 }]}
                        hitSlop={12}
                        accessibilityLabel="Close video"
                      >
                        <Ionicons name="close" size={26} color="#fff" />
                      </Pressable>

                      {vibeCaption.trim() ? (
                        <View style={styles.fullscreenMetaOverlay} pointerEvents="none">
                          <LinearGradient
                            colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.12)', 'transparent']}
                            locations={[0, 0.45, 1]}
                            style={styles.topScrim}
                            pointerEvents="none"
                          />
                          <View
                            style={[
                              styles.metaColumn,
                              { paddingTop: insets.top + 29, paddingHorizontal: 24 },
                            ]}
                            pointerEvents="none"
                          >
                            {!hasCompletedInitialPlayback ? (
                              <Text style={styles.captionLabel}>VIBING ON</Text>
                            ) : null}
                            <Text
                              style={[styles.captionText, { maxWidth: captionMaxWidth }]}
                              numberOfLines={2}
                            >
                              {vibeCaption.trim()}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </>
                  )
                : null}
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
  fullscreenMetaOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  metaColumn: {
    width: '100%',
    alignItems: 'center',
  },
  captionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    color: '#22d3ee',
    marginBottom: 6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  captionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  },
});
