import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { checkNativeCameraMicrophonePermissions, requestNativeCameraMicrophonePermissions } from "@/lib/nativeMediaPermissions";
import { openPermissionSettings, useSettingsReturnRefresh } from "@/lib/permissionSettings";
import { defaultNativeReadyGateMediaDiagnostics, defaultNativeReadyGatePermissionDiagnostics, inspectNativeReadyGateMediaDevices } from "@/lib/readyGateNativeMediaDiagnostics";

/**
 * Media permission concern of the native Ready Gate screen: diagnostics refresh, permission result application, check/request flows and the settings deep link.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/ready/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeReadyGateMediaPermissionsDeps {
  activeSessionIdRef: MutableRefObject<string | null>;
  hasMediaPermission: boolean | null;
  permissionSettingsOpenedRef: MutableRefObject<boolean>;
  sessionId: string;
  setHasMediaPermission: Dispatch<SetStateAction<boolean | null>>;
  setNativeMediaDiagnostics: Dispatch<SetStateAction<ReturnType<typeof defaultNativeReadyGateMediaDiagnostics>>>;
  setNativePermissionDiagnostics: Dispatch<SetStateAction<ReturnType<typeof defaultNativeReadyGatePermissionDiagnostics>>>;
  setPermissionsResolved: Dispatch<SetStateAction<boolean>>;
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeReadyGateMediaPermissions(deps: NativeReadyGateMediaPermissionsDeps) {
  const {
    activeSessionIdRef,
    hasMediaPermission,
    permissionSettingsOpenedRef,
    sessionId,
    setHasMediaPermission,
    setNativeMediaDiagnostics,
    setNativePermissionDiagnostics,
    setPermissionsResolved,
    user,
  } = deps;

  const refreshNativeMediaDiagnostics = useCallback(
    async (permission: boolean | null = hasMediaPermission) => {
      const activeSessionId = activeSessionIdRef.current;
      setNativeMediaDiagnostics((current) => ({
        ...current,
        cameraDeviceStatus: permission
          ? 'checking'
          : current.cameraDeviceStatus,
        microphoneDeviceStatus: permission
          ? 'checking'
          : current.microphoneDeviceStatus,
      }));
      const next = await inspectNativeReadyGateMediaDevices(permission);
      if (activeSessionIdRef.current !== activeSessionId) return;
      setNativeMediaDiagnostics(next);
    },
    [hasMediaPermission],
  );

  const applyMediaPermissionResult = useCallback(
    (
      result: Awaited<
        ReturnType<typeof requestNativeCameraMicrophonePermissions>
      >,
    ) => {
      setHasMediaPermission(result.ok);
      setPermissionsResolved(true);
      setNativePermissionDiagnostics((current) => ({
        cameraPermissionStatus:
          !result.ok &&
          current.cameraPermissionStatus === 'blocked' &&
          result.cameraStatus !== 'granted'
            ? 'blocked'
            : result.permissions.cameraPermissionStatus,
        microphonePermissionStatus:
          !result.ok &&
          current.microphonePermissionStatus === 'blocked' &&
          result.microphoneStatus !== 'granted'
            ? 'blocked'
            : result.permissions.microphonePermissionStatus,
      }));
      void refreshNativeMediaDiagnostics(result.ok);
      return result.ok;
    },
    [refreshNativeMediaDiagnostics],
  );

  const checkMediaPermissions = useCallback(async (): Promise<boolean> => {
    const result = await checkNativeCameraMicrophonePermissions({
      sessionId: sessionId ? String(sessionId) : null,
      userId: user?.id ?? null,
      sources: {
        androidExisting: 'standalone_ready_android_existing_grants',
        androidRequest: 'standalone_ready_android_request',
        nativeExisting: 'standalone_ready_native_existing_grants',
        nativeRequest: 'standalone_ready_native_request',
      },
    });
    return applyMediaPermissionResult(result);
  }, [applyMediaPermissionResult, sessionId, user?.id]);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    const result = await requestNativeCameraMicrophonePermissions({
      sessionId: sessionId ? String(sessionId) : null,
      userId: user?.id ?? null,
      sources: {
        androidExisting: 'standalone_ready_android_existing_grants',
        androidRequest: 'standalone_ready_android_request',
        nativeExisting: 'standalone_ready_native_existing_grants',
        nativeRequest: 'standalone_ready_native_request',
      },
    });
    return applyMediaPermissionResult(result);
  }, [applyMediaPermissionResult, sessionId, user?.id]);

  useSettingsReturnRefresh({
    wasOpenedRef: permissionSettingsOpenedRef,
    refresh: checkMediaPermissions,
    source: 'ready_screen_media',
  });

  const openMediaPermissionSettings = useCallback(async () => {
    permissionSettingsOpenedRef.current = true;
    const opened = await openPermissionSettings('ready_screen_media');
    if (!opened) {
      permissionSettingsOpenedRef.current = false;
      void checkMediaPermissions();
    }
  }, [checkMediaPermissions]);

  return {
    refreshNativeMediaDiagnostics,
    checkMediaPermissions,
    requestMediaPermissions,
    openMediaPermissionSettings,
  };
}

export type NativeReadyGateMediaPermissionsApi = ReturnType<typeof useNativeReadyGateMediaPermissions>;
