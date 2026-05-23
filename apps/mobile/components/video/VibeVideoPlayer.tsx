/**
 * Canonical native Vibe Video / HLS player — expo-video only.
 * Use for record preview, fullscreen HLS, and any other vibe-video playback surface.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
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
import { isHlsMediaAssetUrl, isProfileVibeVideoRef, prewarmMediaAssets } from '@/lib/mediaAssetResolver';
import { trackEvent } from '@/lib/analytics';
import { MediaPlaceholder } from '@/components/media/MediaPlaceholder';
import { captionTextFromMediaCaptions, type MediaCaptions } from '../../../../shared/media/captions';

export type VibeVideoPlayerProps = {
  sourceUri: string;
  posterUri?: string | null;
  loop?: boolean;
  /** When false, playback is paused (e.g. modal hidden). */
  playing?: boolean;
  muted?: boolean;
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

const MAX_HLS_AUTH_REFRESH_ATTEMPTS = 2;

export function VibeVideoPlayer({
  sourceUri,
  posterUri,
  loop = true,
  playing = true,
  muted = false,
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
  const authRefreshAttemptsRef = useRef(0);
  const authRefreshInFlightRef = useRef(false);
  const { reduceMotion, resolved: reduceMotionResolved } = useReduceMotionState();
  const [manualPlaybackRequested, setManualPlaybackRequested] = useState(false);
  const usesSignedProfileRef = isProfileVibeVideoRef(sourceUri);
  const {
    url: mediaAssetUrl,
    posterUrl: mediaAssetPosterUrl,
    placeholderKind,
    placeholderHash,
    dominantColor,
    status: mediaAssetStatus,
    refresh: refreshMediaAsset,
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
    muted,
  });

  useEffect(() => {
    if (!reduceMotionResolved || reduceMotion || !sourceUri) return;
    if (!usesSignedProfileRef && !isHlsMediaAssetUrl(sourceUri)) return;
    void prewarmMediaAssets(
      [{
        kind: usesSignedProfileRef ? 'profile_vibe_video' : 'video',
        sourceRef: sourceUri,
      }],
      { concurrency: 1 },
    ).catch(() => {});
  }, [reduceMotion, reduceMotionResolved, sourceUri, usesSignedProfileRef]);

  const player = useVideoPlayer(playerSource, (p) => {
    p.loop = loop;
    p.muted = muted;
  });

  useEffect(() => {
    const result = safeExpoSharedObjectCall(() => {
      player.muted = muted;
    }, {
      label: 'vibeVideo.player.muted',
      swallowAll: true,
    });
    attachSafeExpoSharedObjectPromise(result, undefined, 'vibeVideo.player.muted');
  }, [muted, player]);

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
    authRefreshAttemptsRef.current = 0;
    authRefreshInFlightRef.current = false;
    setManualPlaybackRequested(false);
  }, [sourceUri]);

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

  const refreshPlaybackAfterAuthError = useCallback(async (): Promise<boolean> => {
    if (!usesSignedProfileRef) return false;
    if (authRefreshInFlightRef.current) return true;
    if (authRefreshAttemptsRef.current >= MAX_HLS_AUTH_REFRESH_ATTEMPTS) return false;
    authRefreshAttemptsRef.current += 1;
    authRefreshInFlightRef.current = true;
    const attempt = authRefreshAttemptsRef.current;
    try {
      const freshUri = await refreshMediaAsset('playback', { bypassFailureCooldown: true });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
        source: diagContext,
        attempt,
        outcome: freshUri ? 'refreshed' : 'unavailable',
      });
      if (!freshUri) return false;
      const replaceResult = safeExpoSharedObjectCall(() => player.replace(freshUri), {
        label: 'vibeVideo.player.replace.authRefresh',
        swallowAll: true,
      });
      attachSafeExpoSharedObjectPromise(replaceResult, undefined, 'vibeVideo.player.replace.authRefresh');
      if (effectivePlaying) {
        const playResult = safeExpoSharedObjectCall(() => player.play(), {
          label: 'vibeVideo.player.play.authRefresh',
          swallowAll: true,
        });
        attachSafeExpoSharedObjectPromise(playResult, undefined, 'vibeVideo.player.play.authRefresh');
      }
      return true;
    } catch {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
        source: diagContext,
        attempt,
        outcome: 'failed',
      });
      return false;
    } finally {
      authRefreshInFlightRef.current = false;
    }
  }, [diagContext, effectivePlaying, player, refreshMediaAsset, usesSignedProfileRef]);

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

        const reportFatalPlaybackError = () => {
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
        };

        if (
          usesSignedProfileRef &&
          (authRefreshInFlightRef.current || authRefreshAttemptsRef.current < MAX_HLS_AUTH_REFRESH_ATTEMPTS)
        ) {
          void refreshPlaybackAfterAuthError()
            .then((didRefresh) => {
              if (!didRefresh) reportFatalPlaybackError();
            })
            .catch(reportFatalPlaybackError);
          return;
        }
        reportFatalPlaybackError();
      }),
      {
        label: 'vibeVideo.player.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeVideo.player.statusListener.remove');
  }, [
    player,
    playbackSourceUri,
    isRemoteHls,
    diagContext,
    onPlayerFatalError,
    qoe,
    refreshPlaybackAfterAuthError,
    shouldAttachPlayback,
    usesSignedProfileRef,
  ]);

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
      <MediaPlaceholder
        kind={placeholderKind}
        hash={placeholderHash}
        dominantColor={dominantColor}
        style={styles.placeholderZ}
      />
      {showPoster && effectivePosterUri ? (
        <ExpoImage
          source={{ uri: effectivePosterUri }}
          style={[StyleSheet.absoluteFill, styles.posterZ]}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          priority="high"
          transition={0}
        />
      ) : null}
      <VideoView
        style={[
          StyleSheet.absoluteFill,
          styles.videoZ,
          style,
          showPoster && effectivePosterUri ? styles.videoWaitingForFirstFrame : null,
        ]}
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
  placeholderZ: { zIndex: 0 },
  posterZ: { zIndex: 1 },
  videoZ: { zIndex: 2 },
  videoWaitingForFirstFrame: { opacity: 0 },
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
