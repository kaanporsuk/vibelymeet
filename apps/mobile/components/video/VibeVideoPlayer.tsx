/**
 * Canonical native Vibe Video / HLS player — expo-video only.
 * Use for record preview, fullscreen HLS, and any other vibe-video playback surface.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import { resolveVibeVideoStreamHostnameSync } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from '@/lib/vibeVideoTelemetry';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';
import { useMediaAsset } from '@/hooks/useMediaAsset';
import { useNativeMediaPlaybackQoE } from '@/hooks/useNativeMediaPlaybackQoE';
import { useReduceMotionState } from '@/hooks/useReduceMotion';
import { isProfileVibeVideoRef } from '@/lib/mediaAssetResolver';
import { trackEvent } from '@/lib/analytics';
import { captionTextFromMediaCaptions, type MediaCaptions } from '../../../../shared/media/captions';

export type VibeVideoPlayerProps = {
  sourceUri: string;
  posterUri?: string | null;
  loop?: boolean;
  /** When false, playback is paused (e.g. modal hidden). */
  playing?: boolean;
  nativeControls?: boolean;
  contentFit?: 'contain' | 'cover';
  /**
   * Short label for logs, e.g. `fullscreen`, `record-preview`.
   * Helps correlate invalid URL vs CDN vs player errors.
   */
  diagContext: string;
  onPlayerFatalError?: () => void;
  /** Fires when the current source plays through to its end (expo-video `playToEnd`). Not pause/seek/buffer. */
  onPlayToEnd?: () => void;
  captions?: MediaCaptions | null;
  style?: StyleProp<ViewStyle>;
};

export function VibeVideoPlayer({
  sourceUri,
  posterUri,
  loop = true,
  playing = true,
  nativeControls = true,
  contentFit = 'contain',
  diagContext,
  onPlayerFatalError,
  onPlayToEnd,
  captions,
  style,
}: VibeVideoPlayerProps) {
  const warnedRef = useRef(false);
  const playbackAttemptedRef = useRef(false);
  const playbackSucceededRef = useRef(false);
  const signedResolveFailureReportedRef = useRef(false);
  const { reduceMotion, resolved: reduceMotionResolved } = useReduceMotionState();
  const [manualPlaybackRequested, setManualPlaybackRequested] = useState(false);
  const usesSignedProfileRef = isProfileVibeVideoRef(sourceUri);
  const {
    url: mediaAssetUrl,
    posterUrl: mediaAssetPosterUrl,
    status: mediaAssetStatus,
  } = useMediaAsset({
    kind: usesSignedProfileRef ? 'profile_vibe_video' : 'vibe_video',
    sourceRef: sourceUri,
    initialUrl: usesSignedProfileRef ? null : sourceUri,
    autoResolve: usesSignedProfileRef,
  });
  const playbackSourceUri = mediaAssetUrl ?? (usesSignedProfileRef ? '' : sourceUri);
  const effectivePosterUri = mediaAssetPosterUrl ?? posterUri ?? null;
  const [showPoster, setShowPoster] = useState(!!posterUri);
  const [showCaptions, setShowCaptions] = useState(true);
  const captionText = useMemo(() => captionTextFromMediaCaptions(captions), [captions]);
  const isRemoteHls = playbackSourceUri.startsWith('https://') || playbackSourceUri.startsWith('http://');
  const shouldAttachPlayback = Boolean(playbackSourceUri) &&
    playing &&
    reduceMotionResolved &&
    (!reduceMotion || manualPlaybackRequested);
  const effectivePlaying = shouldAttachPlayback;
  const playerSource = useMemo<VideoSource>(() => (shouldAttachPlayback ? playbackSourceUri : null), [
    playbackSourceUri,
    shouldAttachPlayback,
  ]);
  const qoe = useNativeMediaPlaybackQoE({
    enabled: shouldAttachPlayback,
    family: usesSignedProfileRef ? 'profile_vibe_video' : 'vibe_video',
    surface: diagContext,
    provider: usesSignedProfileRef ? 'bunny_stream' : 'remote',
    sourceRef: playbackSourceUri || sourceUri,
    autoplay: effectivePlaying,
    muted: false,
  });

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = loop;
  });

  useEffect(() => {
    const { hostname, source } = resolveVibeVideoStreamHostnameSync();
    vibeVideoDiagVerbose('player.source_set', {
      context: diagContext,
      isRemoteHls,
      resolvedHostname: hostname,
      hostnameSource: source,
      hasSourceUri: !!sourceUri,
    });
  }, [diagContext, sourceUri, isRemoteHls]);

  useEffect(() => {
    warnedRef.current = false;
    playbackAttemptedRef.current = false;
    playbackSucceededRef.current = false;
    signedResolveFailureReportedRef.current = false;
    setManualPlaybackRequested(false);
  }, [playbackSourceUri]);

  useEffect(() => {
    if (usesSignedProfileRef && mediaAssetStatus === 'error' && !signedResolveFailureReportedRef.current) {
      signedResolveFailureReportedRef.current = true;
      onPlayerFatalError?.();
    }
  }, [mediaAssetStatus, onPlayerFatalError, usesSignedProfileRef]);

  useEffect(() => {
    setShowPoster(!!effectivePosterUri);
  }, [playbackSourceUri, effectivePosterUri]);

  useEffect(() => {
    if (!shouldAttachPlayback || !playbackSourceUri) return;
    vibeVideoDiagVerbose('player.load_start', {
      context: diagContext,
      isRemoteHls,
      hasSourceUri: !!playbackSourceUri,
    });
    if (!playbackAttemptedRef.current) {
      playbackAttemptedRef.current = true;
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackAttempted, {
        source: diagContext,
        remote_hls: isRemoteHls,
      });
    }
    const result = safeExpoSharedObjectCall(() => player.replace(playbackSourceUri), {
      label: 'vibeVideo.player.replace',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeVideo.player.replace');
  }, [playbackSourceUri, player, diagContext, isRemoteHls, shouldAttachPlayback]);

  useEffect(() => {
    if (!shouldAttachPlayback || !playbackSourceUri) return;
    const label = effectivePlaying ? 'vibeVideo.player.play' : 'vibeVideo.player.pause';
    if (effectivePlaying) {
      const result = safeExpoSharedObjectCall(() => player.play(), {
        label,
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(result, undefined, label);
    } else {
      const result = safeExpoSharedObjectCall(() => player.pause(), {
        label,
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(result, undefined, label);
    }
  }, [effectivePlaying, playbackSourceUri, player, shouldAttachPlayback]);

  useEffect(() => {
    if (shouldAttachPlayback) return;
    const result = safeExpoSharedObjectCall(() => player.pause(), {
      label: 'vibeVideo.player.pause.detached',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeVideo.player.pause.detached');
  }, [player, shouldAttachPlayback]);

  useEffect(() => {
    if (!shouldAttachPlayback) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        const st = payload.status;
        vibeVideoDiagVerbose('player.status_change', {
          context: diagContext,
          status: st,
        });
        if (st === 'readyToPlay') {
          qoe.markReady();
          vibeVideoDiagVerbose('player.ready', {
            context: diagContext,
            isRemoteHls,
          });
          if (!playbackSucceededRef.current) {
            playbackSucceededRef.current = true;
            trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackSucceeded, {
              source: diagContext,
              remote_hls: isRemoteHls,
            });
          }
        }
        if (st === 'loading') {
          qoe.markBuffering();
        }
        if (st !== 'error') return;
        if (warnedRef.current) return;
        warnedRef.current = true;

        const { hostname, source: hostSource } = resolveVibeVideoStreamHostnameSync();
        const urlKind = !playbackSourceUri?.trim()
          ? 'empty'
          : !isRemoteHls
            ? 'local_file'
            : !playbackSourceUri.includes('.m3u8')
              ? 'remote_non_hls'
              : 'remote_hls';

        vibeVideoDiagVerbose('player.status_error', {
          context: diagContext,
          urlKind,
          streamHostnameSource: hostSource,
          streamHostnameSet: !!hostname,
          status: st,
          // expo-video may attach error details on the player in some versions
          nativeError: typeof (payload as { error?: string }).error === 'string'
            ? (payload as { error?: string }).error
            : undefined,
        });
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackFailed, {
          source: diagContext,
          kind: urlKind,
          stream_hostname_source: hostSource,
        });
        qoe.markError();

        onPlayerFatalError?.();
      }),
      {
        label: 'vibeVideo.player.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeVideo.player.statusListener.remove');
  }, [player, playbackSourceUri, isRemoteHls, diagContext, onPlayerFatalError, qoe, shouldAttachPlayback]);

  useEffect(() => {
    if (!shouldAttachPlayback || !onPlayToEnd) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('playToEnd', () => {
        qoe.markEnded();
        onPlayToEnd();
      }),
      {
        label: 'vibeVideo.player.playToEndListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeVideo.player.playToEndListener.remove');
  }, [player, onPlayToEnd, qoe, shouldAttachPlayback]);

  useEffect(
    () => () => {
      const result = safeExpoSharedObjectCall(() => player.pause(), {
        label: 'vibeVideo.player.pause.unmount',
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(result, undefined, 'vibeVideo.player.pause.unmount');
    },
    [player],
  );

  return (
    <>
      {showPoster && effectivePosterUri ? (
        <Image
          source={{ uri: effectivePosterUri }}
          style={[StyleSheet.absoluteFill, styles.posterZ]}
          resizeMode="cover"
        />
      ) : null}
      <VideoView
        style={[StyleSheet.absoluteFill, styles.videoZ, style]}
        player={player}
        nativeControls={nativeControls}
        contentFit={contentFit}
        onFirstFrameRender={() => setShowPoster(false)}
      />
      {playing && reduceMotionResolved && reduceMotion && !manualPlaybackRequested && playbackSourceUri ? (
        <Pressable
          style={styles.reduceMotionPlayOverlay}
          onPress={() => setManualPlaybackRequested(true)}
          accessibilityRole="button"
          accessibilityLabel="Play video"
        >
          <Text style={styles.reduceMotionPlayIcon}>Play</Text>
        </Pressable>
      ) : null}
      {captionText ? (
        <>
          {showCaptions ? (
            <View style={styles.captionOverlay} pointerEvents="none">
              <Text style={styles.captionText} numberOfLines={3}>{captionText}</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.captionToggle}
            onPress={() => {
              const next = !showCaptions;
              setShowCaptions(next);
              trackEvent('caption_toggle_changed', {
                surface: diagContext,
                platform: 'native',
                enabled: next,
                media_kind: usesSignedProfileRef ? 'profile_vibe_video' : 'vibe_video',
              });
            }}
            accessibilityRole="button"
            accessibilityLabel={showCaptions ? 'Hide captions' : 'Show captions'}
          >
            <Text style={styles.captionToggleText}>CC</Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  posterZ: { zIndex: 0 },
  videoZ: { zIndex: 1 },
  captionOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 54,
    zIndex: 4,
    alignItems: 'center',
  },
  captionText: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: 'center',
  },
  captionToggle: {
    position: 'absolute',
    right: 14,
    bottom: 12,
    zIndex: 5,
    minWidth: 42,
    minHeight: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  captionToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  reduceMotionPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  reduceMotionPlayIcon: {
    overflow: 'hidden',
    minWidth: 64,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 44,
    paddingHorizontal: 18,
    textAlign: 'center',
  },
});

export default VibeVideoPlayer;
