import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { supabase } from '@/lib/supabase';
import {
  resolveVideoDateReadinessDiagnostic,
  type VideoDateReadinessStatus,
} from '@clientShared/matching/videoDateReadinessV2';

type NativePlatform = 'ios' | 'android';

export async function recordVideoDateHeartbeatV2(
  eventId: string,
  options: { foreground?: boolean; clientPlatform?: NativePlatform } = {},
): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_heartbeat_v2', {
    p_event_id: eventId,
    p_foreground: options.foreground ?? true,
    p_client_platform: options.clientPlatform ?? nativeClientPlatform(),
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}

export async function recordVideoDateReadinessCheckV2(params: {
  eventId: string;
  status: VideoDateReadinessStatus;
  capabilities: Record<string, unknown>;
  clientPlatform?: NativePlatform;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_readiness_check_v2', {
    p_event_id: params.eventId,
    p_status: params.status,
    p_capabilities: params.capabilities,
    p_client_platform: params.clientPlatform ?? nativeClientPlatform(),
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}

export async function persistReadyGateSuppressionV2(
  sessionId: string,
  suppressedUntilMs?: number,
): Promise<boolean> {
  if (!sessionId) return false;
  const { data, error } = await supabase.rpc('persist_ready_gate_suppression_v2', {
    p_session_id: sessionId,
    p_suppressed_until: Number.isFinite(suppressedUntilMs)
      ? new Date(suppressedUntilMs as number).toISOString()
      : null,
  });
  if (error) return false;
  return (data as { ok?: boolean } | null)?.ok !== false;
}

export function useNonBlockingVideoDateReadiness(
  eventId: string | undefined,
  enabled: boolean,
): {
  status: VideoDateReadinessStatus;
  diagnosticMessage: string | null;
  checked: boolean;
} {
  const [status, setStatus] = useState<VideoDateReadinessStatus>('unchecked');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enabled || !eventId) {
      setStatus('unchecked');
      setChecked(false);
      return;
    }
    let cancelled = false;

    const inspect = async () => {
      const capabilities = await inspectNativeVideoDateCapabilities();
      const nextStatus = resolveNativeReadinessStatus(capabilities);
      if (cancelled) return;
      setStatus(nextStatus);
      setChecked(true);
      void recordVideoDateReadinessCheckV2({
        eventId,
        status: nextStatus,
        capabilities,
      }).catch(() => undefined);
    };

    void inspect();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void inspect();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled, eventId]);

  return useMemo(() => {
    if (!checked) {
      return {
        status: 'unchecked' as const,
        diagnosticMessage: null,
        checked: false,
      };
    }
    const diagnostic = resolveVideoDateReadinessDiagnostic(status);
    return {
      status,
      diagnosticMessage: diagnostic.diagnosticMessage,
      checked,
    };
  }, [checked, status]);
}

async function inspectNativeVideoDateCapabilities(): Promise<Record<string, unknown>> {
  const [camera, microphone] = await Promise.all([
    Camera.getCameraPermissionsAsync().catch(() => null),
    Camera.getMicrophonePermissionsAsync().catch(() => null),
  ]);
  return {
    cameraPermission: camera?.status ?? 'unknown',
    microphonePermission: microphone?.status ?? 'unknown',
    cameraCanAskAgain: camera?.canAskAgain ?? null,
    microphoneCanAskAgain: microphone?.canAskAgain ?? null,
    platform: nativeClientPlatform(),
    dailyRoomDiagnosticRemoved: true,
  };
}

function resolveNativeReadinessStatus(capabilities: Record<string, unknown>): VideoDateReadinessStatus {
  const camera = capabilities.cameraPermission;
  const microphone = capabilities.microphonePermission;
  if (camera === 'denied' || microphone === 'denied') return 'blocked';
  if (camera === 'granted' && microphone === 'granted') return 'ready';
  return 'warning';
}

function nativeClientPlatform(): NativePlatform {
  return Platform.OS === 'android' ? 'android' : 'ios';
}
