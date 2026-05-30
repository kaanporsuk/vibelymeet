import { PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { setVideoDatePermissionHandoff } from '@clientShared/matching/videoDatePermissionHandoff';
import {
  mediaPermissionResultForStatus,
  type MediaPermissionResult,
} from '@clientShared/media/mediaPermissionResult';
import type { NativeReadyGatePermissionDiagnosticState } from '@/lib/readyGateNativeMediaDiagnostics';

type NativePermissionSourceConfig = {
  androidExisting: string;
  androidRequest: string;
  nativeExisting: string;
  nativeRequest: string;
};

export type NativeCameraMicrophonePermissionRequestResult = {
  ok: boolean;
  source: string;
  permissions: NativeReadyGatePermissionDiagnosticState;
  mediaPermission: MediaPermissionResult;
  cameraStatus: string;
  microphoneStatus: string;
  cameraCanAskAgain: boolean | null;
  microphoneCanAskAgain: boolean | null;
};

function errorField(error: unknown, field: 'name' | 'message'): string | null {
  if (!error || typeof error !== 'object' || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function permissionResult(ok: boolean, cameraStatus: string, microphoneStatus: string): MediaPermissionResult {
  if (ok) {
    return mediaPermissionResultForStatus({
      status: 'granted',
      kind: 'camera_microphone',
      permissionState: 'granted',
    });
  }
  const permissionState =
    cameraStatus === 'undetermined' || microphoneStatus === 'undetermined' ? 'prompt' : 'denied';
  return mediaPermissionResultForStatus({
    status: 'denied',
    kind: 'camera_microphone',
    permissionState,
    rawErrorName: 'native_media_permission_denied',
    rawErrorMessage: `camera=${cameraStatus}; microphone=${microphoneStatus}`,
  });
}

function diagnostics(ok: boolean): NativeReadyGatePermissionDiagnosticState {
  return {
    cameraPermissionStatus: ok ? 'ok' : 'blocked',
    microphonePermissionStatus: ok ? 'ok' : 'blocked',
  };
}

function finalizePermissionResult(params: {
  ok: boolean;
  source: string;
  sessionId?: string | null;
  userId?: string | null;
  cameraStatus: string;
  microphoneStatus: string;
  cameraCanAskAgain?: boolean | null;
  microphoneCanAskAgain?: boolean | null;
  setHandoff?: boolean;
  mediaPermission?: MediaPermissionResult;
}): NativeCameraMicrophonePermissionRequestResult {
  if (params.ok && params.setHandoff !== false && params.sessionId && params.userId) {
    setVideoDatePermissionHandoff({
      sessionId: params.sessionId,
      userId: params.userId,
      platform: 'native',
      source: params.source,
    });
  }

  return {
    ok: params.ok,
    source: params.source,
    permissions: diagnostics(params.ok),
    mediaPermission: params.mediaPermission ?? permissionResult(params.ok, params.cameraStatus, params.microphoneStatus),
    cameraStatus: params.cameraStatus,
    microphoneStatus: params.microphoneStatus,
    cameraCanAskAgain: params.cameraCanAskAgain ?? null,
    microphoneCanAskAgain: params.microphoneCanAskAgain ?? null,
  };
}

export async function requestNativeCameraMicrophonePermissions(params: {
  sessionId?: string | null;
  userId?: string | null;
  sources: NativePermissionSourceConfig;
  setHandoff?: boolean;
}): Promise<NativeCameraMicrophonePermissionRequestResult> {
  try {
    if (Platform.OS === 'android') {
      const camOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const micOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (camOk && micOk) {
        return finalizePermissionResult({
          ok: true,
          source: params.sources.androidExisting,
          sessionId: params.sessionId,
          userId: params.userId,
          cameraStatus: 'granted',
          microphoneStatus: 'granted',
          setHandoff: params.setHandoff,
        });
      }

      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const cameraStatus = granted[PermissionsAndroid.PERMISSIONS.CAMERA] ?? 'denied';
      const microphoneStatus = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ?? 'denied';
      const ok =
        cameraStatus === PermissionsAndroid.RESULTS.GRANTED &&
        microphoneStatus === PermissionsAndroid.RESULTS.GRANTED;
      return finalizePermissionResult({
        ok,
        source: params.sources.androidRequest,
        sessionId: params.sessionId,
        userId: params.userId,
        cameraStatus,
        microphoneStatus,
        setHandoff: params.setHandoff,
      });
    }

    const camExisting = await Camera.getCameraPermissionsAsync();
    const micExisting = await Camera.getMicrophonePermissionsAsync();
    if (camExisting.status === 'granted' && micExisting.status === 'granted') {
      return finalizePermissionResult({
        ok: true,
        source: params.sources.nativeExisting,
        sessionId: params.sessionId,
        userId: params.userId,
        cameraStatus: camExisting.status,
        microphoneStatus: micExisting.status,
        cameraCanAskAgain: camExisting.canAskAgain,
        microphoneCanAskAgain: micExisting.canAskAgain,
        setHandoff: params.setHandoff,
      });
    }

    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const ok = cam.status === 'granted' && mic.status === 'granted';
    return finalizePermissionResult({
      ok,
      source: params.sources.nativeRequest,
      sessionId: params.sessionId,
      userId: params.userId,
      cameraStatus: cam.status,
      microphoneStatus: mic.status,
      cameraCanAskAgain: cam.canAskAgain,
      microphoneCanAskAgain: mic.canAskAgain,
      setHandoff: params.setHandoff,
    });
  } catch (error) {
    const rawErrorName = errorField(error, 'name') ?? 'native_media_permission_error';
    const rawErrorMessage = errorField(error, 'message') ?? String(error ?? 'unknown native permission error');
    return finalizePermissionResult({
      ok: false,
      source: Platform.OS === 'android' ? params.sources.androidRequest : params.sources.nativeRequest,
      sessionId: params.sessionId,
      userId: params.userId,
      cameraStatus: 'error',
      microphoneStatus: 'error',
      setHandoff: false,
      mediaPermission: mediaPermissionResultForStatus({
        status: 'in_use_or_abort',
        kind: 'camera_microphone',
        permissionState: 'unknown',
        rawErrorName,
        rawErrorMessage,
      }),
    });
  }
}
