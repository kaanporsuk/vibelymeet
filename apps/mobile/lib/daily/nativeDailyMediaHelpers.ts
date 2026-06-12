/**
 * Pure native Daily media/camera/render helpers for the Video Date screen.
 * Extracted verbatim from `app/date/[id].tsx` (VD rebuild PR 8).
 */
import type { DailyParticipant } from "@daily-co/react-native-daily-js";
import { videoDateAspectRatio } from "@clientShared/matching/videoDateMediaContract";
import type {
  NativeVideoDateCaptureProfile,
} from "@/lib/videoDateDailyMediaConfig";
import type { DailyCallObject } from "@/lib/daily/nativeDailyCallSingleton";
import { videoDateDailyDiagnostic } from "@/lib/videoDate/videoDateScreenShared";

export const NATIVE_REMOTE_RENDER_REMOUNT_DELAY_MS = 650;
export const NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS = 8_000;
export const NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS = 500;
export const NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS = 3_000;
export const NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS = 3_000;
export const NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK = 4;
export const NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE = 2;
export const NATIVE_REMOTE_RENDER_REMOUNT_ATTEMPT_TTL_MS = 30_000;
export const NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPT_KEYS = 24;
export const NATIVE_CAMERA_SWITCH_COMMIT_TIMEOUT_MS = 1_800;
export const NATIVE_CAMERA_SWITCH_COMMIT_POLL_MS = 80;

export type NativeMediaStreamTrack =
  import("@daily-co/react-native-webrtc").MediaStreamTrack;
export type NativeDailyCameraFacingMode = "user" | "environment";
export type NativeDailyCameraDevice = {
  deviceId?: string | number;
  id?: string | number;
  kind?: string;
  facing?: unknown;
  facingMode?: unknown;
  label?: string;
};
export type NativeDailyCameraControls = {
  getCameraFacingMode?: () => Promise<NativeDailyCameraFacingMode | null>;
  cycleCamera?: () => Promise<{
    device: { facingMode: NativeDailyCameraFacingMode } | null;
  }>;
  setCamera?: (
    cameraDeviceId: string | number,
  ) => Promise<{ device: { facingMode: NativeDailyCameraFacingMode } | null }>;
  enumerateDevices?: () => Promise<{ devices: NativeDailyCameraDevice[] }>;
};
export type NativeDailyAppMessageControls = {
  sendAppMessage?: (data: unknown, to?: string | string[]) => unknown;
};
export type NativeDailyInboundVideoStats = {
  trackId?: unknown;
  fps?: unknown;
  frameWidth?: unknown;
  frameHeight?: unknown;
};
export type NativeDailyCpuLoadStatsResult = {
  stats?: {
    latest?: {
      cpuInboundVideoStats?: NativeDailyInboundVideoStats[];
      totalReceivedVideoTracks?: unknown;
    };
  };
};
export type NativeDailyNetworkStatsResult = {
  stats?: {
    latest?: {
      videoRecvBitsPerSecond?: unknown;
    };
  };
};
export type NativeDailyStatsControls = {
  getCpuLoadStats?: () => Promise<NativeDailyCpuLoadStatsResult>;
  getNetworkStats?: () => Promise<NativeDailyNetworkStatsResult>;
};

export type NativeCameraSwitchCommitMethod = "set_camera" | "cycle_camera";
export type NativeLocalCameraSnapshot = {
  trackId: string | null;
  deviceId: string | null;
  facingMode: NativeDailyCameraFacingMode | null;
  readyState: string | null;
  enabled: boolean | null;
};
export type NativeCameraSwitchCommit = NativeLocalCameraSnapshot & {
  method: NativeCameraSwitchCommitMethod;
  latencyMs: number;
};
export type NativeCameraSwitchCommitExpectation = {
  baselineFacing: NativeDailyCameraFacingMode | null;
  previousControlsFacing: NativeDailyCameraFacingMode | null;
  expectedDeviceKey?: string | null;
  expectedFacing?: NativeDailyCameraFacingMode | null;
};

export function getTrack(
  participant: DailyParticipant | undefined,
  kind: "video" | "audio",
): NativeMediaStreamTrack | null {
  if (!participant) return null;
  const trackInfo = participant.tracks?.[kind];
  // Do not feed DailyMediaView a "video off" track — persistentTrack can still show a stale last frame.
  if (
    trackInfo &&
    (trackInfo.state === "off" || trackInfo.state === "blocked")
  ) {
    return null;
  }
  const p = participant as unknown as {
    tracks?: {
      video?: { persistentTrack?: unknown };
      audio?: { persistentTrack?: unknown };
    };
    videoTrack?: unknown;
    audioTrack?: unknown;
  };
  if (p.tracks) {
    const t =
      kind === "video"
        ? p.tracks.video?.persistentTrack
        : p.tracks.audio?.persistentTrack;
    if (t) return t as NativeMediaStreamTrack;
  }
  const dep = kind === "video" ? p.videoTrack : p.audioTrack;
  return dep === false || dep === undefined
    ? null
    : (dep as NativeMediaStreamTrack);
}

export function summarizeVideoTrackSettings(
  track: NativeMediaStreamTrack | null | undefined,
) {
  if (!track || typeof track.getSettings !== "function") return null;
  const settings = track.getSettings();
  return {
    deviceId: typeof settings.deviceId === "string" ? settings.deviceId : null,
    width: typeof settings.width === "number" ? settings.width : null,
    height: typeof settings.height === "number" ? settings.height : null,
    aspectRatio: videoDateAspectRatio(settings.width, settings.height),
    frameRate:
      typeof settings.frameRate === "number" ? settings.frameRate : null,
    facingMode:
      typeof settings.facingMode === "string" ? settings.facingMode : null,
  };
}

export function sleepNativeCameraSwitch(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeNativeCameraFacingMode(
  value: unknown,
): NativeDailyCameraFacingMode | null {
  return value === "user" || value === "environment" ? value : null;
}

export function oppositeNativeCameraFacingMode(
  value: NativeDailyCameraFacingMode | null,
): NativeDailyCameraFacingMode | null {
  if (value === "user") return "environment";
  if (value === "environment") return "user";
  return null;
}

export function nativeCameraDeviceId(
  device: NativeDailyCameraDevice | null | undefined,
): string | number | null {
  if (!device) return null;
  if (
    typeof device.deviceId === "string" ||
    typeof device.deviceId === "number"
  )
    return device.deviceId;
  if (typeof device.id === "string" || typeof device.id === "number")
    return device.id;
  return null;
}

export function nativeCameraDeviceKey(
  device: NativeDailyCameraDevice | null | undefined,
): string | null {
  const id = nativeCameraDeviceId(device);
  return id == null ? null : String(id);
}

export function nativeCameraFacingModeFromLabel(
  label: unknown,
): NativeDailyCameraFacingMode | null {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return "user";
  if (/\b(back|rear|environment|world)\b/.test(normalized))
    return "environment";
  return null;
}

export function nativeCameraDeviceFacingMode(
  device: NativeDailyCameraDevice | null | undefined,
): NativeDailyCameraFacingMode | null {
  if (!device) return null;
  const explicitFacing =
    normalizeNativeCameraFacingMode(device.facingMode) ??
    normalizeNativeCameraFacingMode(device.facing);
  if (explicitFacing) return explicitFacing;
  return nativeCameraFacingModeFromLabel(device.label);
}

export function nativeLocalCameraSnapshot(
  participant: DailyParticipant | null | undefined,
): NativeLocalCameraSnapshot {
  const videoTrack = getTrack(participant ?? undefined, "video");
  const settings = summarizeVideoTrackSettings(videoTrack);
  return {
    trackId: videoTrack?.id ?? null,
    deviceId: typeof settings?.deviceId === "string" ? settings.deviceId : null,
    facingMode:
      normalizeNativeCameraFacingMode(settings?.facingMode) ??
      nativeCameraFacingModeFromLabel(videoTrack?.label),
    readyState: videoTrack?.readyState ?? null,
    enabled:
      typeof videoTrack?.enabled === "boolean" ? videoTrack.enabled : null,
  };
}

export function chooseNativeCameraDevice(
  devices: NativeDailyCameraDevice[],
  desiredFacing: NativeDailyCameraFacingMode | null,
  before: NativeLocalCameraSnapshot,
): NativeDailyCameraDevice | null {
  const videoDevices = devices.filter(
    (device) => device.kind === undefined || device.kind === "videoinput",
  );
  const usable = videoDevices.length > 0 ? videoDevices : devices;
  if (usable.length === 0) return null;
  const currentDeviceKey =
    before.deviceId == null ? null : String(before.deviceId);
  const candidates =
    currentDeviceKey != null
      ? usable.filter(
          (device) => nativeCameraDeviceKey(device) !== currentDeviceKey,
        )
      : usable;
  if (desiredFacing) {
    const facingMatches = usable.filter(
      (device) => nativeCameraDeviceFacingMode(device) === desiredFacing,
    );
    const facingMatch =
      facingMatches.find(
        (device) => nativeCameraDeviceKey(device) !== currentDeviceKey,
      ) ??
      facingMatches[0] ??
      null;
    if (facingMatch) return facingMatch;
    return null;
  }
  if (currentDeviceKey != null && candidates.length === 0) return null;
  if (currentDeviceKey != null) {
    return candidates[0] ?? null;
  }
  return null;
}

export function describeNativeCameraSwitchError(error: unknown): {
  name: string;
  message: string;
} {
  if (error instanceof Error)
    return { name: error.name || "Error", message: error.message };
  return { name: "unknown", message: String(error) };
}

export function finiteNativeStat(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sync UI toggles from Daily participant track state (source of truth after join / reconnect). */
export function applyLocalMediaUiFromParticipant(
  p: DailyParticipant,
  setters: {
    setIsVideoOff: (v: boolean) => void;
    setIsMuted: (v: boolean) => void;
  },
) {
  const vState = p.tracks?.video?.state;
  const aState = p.tracks?.audio?.state;
  if (vState !== undefined) setters.setIsVideoOff(vState === "off");
  if (aState !== undefined) setters.setIsMuted(aState === "off");
}

export function dailyParticipantId(
  p: DailyParticipant | undefined,
): string | undefined {
  if (!p) return undefined;
  const u = p as unknown as {
    user_id?: string;
    userId?: string;
    session_id?: string;
  };
  return u.user_id ?? u.userId ?? u.session_id;
}

export function dailyParticipantSessionId(
  p: DailyParticipant | undefined,
): string | undefined {
  if (!p) return undefined;
  return (p as unknown as { session_id?: string }).session_id;
}

export function nativeRemoteRenderTrackKey(
  p: DailyParticipant | undefined,
): string | null {
  if (!p) return null;
  const participantId = dailyParticipantId(p) ?? "remote";
  const videoTrackId = getTrack(p, "video")?.id ?? "no-video";
  const audioTrackId = getTrack(p, "audio")?.id ?? "no-audio";
  return `${participantId}:${videoTrackId}:${audioTrackId}`;
}

export function normalizeNativeRemoteRenderRecoveryScope(scope: string): string {
  if (scope.startsWith("camera_switch_hint:")) return "camera_switch_hint";
  if (scope.includes("camera_switch_hint")) return "camera_switch_hint";
  if (scope.includes("participant_updated_same_track"))
    return "participant_updated_same_track";
  return scope;
}

export type NativeRemoteRenderAttemptEntry = {
  attempts: number;
  updatedAtMs: number;
};

export type NativeCameraSwitchRenderWatch = {
  switchId: string;
  expiresAtMs: number;
};

export function pruneNativeRemoteRenderAttemptMap(
  attempts: Map<string, NativeRemoteRenderAttemptEntry>,
  nowMs: number,
) {
  for (const [key, entry] of attempts) {
    if (nowMs - entry.updatedAtMs > NATIVE_REMOTE_RENDER_REMOUNT_ATTEMPT_TTL_MS)
      attempts.delete(key);
  }
  while (attempts.size > NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPT_KEYS) {
    let oldestKey: string | null = null;
    let oldestUpdatedAtMs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of attempts) {
      if (entry.updatedAtMs < oldestUpdatedAtMs) {
        oldestKey = key;
        oldestUpdatedAtMs = entry.updatedAtMs;
      }
    }
    if (!oldestKey) break;
    attempts.delete(oldestKey);
  }
}

export async function ensureNativeFrontCameraIntent(
  call: DailyCallObject,
  context: {
    sessionId: string;
    roomName: string | null;
    captureProfile: NativeVideoDateCaptureProfile;
  },
) {
  const cameraControls = call as unknown as NativeDailyCameraControls;
  if (typeof cameraControls.getCameraFacingMode !== "function") {
    videoDateDailyDiagnostic("front_camera_intent_unavailable", {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      reason: "unsupported_api",
    });
    return;
  }
  try {
    const facingMode = await cameraControls.getCameraFacingMode();
    if (facingMode !== "environment") {
      videoDateDailyDiagnostic("front_camera_intent_checked", {
        session_id: context.sessionId,
        room_name: context.roomName,
        capture_profile: context.captureProfile,
        facing_mode: facingMode,
        action: "none",
      });
      return;
    }
    if (typeof cameraControls.cycleCamera !== "function") {
      videoDateDailyDiagnostic("front_camera_intent_unavailable", {
        session_id: context.sessionId,
        room_name: context.roomName,
        capture_profile: context.captureProfile,
        reason: "cycle_camera_unsupported",
        facing_mode: facingMode,
      });
      return;
    }
    const result = await cameraControls.cycleCamera();
    videoDateDailyDiagnostic("front_camera_intent_checked", {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      facing_mode: facingMode,
      action: "cycle_camera",
      next_facing_mode: result?.device?.facingMode ?? null,
    });
  } catch (error) {
    videoDateDailyDiagnostic("front_camera_intent_failed", {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
  }
}
