import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { supabase } from '@/lib/supabase';
import { createVideoDateDailyDiagnosticCallObjectGuarded } from '@/lib/videoDateDailyMediaConfig';
import { registerNativeVideoDateDailyCleanup } from '@/lib/nativeDailyCallInstance';
import {
  resolveVideoDateReadinessDiagnostic,
  shouldRunVideoDateDiagnostic,
  type VideoDateReadinessStatus,
} from '@clientShared/matching/videoDateReadinessV2';

type NativePlatform = 'ios' | 'android';
const diagnosticLastRunAtMsByEvent = new Map<string, number>();
const DAILY_CALL_QUALITY_TIMEOUT_MS = 16_000;
const DAILY_DIAGNOSTIC_PREAUTH_TIMEOUT_MS = 5_000;

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

export type VideoDateDiagnosticEntryResult =
  | {
      ok: true;
      roomName: string;
      roomUrl: string;
      token: string;
      tokenExpiresAt: string | null;
      tokenTtlSeconds: number | null;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
    };

export async function prepareVideoDateDiagnosticEntry(): Promise<VideoDateDiagnosticEntryResult> {
  let payload: Record<string, unknown> | null;
  try {
    const { data, error } = await supabase.functions.invoke('daily-room', {
      body: { action: 'prepare_diagnostic_entry' },
    });
    if (error) {
      return { ok: false, error: 'diagnostic_entry_failed', retryable: true };
    }
    payload = data as Record<string, unknown> | null;
  } catch {
    return { ok: false, error: 'diagnostic_entry_failed', retryable: true };
  }
  if (!payload || payload.ok !== true || typeof payload.token !== 'string') {
    return {
      ok: false,
      error: typeof payload?.error === 'string' ? payload.error : 'diagnostic_entry_failed',
      retryable: payload?.retryable !== false,
    };
  }
  const roomName = typeof payload.room_name === 'string' ? payload.room_name : '';
  const roomUrl = typeof payload.room_url === 'string' ? payload.room_url : '';
  if (!roomName || !roomUrl) {
    return { ok: false, error: 'diagnostic_entry_invalid_response', retryable: true };
  }
  return {
    ok: true,
    roomName,
    roomUrl,
    token: payload.token,
    tokenExpiresAt: typeof payload.token_expires_at === 'string' ? payload.token_expires_at : null,
    tokenTtlSeconds: typeof payload.token_ttl_seconds === 'number' ? payload.token_ttl_seconds : null,
  };
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
      void maybeRunDiagnostic(eventId, nextStatus, capabilities, () => cancelled);
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

async function maybeRunDiagnostic(
  eventId: string,
  status: VideoDateReadinessStatus,
  capabilities: Record<string, unknown>,
  isCancelled: () => boolean,
) {
  const nowMs = Date.now();
  if (!shouldRunVideoDateDiagnostic(status, diagnosticLastRunAtMsByEvent.get(eventId), nowMs)) return;
  diagnosticLastRunAtMsByEvent.set(eventId, nowMs);
  let diagnostic: Awaited<ReturnType<typeof prepareVideoDateDiagnosticEntry>>;
  try {
    diagnostic = await prepareVideoDateDiagnosticEntry();
  } catch {
    diagnostic = { ok: false, error: 'diagnostic_entry_exception', retryable: true };
  }
  if (isCancelled()) return;
  const dailyDiagnostic = diagnostic.ok === true
    ? {
        ok: true,
        roomNamePresent: Boolean(diagnostic.roomName),
        roomUrlPresent: Boolean(diagnostic.roomUrl),
        tokenReceived: true,
        tokenTtlSeconds: diagnostic.tokenTtlSeconds,
        callQuality: await runNativeDailyCallQualityAdvisory(diagnostic),
      }
    : {
        ok: false,
        error: diagnostic.error,
        retryable: diagnostic.retryable,
      };
  void recordVideoDateReadinessCheckV2({
    eventId,
    status,
    capabilities: {
      ...capabilities,
      dailyDiagnostic,
    },
  }).catch(() => undefined);
}

async function runNativeDailyCallQualityAdvisory(
  diagnostic: Extract<Awaited<ReturnType<typeof prepareVideoDateDiagnosticEntry>>, { ok: true }>,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const guarded = await createVideoDateDailyDiagnosticCallObjectGuarded({
    source: 'native_video_date_readiness_diagnostic',
    skipIfCleanupPending: true,
    waitForCleanup: false,
    failOnExternalCall: true,
  });
  if (guarded.ok === false) {
    return {
      ok: false,
      skipped: guarded.reason,
      meetingState: guarded.meetingState ?? null,
      latencyMs: Date.now() - startedAt,
    };
  }
  const call = guarded.call;
  const callAny = call as unknown as {
    preAuth?: (options: { url: string; token: string }) => Promise<unknown>;
    testCallQuality?: () => Promise<unknown>;
    stopTestCallQuality?: () => void;
    testWebsocketConnectivity?: () => Promise<unknown>;
    abortTestWebsocketConnectivity?: () => void;
    destroy?: () => void | Promise<void>;
  };
  try {
    if (typeof callAny.preAuth !== 'function') {
      return { ok: false, skipped: 'preauth_api_unavailable', latencyMs: Date.now() - startedAt };
    }
    const diagnosticToken = diagnostic.token;
    const preAuthReady = await withTimeout(
      Promise.resolve(callAny.preAuth({ url: diagnostic.roomUrl, token: diagnosticToken })).then(
        () => true,
        () => false,
      ),
      DAILY_DIAGNOSTIC_PREAUTH_TIMEOUT_MS,
    );
    if (preAuthReady !== true) {
      return {
        ok: false,
        skipped: preAuthReady === null ? 'preauth_timeout' : 'preauth_failed',
        latencyMs: Date.now() - startedAt,
      };
    }
    if (typeof callAny.testCallQuality === 'function') {
      const result = await withTimeout(
        Promise.resolve(callAny.testCallQuality()),
        DAILY_CALL_QUALITY_TIMEOUT_MS,
      );
      if (!result) {
        callAny.stopTestCallQuality?.();
        return { ok: false, api: 'testCallQuality', error: 'call_quality_timeout', latencyMs: Date.now() - startedAt };
      }
      return {
        ok: true,
        api: 'testCallQuality',
        latencyMs: Date.now() - startedAt,
        ...summarizeDailyQualityResult(result),
      };
    }
    if (typeof callAny.testWebsocketConnectivity === 'function') {
      const result = await withTimeout(
        Promise.resolve(callAny.testWebsocketConnectivity()),
        DAILY_CALL_QUALITY_TIMEOUT_MS,
      );
      if (!result) {
        callAny.abortTestWebsocketConnectivity?.();
        return {
          ok: false,
          api: 'testWebsocketConnectivity',
          error: 'websocket_connectivity_timeout',
          latencyMs: Date.now() - startedAt,
        };
      }
      return {
        ok: true,
        api: 'testWebsocketConnectivity',
        latencyMs: Date.now() - startedAt,
        ...summarizeDailyWebsocketResult(result),
      };
    }
    return { ok: false, error: 'call_quality_api_unavailable', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.name || error.message : 'call_quality_failed',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    try {
      await registerNativeVideoDateDailyCleanup(
        Promise.resolve().then(async () => {
          await Promise.resolve(callAny.destroy?.());
        }),
        {
          source: 'native_video_date_readiness_diagnostic',
          reason: 'diagnostic_complete',
        },
      );
    } catch {
      /* best-effort cleanup */
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function summarizeDailyQualityResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { result: 'unknown' };
  const record = result as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  return {
    result: typeof record.result === 'string' ? record.result : 'unknown',
    secondsElapsed: typeof record.secondsElapsed === 'number' ? record.secondsElapsed : null,
    maxRoundTripTime: typeof data.maxRoundTripTime === 'number' ? data.maxRoundTripTime : null,
    avgRoundTripTime: typeof data.avgRoundTripTime === 'number' ? data.avgRoundTripTime : null,
    avgSendPacketLoss: typeof data.avgSendPacketLoss === 'number' ? data.avgSendPacketLoss : null,
    avgAvailableOutgoingBitrate: typeof data.avgAvailableOutgoingBitrate === 'number'
      ? data.avgAvailableOutgoingBitrate
      : null,
    avgSendBitsPerSecond: typeof data.avgSendBitsPerSecond === 'number' ? data.avgSendBitsPerSecond : null,
  };
}

function summarizeDailyWebsocketResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { result: 'unknown' };
  const record = result as Record<string, unknown>;
  const abortedRegions = Array.isArray(record.abortedRegions) ? record.abortedRegions.length : 0;
  const failedRegions = Array.isArray(record.failedRegions) ? record.failedRegions.length : 0;
  const warningRegions = Array.isArray(record.warningRegions) ? record.warningRegions.length : 0;
  return {
    result: typeof record.result === 'string' ? record.result : 'unknown',
    abortedRegionCount: abortedRegions,
    failedRegionCount: failedRegions,
    warningRegionCount: warningRegions,
  };
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
    diagnosticRoomPathDefined: true,
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
