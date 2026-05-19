/**
 * Canonical native Vibe Video / HLS player — expo-video only.
 * Use for record preview, fullscreen HLS, and any other vibe-video playback surface.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { resolveVibeVideoStreamHostnameSync } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from '@/lib/vibeVideoTelemetry';
import {
  attachSafeExpoSharedObjectPromise,
  safeExpoSharedObjectCall,
  safeRemoveExpoSharedObjectSubscription,
} from '@/lib/expoSharedObjectSafe';
import { useMediaAsset } from '@/hooks/useMediaAsset';

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
  style,
}: VibeVideoPlayerProps) {
  const warnedRef = useRef(false);
  const playbackAttemptedRef = useRef(false);
  const playbackSucceededRef = useRef(false);
  const { url: mediaAssetUrl } = useMediaAsset({
    kind: 'vibe_video',
    sourceRef: sourceUri,
    initialUrl: sourceUri,
    autoResolve: false,
  });
  const playbackSourceUri = mediaAssetUrl ?? sourceUri;
  const [showPoster, setShowPoster] = useState(!!posterUri);
  const isRemoteHls = playbackSourceUri.startsWith('https://') || playbackSourceUri.startsWith('http://');

  const player = useVideoPlayer(playbackSourceUri, (p) => {
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
  }, [playbackSourceUri]);

  useEffect(() => {
    setShowPoster(!!posterUri);
  }, [playbackSourceUri, posterUri]);

  useEffect(() => {
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
  }, [playbackSourceUri, player, diagContext, isRemoteHls]);

  useEffect(() => {
    const label = playing ? 'vibeVideo.player.play' : 'vibeVideo.player.pause';
    if (playing) {
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
  }, [playing, player]);

  useEffect(() => {
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('statusChange', (payload) => {
        const st = payload.status;
        vibeVideoDiagVerbose('player.status_change', {
          context: diagContext,
          status: st,
        });
        if (st === 'readyToPlay') {
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

        onPlayerFatalError?.();
      }),
      {
        label: 'vibeVideo.player.statusListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeVideo.player.statusListener.remove');
  }, [player, playbackSourceUri, isRemoteHls, diagContext, onPlayerFatalError]);

  useEffect(() => {
    if (!onPlayToEnd) return;
    const sub = safeExpoSharedObjectCall(
      () => player.addListener('playToEnd', () => {
        onPlayToEnd();
      }),
      {
        label: 'vibeVideo.player.playToEndListener',
        fallback: null,
        swallowAll: true,
      },
    );
    return () => safeRemoveExpoSharedObjectSubscription(sub, 'vibeVideo.player.playToEndListener.remove');
  }, [player, onPlayToEnd]);

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
      {showPoster && posterUri ? (
        <Image
          source={{ uri: posterUri }}
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
    </>
  );
}

const styles = StyleSheet.create({
  posterZ: { zIndex: 0 },
  videoZ: { zIndex: 1 },
});

export default VibeVideoPlayer;
