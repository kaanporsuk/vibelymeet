/**
 * Canonical native Vibe Video / HLS player — expo-video only.
 * Use for record preview, fullscreen HLS, and any other vibe-video playback surface.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { resolveVibeVideoStreamHostnameSync } from '@/lib/vibeVideoPlaybackUrl';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';

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
  style,
}: VibeVideoPlayerProps) {
  const warnedRef = useRef(false);
  const [showPoster, setShowPoster] = useState(!!posterUri);
  const isRemoteHls = sourceUri.startsWith('https://') || sourceUri.startsWith('http://');

  const player = useVideoPlayer(sourceUri, (p) => {
    p.loop = loop;
  });

  useEffect(() => {
    const { hostname, source } = resolveVibeVideoStreamHostnameSync();
    vibeVideoDiagVerbose('player.source_set', {
      context: diagContext,
      sourceUri,
      isRemoteHls,
      resolvedHostname: hostname,
      hostnameSource: source,
    });
  }, [diagContext, sourceUri, isRemoteHls]);

  useEffect(() => {
    warnedRef.current = false;
  }, [sourceUri]);

  useEffect(() => {
    setShowPoster(!!posterUri);
  }, [sourceUri, posterUri]);

  useEffect(() => {
    vibeVideoDiagVerbose('player.load_start', {
      context: diagContext,
      sourceUri,
    });
    player.replace(sourceUri);
  }, [sourceUri, player]);

  useEffect(() => {
    if (playing) {
      void player.play();
    } else {
      player.pause();
    }
  }, [playing, player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      const st = payload.status;
      vibeVideoDiagVerbose('player.status_change', {
        context: diagContext,
        sourceUri,
        status: st,
      });
      if (st === 'readyToPlay') {
        vibeVideoDiagVerbose('player.ready', {
          context: diagContext,
          sourceUri,
        });
      }
      if (st !== 'error') return;
      if (warnedRef.current) return;
      warnedRef.current = true;

      const { hostname, source: hostSource } = resolveVibeVideoStreamHostnameSync();
      const urlKind = !sourceUri?.trim()
        ? 'empty'
        : !isRemoteHls
          ? 'local_file'
          : !sourceUri.includes('.m3u8')
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

      onPlayerFatalError?.();
    });
    return () => sub.remove();
  }, [player, sourceUri, isRemoteHls, diagContext, onPlayerFatalError]);

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
