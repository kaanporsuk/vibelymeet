import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { trackEvent } from '@/lib/analytics';
import { isMediaPlaybackQoeDegraded, recordMediaPlaybackRebuffer } from '@/lib/mediaPlaybackSessionPolicy';

type NativeMediaPlaybackQoEOptions = {
  family: string;
  surface: string;
  provider?: string | null;
  sourceRef?: string | null;
  messageId?: string | null;
  muted?: boolean;
  autoplay?: boolean;
};

function telemetrySafeSourceRef(value: string | null): string {
  if (!value) return 'none';
  if (/^https?:\/\//i.test(value)) return 'remote_url';
  if (/^(file:|content:|assets-library:|ph:|data:)/i.test(value)) return 'local_media';
  if (value.startsWith('bunny_stream:')) return 'bunny_stream_ref';
  if (value.startsWith('bunny_storage:')) return 'bunny_storage_ref';
  if (value.startsWith('profile_vibe_video:')) return 'profile_vibe_video_ref';
  return 'opaque_ref';
}

export function useNativeMediaPlaybackQoE({
  family,
  surface,
  provider = null,
  sourceRef = null,
  messageId = null,
  muted = false,
  autoplay = false,
}: NativeMediaPlaybackQoEOptions) {
  const loadStartedAtMsRef = useRef<number | null>(null);
  const startupMsRef = useRef<number | null>(null);
  const rebufferCountRef = useRef(0);
  const sawReadyRef = useRef(false);
  const bufferingRef = useRef(false);
  const emittedRef = useRef(false);

  const emit = useCallback((reason: 'ended' | 'error' | 'unmount') => {
    if (emittedRef.current && reason !== 'error') return;
    emittedRef.current = true;
    trackEvent('media_playback_qoe', {
      family,
      surface,
      provider: provider ?? 'unknown',
      source_ref: telemetrySafeSourceRef(sourceRef),
      message_id: messageId ?? 'none',
      reason,
      startup_ms: startupMsRef.current ?? -1,
      rebuffer_count: rebufferCountRef.current,
      bitrate_switch_count: -1,
      muted,
      autoplay,
      device_class: `native_${Platform.OS}`,
      qoe_degraded: isMediaPlaybackQoeDegraded(),
      platform_player: 'expo-video',
    });
  }, [autoplay, family, messageId, muted, provider, sourceRef, surface]);

  useEffect(() => {
    loadStartedAtMsRef.current = Date.now();
    startupMsRef.current = null;
    rebufferCountRef.current = 0;
    sawReadyRef.current = false;
    bufferingRef.current = false;
    emittedRef.current = false;
    return () => {
      emit('unmount');
    };
  }, [emit, sourceRef]);

  return useMemo(() => ({
    markReady() {
      if (loadStartedAtMsRef.current !== null && startupMsRef.current === null) {
        startupMsRef.current = Math.max(0, Date.now() - loadStartedAtMsRef.current);
      }
      sawReadyRef.current = true;
      bufferingRef.current = false;
    },
    markBuffering() {
      if (!sawReadyRef.current || bufferingRef.current) return;
      bufferingRef.current = true;
      rebufferCountRef.current += 1;
      const degraded = recordMediaPlaybackRebuffer();
      trackEvent('media_playback_qoe_rebuffer', {
        family,
        surface,
        provider: provider ?? 'unknown',
        message_id: messageId ?? 'none',
        rebuffer_count: rebufferCountRef.current,
        qoe_degraded: degraded,
        platform_player: 'expo-video',
      });
    },
    markEnded() {
      emit('ended');
    },
    markError() {
      emit('error');
    },
  }), [emit, family, messageId, provider, surface]);
}
