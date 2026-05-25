import { CameraView } from 'expo-camera';
import type { ReadyGateDiagnosticStatus } from '@clientShared/matching/readyGateDiagnosticCopy';

export type NativeReadyGateMediaDiagnosticState = {
  cameraDeviceStatus: ReadyGateDiagnosticStatus;
  microphoneDeviceStatus: ReadyGateDiagnosticStatus;
};

export type NativeReadyGatePermissionDiagnosticState = {
  cameraPermissionStatus: ReadyGateDiagnosticStatus;
  microphonePermissionStatus: ReadyGateDiagnosticStatus;
};

const UNKNOWN_MEDIA_DIAGNOSTICS: NativeReadyGateMediaDiagnosticState = {
  cameraDeviceStatus: 'unknown',
  microphoneDeviceStatus: 'unknown',
};

const CHECKING_PERMISSION_DIAGNOSTICS: NativeReadyGatePermissionDiagnosticState = {
  cameraPermissionStatus: 'checking',
  microphonePermissionStatus: 'checking',
};

type NativeMediaDeviceLike = {
  kind?: unknown;
};

function deviceKind(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

async function enumerateNativeMediaDevices(): Promise<NativeMediaDeviceLike[] | null> {
  const mediaDevices = (globalThis.navigator as { mediaDevices?: unknown } | undefined)?.mediaDevices;
  if (!mediaDevices || typeof mediaDevices !== 'object') return null;
  const enumerateDevices = (mediaDevices as { enumerateDevices?: unknown }).enumerateDevices;
  if (typeof enumerateDevices !== 'function') return null;
  try {
    const result = await enumerateDevices.call(mediaDevices);
    if (Array.isArray(result)) return result as NativeMediaDeviceLike[];
    if (result && typeof result === 'object' && Array.isArray((result as { devices?: unknown }).devices)) {
      return (result as { devices: NativeMediaDeviceLike[] }).devices;
    }
  } catch {
    return null;
  }
  return null;
}

export async function inspectNativeReadyGateMediaDevices(
  hasMediaPermission: boolean | null,
): Promise<NativeReadyGateMediaDiagnosticState> {
  const next: NativeReadyGateMediaDiagnosticState = {
    cameraDeviceStatus: hasMediaPermission ? 'checking' : 'unknown',
    microphoneDeviceStatus: hasMediaPermission ? 'checking' : 'unknown',
  };

  try {
    const cameraAvailable = await CameraView.isAvailableAsync();
    if (cameraAvailable === false) {
      next.cameraDeviceStatus = hasMediaPermission ? 'failed' : 'unknown';
    } else if (hasMediaPermission) {
      next.cameraDeviceStatus = 'ok';
    }
  } catch {
    next.cameraDeviceStatus = hasMediaPermission ? 'unknown' : next.cameraDeviceStatus;
  }

  const devices = await enumerateNativeMediaDevices();
  if (devices) {
    const hasCamera = devices.some((device) => {
      const kind = deviceKind(device.kind);
      return kind === 'videoinput' || kind === 'video';
    });
    const hasMicrophone = devices.some((device) => {
      const kind = deviceKind(device.kind);
      return kind === 'audioinput' || kind === 'audio';
    });
    next.cameraDeviceStatus = hasCamera
      ? (hasMediaPermission ? 'ok' : 'unknown')
      : hasMediaPermission
        ? 'failed'
        : next.cameraDeviceStatus;
    next.microphoneDeviceStatus = hasMicrophone
      ? (hasMediaPermission ? 'ok' : 'unknown')
      : hasMediaPermission
        ? 'failed'
        : next.microphoneDeviceStatus;
  } else if (hasMediaPermission) {
    next.microphoneDeviceStatus = 'ok';
  }

  return next;
}

export function defaultNativeReadyGateMediaDiagnostics(): NativeReadyGateMediaDiagnosticState {
  return { ...UNKNOWN_MEDIA_DIAGNOSTICS };
}

export function defaultNativeReadyGatePermissionDiagnostics(): NativeReadyGatePermissionDiagnosticState {
  return { ...CHECKING_PERMISSION_DIAGNOSTICS };
}
