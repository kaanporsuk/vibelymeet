/**
 * Full-window vibe video — parity with web fullscreen HLS player on ProfileStudio.
 * Uses expo-av; `playsInSilentModeIOS` so audio works when the device is muted.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av';
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

export function FullscreenVibeVideoModal({
  visible,
  onClose,
  playbackUrl,
  vibeCaption = '',
  posterUrl,
}: FullscreenVibeVideoModalProps) {
  const insets = useSafeAreaInsets();
  const videoRef = useRef<Video | null>(null);

  const configureAudio = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {
      if (__DEV__) console.warn('[FullscreenVibeVideo] Audio.setAudioModeAsync', e);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void configureAudio();
  }, [visible, configureAudio]);

  useEffect(() => {
    if (!visible || !playbackUrl) return;
    const t = setTimeout(() => {
      videoRef.current?.playAsync?.().catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [visible, playbackUrl]);

  const configMissing = !BUNNY_HOST;
  const showError = visible && !playbackUrl;

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
        ) : (
          <>
            <Video
              key={playbackUrl ?? 'none'}
              ref={(r) => {
                videoRef.current = r;
              }}
              source={{ uri: playbackUrl! }}
              style={StyleSheet.absoluteFill}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              isLooping
              shouldPlay={visible}
              posterSource={posterUrl ? { uri: posterUrl } : undefined}
              usePoster={!!posterUrl}
              onError={(e) => {
                if (__DEV__) console.warn('[FullscreenVibeVideo] playback error', e);
              }}
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
        )}

        {vibeCaption.trim() && !showError ? (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={[styles.captionWrap, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
            pointerEvents="none"
          >
            <Text style={styles.captionKicker}>Vibing on</Text>
            <Text style={styles.captionBody} numberOfLines={3}>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorWrap: {
    flex: 1,
    padding: 28,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBody: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorClose: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  errorCloseText: {
    color: '#fff',
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    maxWidth: CAPTION_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
  },
  captionKicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#a78bfa',
    marginBottom: 4,
  },
  captionBody: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
});

export default FullscreenVibeVideoModal;
