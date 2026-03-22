/**
 * Full-window vibe video — parity with web fullscreen HLS player on ProfileStudio.
 * Uses expo-video (VideoView + useVideoPlayer).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  Image,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

const CAPTION_MAX_WIDTH = 400;

const BUNNY_HOST = (process.env.EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME ?? '').replace(/^["']|["']$/g, '').trim();

export interface FullscreenVibeVideoModalProps {
  visible: boolean;
  onClose: () => void;
  /** Local file:// or remote https HLS (.m3u8) — must match web URL shape */
  playbackUrl: string | null;
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
  vibeCaption = '',
  posterUrl,
}: FullscreenVibeVideoModalProps) {
  const insets = useSafeAreaInsets();

  const configMissing = !BUNNY_HOST;
  const showError = visible && !playbackUrl;

  const handlePlaybackIssue = () => {
    if (__DEV__) console.warn('[FullscreenVibeVideo] playback error');
  };

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
        {showError ? (
          <View style={styles.errorWrap}>
            <Ionicons name="warning-outline" size={40} color="#fbbf24" />
            <Text style={styles.errorTitle}>Video unavailable</Text>
            <Text style={styles.errorBody}>
              {configMissing
                ? 'Set EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME to the same value as web VITE_BUNNY_STREAM_CDN_HOSTNAME (see apps/mobile/.env.example).'
                : 'Playback URL could not be built, or the video is still processing. Pull to refresh on Profile and try again.'}
            </Text>
            <Pressable onPress={onClose} style={styles.errorClose}>
              <Text style={styles.errorCloseText}>Close</Text>
            </Pressable>
          </View>
        ) : playbackUrl ? (
          <>
            <HlsVideoBody
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
        ) : null}

        {vibeCaption.trim() && !showError ? (
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
