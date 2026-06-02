import { PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setVideoDatePermissionHandoff } from '@clientShared/matching/videoDatePermissionHandoff';
import {
  mediaPermissionResultForStatus,
  type MediaPermissionResult,
} from '@clientShared/media/mediaPermissionResult';
import {
  permissionUxMediaKindForRequiredGrants,
  permissionUxStatusFromGrant,
} from '@clientShared/permissions/permissionUx';
import type { NativeReadyGatePermissionDiagnosticState } from '@/lib/readyGateNativeMediaDiagnostics';

type NativePermissionSourceConfig = {
  androidExisting: string;
  androidRequest: string;
  nativeExisting: string;
  nativeRequest: string;
};

const ANDROID_MEDIA_PERMISSION_BLOCKED_STORAGE_KEY = 'vibely.android_media_permission_blocked.v1';
type AndroidBlockedMediaPermissions = {
  camera: boolean;
  microphone: boolean;
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

async function readAndroidBlockedMediaPermissions(): Promise<AndroidBlockedMediaPermissions> {
  if (Platform.OS !== 'android') return { camera: false, microphone: false };
  try {
    const raw = await AsyncStorage.getItem(ANDROID_MEDIA_PERMISSION_BLOCKED_STORAGE_KEY);
    if (!raw) return { camera: false, microphone: false };
    const parsed = JSON.parse(raw);
    return {
      camera: Boolean(parsed?.camera),
      microphone: Boolean(parsed?.microphone),
    };
  } catch {
    return { camera: false, microphone: false };
  }
}

async function writeAndroidBlockedMediaPermissions(next: AndroidBlockedMediaPermissions): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (!next.camera && !next.microphone) {
      await AsyncStorage.removeItem(ANDROID_MEDIA_PERMISSION_BLOCKED_STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(ANDROID_MEDIA_PERMISSION_BLOCKED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best effort only; permission APIs remain authoritative for the current request.
  }
}

async function rememberAndroidMediaPermissionResult(cameraStatus: string, microphoneStatus: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  const current = await readAndroidBlockedMediaPermissions();
  await writeAndroidBlockedMediaPermissions({
    camera:
      cameraStatus === PermissionsAndroid.RESULTS.GRANTED
        ? false
        : cameraStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || current.camera,
    microphone:
      microphoneStatus === PermissionsAndroid.RESULTS.GRANTED
        ? false
        : microphoneStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || current.microphone,
  });
}

function permissionResult(
  ok: boolean,
  cameraStatus: string,
  microphoneStatus: string,
  cameraCanAskAgain: boolean | null,
  microphoneCanAskAgain: boolean | null,
): MediaPermissionResult {
  if (ok) {
    return mediaPermissionResultForStatus({
      status: 'granted',
      kind: 'camera_microphone',
      permissionState: 'granted',
    });
  }
  const cameraUxStatus = permissionUxStatusFromGrant({
    status: cameraStatus,
    canAskAgain: cameraCanAskAgain,
  });
  const microphoneUxStatus = permissionUxStatusFromGrant({
    status: microphoneStatus,
    canAskAgain: microphoneCanAskAgain,
  });
  const isSettingsOnly =
    cameraUxStatus === 'blocked_settings' ||
    microphoneUxStatus === 'blocked_settings' ||
    cameraUxStatus === 'limited' ||
    microphoneUxStatus === 'limited';
  const permissionState = isSettingsOnly
    ? 'denied'
    : cameraStatus === 'undetermined' || microphoneStatus === 'undetermined'
      ? 'prompt'
      : 'denied';
  const kind = permissionUxMediaKindForRequiredGrants(
    { status: cameraStatus, canAskAgain: cameraCanAskAgain },
    { status: microphoneStatus, canAskAgain: microphoneCanAskAgain },
  );
  return mediaPermissionResultForStatus({
    status: isSettingsOnly ? 'blocked_settings' : 'denied_retryable',
    kind,
    permissionState,
    rawErrorName: 'native_media_permission_denied',
    rawErrorMessage: `camera=${cameraStatus}; microphone=${microphoneStatus}`,
  });
}

function diagnosticStatusFor(
  status: string,
  canAskAgain: boolean | null,
): NativeReadyGatePermissionDiagnosticState['cameraPermissionStatus'] {
  if (status === 'granted') return 'ok';
  if (status === 'never_ask_again' || canAskAgain === false) return 'blocked';
  if (status === 'denied' || status === 'undetermined' || status === 'prompt' || status === 'error') {
    return 'warning';
  }
  return 'unknown';
}

function diagnostics(
  cameraStatus: string,
  microphoneStatus: string,
  cameraCanAskAgain: boolean | null,
  microphoneCanAskAgain: boolean | null,
): NativeReadyGatePermissionDiagnosticState {
  return {
    cameraPermissionStatus: diagnosticStatusFor(cameraStatus, cameraCanAskAgain),
    microphonePermissionStatus: diagnosticStatusFor(microphoneStatus, microphoneCanAskAgain),
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
    permissions: diagnostics(
      params.cameraStatus,
      params.microphoneStatus,
      params.cameraCanAskAgain ?? null,
      params.microphoneCanAskAgain ?? null,
    ),
    mediaPermission: params.mediaPermission ?? permissionResult(
      params.ok,
      params.cameraStatus,
      params.microphoneStatus,
      params.cameraCanAskAgain ?? null,
      params.microphoneCanAskAgain ?? null,
    ),
    cameraStatus: params.cameraStatus,
    microphoneStatus: params.microphoneStatus,
    cameraCanAskAgain: params.cameraCanAskAgain ?? null,
    microphoneCanAskAgain: params.microphoneCanAskAgain ?? null,
  };
}

export async function checkNativeCameraMicrophonePermissions(params: {
  sessionId?: string | null;
  userId?: string | null;
  sources: NativePermissionSourceConfig;
  setHandoff?: boolean;
}): Promise<NativeCameraMicrophonePermissionRequestResult> {
  try {
    if (Platform.OS === 'android') {
      const [camOk, micOk, rememberedBlocked] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
        readAndroidBlockedMediaPermissions(),
      ]);
      await rememberAndroidMediaPermissionResult(
        camOk
          ? PermissionsAndroid.RESULTS.GRANTED
          : rememberedBlocked.camera
            ? PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
            : 'undetermined',
        micOk
          ? PermissionsAndroid.RESULTS.GRANTED
          : rememberedBlocked.microphone
            ? PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
            : 'undetermined',
      );
      return finalizePermissionResult({
        ok: camOk && micOk,
        source: params.sources.androidExisting,
        sessionId: params.sessionId,
        userId: params.userId,
        cameraStatus: camOk ? 'granted' : rememberedBlocked.camera ? 'never_ask_again' : 'undetermined',
        microphoneStatus: micOk ? 'granted' : rememberedBlocked.microphone ? 'never_ask_again' : 'undetermined',
        setHandoff: params.setHandoff,
      });
    }

    const [camExisting, micExisting] = await Promise.all([
      Camera.getCameraPermissionsAsync(),
      Camera.getMicrophonePermissionsAsync(),
    ]);
    return finalizePermissionResult({
      ok: camExisting.status === 'granted' && micExisting.status === 'granted',
      source: params.sources.nativeExisting,
      sessionId: params.sessionId,
      userId: params.userId,
      cameraStatus: camExisting.status,
      microphoneStatus: micExisting.status,
      cameraCanAskAgain: camExisting.canAskAgain,
      microphoneCanAskAgain: micExisting.canAskAgain,
      setHandoff: params.setHandoff,
    });
  } catch (error) {
    const rawErrorName = errorField(error, 'name') ?? 'native_media_permission_check_error';
    const rawErrorMessage = errorField(error, 'message') ?? String(error ?? 'unknown native permission check error');
    return finalizePermissionResult({
      ok: false,
      source: Platform.OS === 'android' ? params.sources.androidExisting : params.sources.nativeExisting,
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
        await rememberAndroidMediaPermissionResult(
          PermissionsAndroid.RESULTS.GRANTED,
          PermissionsAndroid.RESULTS.GRANTED,
        );
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
      await rememberAndroidMediaPermissionResult(cameraStatus, microphoneStatus);
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
