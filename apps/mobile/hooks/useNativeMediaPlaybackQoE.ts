import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import {
  isMediaPlaybackQoeDegraded,
  mediaConnectionSnapshot,
  recordMediaPlaybackRebuffer,
  recordMediaPlaybackStartup,
} from '@/lib/mediaPlaybackSessionPolicy';
import { trackMediaTelemetryEvent } from '@/lib/mediaTelemetry';
import { MEDIA_PLAYBACK_QOE_EVENTS } from '@clientShared/media/mediaTelemetry';
import { telemetrySafeSourceRef } from '../../../shared/media/telemetry-safe-ref';

type NativeMediaPlaybackQoEOptions = {
  enabled?: boolean;
  family: string;
  surface: string;
  provider?: string | null;
  sourceRef?: string | null;
  messageId?: string | null;
  clientRequestId?: string | null;
  muted?: boolean;
  autoplay?: boolean;
};

export function useNativeMediaPlaybackQoE({
  enabled = true,
  family,
  surface,
  provider = null,
  sourceRef = null,
  messageId = null,
  clientRequestId = null,
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
    if (!enabled) return;
    if (emittedRef.current && reason !== 'error') return;
    emittedRef.current = true;
    const connection = mediaConnectionSnapshot();
    trackMediaTelemetryEvent(MEDIA_PLAYBACK_QOE_EVENTS.summary, {
      family,
      surface,
      provider: provider ?? 'unknown',
      source_ref: telemetrySafeSourceRef(sourceRef),
      message_present: Boolean(messageId),
      client_request_id: clientRequestId ?? 'none',
      reason,
      startup_ms: startupMsRef.current ?? -1,
      rebuffer_count: rebufferCountRef.current,
      bitrate_switch_count: -1,
      muted,
      autoplay,
      device_class: `native_${Platform.OS}`,
      connection_type: connection.connectionType,
      effective_type: connection.effectiveType,
      save_data: connection.saveData,
      qoe_degraded: isMediaPlaybackQoeDegraded(),
      platform_player: 'expo-video',
    });
  }, [autoplay, clientRequestId, enabled, family, messageId, muted, provider, sourceRef, surface]);

  useEffect(() => {
    if (!enabled) return;
    loadStartedAtMsRef.current = Date.now();
    startupMsRef.current = null;
    rebufferCountRef.current = 0;
    sawReadyRef.current = false;
    bufferingRef.current = false;
    emittedRef.current = false;
    return () => {
      emit('unmount');
    };
  }, [emit, enabled, sourceRef]);

  return useMemo(() => ({
    markReady() {
      if (!enabled) return;
      if (loadStartedAtMsRef.current !== null && startupMsRef.current === null) {
        startupMsRef.current = Math.max(0, Date.now() - loadStartedAtMsRef.current);
        recordMediaPlaybackStartup(startupMsRef.current);
      }
      sawReadyRef.current = true;
      bufferingRef.current = false;
    },
    markBuffering() {
      if (!enabled) return;
      if (!sawReadyRef.current || bufferingRef.current) return;
      bufferingRef.current = true;
      rebufferCountRef.current += 1;
      const degraded = recordMediaPlaybackRebuffer();
      const connection = mediaConnectionSnapshot();
      trackMediaTelemetryEvent(MEDIA_PLAYBACK_QOE_EVENTS.rebuffer, {
        family,
        surface,
        provider: provider ?? 'unknown',
        message_present: Boolean(messageId),
        client_request_id: clientRequestId ?? 'none',
        rebuffer_count: rebufferCountRef.current,
        connection_type: connection.connectionType,
        effective_type: connection.effectiveType,
        save_data: connection.saveData,
        qoe_degraded: degraded,
        platform_player: 'expo-video',
      });
    },
    markEnded() {
      if (!enabled) return;
      emit('ended');
    },
    markError() {
      if (!enabled) return;
      emit('error');
    },
  }), [clientRequestId, emit, enabled, family, messageId, provider, surface]);
}
