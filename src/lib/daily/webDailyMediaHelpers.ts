import {
  DailyCall,
  DailyParticipant,
} from "@daily-co/daily-js";
import {
  isTerminalDailyMeetingState,
  readDailyMeetingState,
} from "@/lib/dailyCallInstance";
import { videoDateWebMediaStreamConstraints } from "@/lib/dailyCallObjectConfig";
import {
  videoDateAspectRatio,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import type {
  MediaPermissionQueryState,
} from "@clientShared/media/mediaPermissionResult";

/**
 * Pure web Daily media/render helpers extracted verbatim from
 * src/hooks/useVideoCall.ts (Video Date rebuild PR 7). No React, no IO
 * beyond browser media/device APIs; all call-flow orchestration stays in
 * the useVideoCall hook.
 */

/** Daily `network-quality-change` — surfaced as lightweight HUD, not toasts. */
export type VideoCallNetworkTier = "good" | "fair" | "poor";

export type RemotePlaybackState = {
  participantPresent: boolean;
  mediaAttached: boolean;
  playSucceeded: boolean;
  firstFrameRendered: boolean;
  playRejected: boolean;
  retryCount: number;
  error?: string;
};

export type PeerMissingState = {
  terminal: boolean;
};

export const VIDEO_DATE_PREJOIN_TIMEOUT_MS = 12_000;
export const FIRST_REMOTE_TIMEOUT_MS = 25_000;
export const PREPARE_DATE_ENTRY_RETRY_DELAYS_MS = [700, 1_600] as const;
export const START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS = 60_000;
export const START_CALL_IN_FLIGHT_WAIT_POLL_MS = 250;
export const WEB_VIDEO_DATE_START_GATE_TTL_MS = 60_000;
export const DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000;
export const REMOTE_RENDER_VALIDATION_DELAY_MS = 650;
export const REMOTE_RENDER_FRAME_TIMEOUT_MS = 1_400;
export const REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK = 4;
export const REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE = 2;
export const REMOTE_RENDER_RECOVERY_ATTEMPT_TTL_MS = 30_000;
export const REMOTE_RENDER_RECOVERY_MAX_ATTEMPT_KEYS = 24;
export const CAMERA_SWITCH_COMMIT_TIMEOUT_MS = 1_800;
export const CAMERA_SWITCH_COMMIT_POLL_MS = 80;
export const REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS = 8_000;
// Camera-switch fresh-frame watchdog must be long enough to span Daily's
// keyframe interval on cellular/Safari paths. Falling back to teardown before
// a natural keyframe arrives causes the receiver to go black until the next
// GOP, which is the original bug we are fixing.
export const REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS = 3_000;
export const WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS: number | null = null;
export const WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_MS = 8_000;
export const WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_POLL_MS = 150;
export const WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS = 6;
export const WEB_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS = 300;
export const VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS = 3_000;

export type VideoDateMediaPromptIntent = "auto" | "user_retry";

export type WebVideoDateMediaCaptureReadiness = {
  canAcquire: boolean;
  permissionState: MediaPermissionQueryState;
  sourceAction: string;
  reasonCode: string | null;
};

export function hasLabeledMediaDevice(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
): boolean {
  return devices.some(
    (device) => device.kind === kind && device.label.trim().length > 0,
  );
}

export async function hasPriorGrantedVideoDateDeviceLabels(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return false;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return (
    hasLabeledMediaDevice(devices, "videoinput") &&
    hasLabeledMediaDevice(devices, "audioinput")
  );
}

export async function queryVideoDateMediaPermissionState(
  name: "camera" | "microphone",
): Promise<MediaPermissionQueryState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return status.state === "granted" ||
      status.state === "prompt" ||
      status.state === "denied"
      ? status.state
      : "unknown";
  } catch {
    return "unknown";
  }
}

export async function resolveWebVideoDateMediaCaptureReadiness(
  promptIntent: VideoDateMediaPromptIntent,
  hasPermissionHandoff: boolean,
): Promise<WebVideoDateMediaCaptureReadiness> {
  if (promptIntent === "user_retry") {
    return {
      canAcquire: true,
      permissionState: "unknown",
      sourceAction: "media_permission_preflight_user_retry",
      reasonCode: null,
    };
  }

  const [cameraState, microphoneState] = await Promise.all([
    queryVideoDateMediaPermissionState("camera"),
    queryVideoDateMediaPermissionState("microphone"),
  ]);

  if (cameraState === "granted" && microphoneState === "granted") {
    return {
      canAcquire: true,
      permissionState: "granted",
      sourceAction: "media_permission_preflight_prior_grant",
      reasonCode: null,
    };
  }

  if (cameraState === "denied" || microphoneState === "denied") {
    return {
      canAcquire: false,
      permissionState: "denied",
      sourceAction: "media_permission_preflight_blocked_settings",
      reasonCode: "browser_permission_denied",
    };
  }

  if (hasPermissionHandoff) {
    return {
      canAcquire: true,
      permissionState:
        cameraState === "prompt" || microphoneState === "prompt"
          ? "prompt"
          : "unknown",
      sourceAction: "media_permission_preflight_permission_handoff",
      reasonCode: null,
    };
  }

  if (cameraState === "prompt" || microphoneState === "prompt") {
    return {
      canAcquire: false,
      permissionState: "prompt",
      sourceAction: "media_permission_preflight_prompt_required",
      reasonCode: "browser_permission_prompt_required",
    };
  }

  try {
    if (await hasPriorGrantedVideoDateDeviceLabels()) {
      return {
        canAcquire: true,
        permissionState: "unknown",
        sourceAction: "media_permission_preflight_prior_device_labels",
        reasonCode: null,
      };
    }
  } catch {
    // Absence of device-label evidence means we should avoid auto-prompting.
  }

  return {
    canAcquire: false,
    permissionState: "unknown",
    sourceAction: "media_permission_preflight_prompt_required",
    reasonCode: "browser_permission_prior_grant_unproven",
  };
}

export function safeMeetingState(
  call: Pick<DailyCall, "meetingState"> | null | undefined,
): string | null {
  if (!call || typeof call.meetingState !== "function") return null;
  try {
    const state = call.meetingState();
    return typeof state === "string"
      ? state
      : state == null
        ? null
        : String(state);
  } catch {
    return "error";
  }
}

export function readDailyProviderSessionId(call: DailyCall | null): string | null {
  if (!call) return null;
  try {
    const local = call.participants().local as
      | { session_id?: unknown; sessionId?: unknown }
      | undefined;
    const sessionId = local?.session_id ?? local?.sessionId;
    return typeof sessionId === "string" && sessionId.length > 0
      ? sessionId
      : null;
  } catch {
    return null;
  }
}

export type RemoteVideoFrameCallbackMetadata = {
  presentedFrames?: number;
  mediaTime?: number;
  width?: number;
  height?: number;
};

export type RemoteVideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (
      now: DOMHighResTimeStamp,
      metadata: RemoteVideoFrameCallbackMetadata,
    ) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export type RemoteRenderRecoveryAttemptEntry = {
  attempts: number;
  updatedAtMs: number;
};

export type RemoteRenderValidationOptions = {
  allowRecovery?: boolean;
  recoveryFollowUp?: boolean;
  requireFreshFrame?: boolean;
  freshFrameBaseline?: RemoteRenderFrameState | null;
  /**
   * Override for how long to wait for a fresh frame before timing out.
   * Defaults to REMOTE_RENDER_FRAME_TIMEOUT_MS. Camera-switch flows pass a
   * larger value so the receiver can wait for the publisher's next keyframe
   * without prematurely tearing down a healthy decoder pipeline.
   */
  freshFrameTimeoutMs?: number;
};

export type RemoteRenderFrameState = {
  currentTime: number | null;
  decodedFrameCount: number | null;
  readyState: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
};

export type RemoteCameraSwitchRenderWatch = {
  switchId: string;
  expiresAtMs: number;
};

export type VideoDateCameraFacingMode = "user" | "environment";

export type WebCameraSwitchCommitMethod =
  | "cycle_camera"
  | "set_input_device"
  | "video_source";

export type WebCameraDevice = Partial<MediaDeviceInfo> & {
  facing?: unknown;
  facingMode?: unknown;
  id?: unknown;
  label?: unknown;
};

export type LocalCameraSnapshot = {
  trackId: string | null;
  deviceId: string | null;
  facingMode: VideoDateCameraFacingMode | null;
  readyState: MediaStreamTrackState | null;
  enabled: boolean | null;
};

export type WebCameraSwitchCommit = LocalCameraSnapshot & {
  method: WebCameraSwitchCommitMethod;
  latencyMs: number;
  publishRefreshApplied: boolean;
};

export type AppAcquiredVideoDateMedia = {
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  acquiredAtMs: number;
  consumedByDaily: boolean;
};

export function summarizeVideoTrackSettings(
  track: MediaStreamTrack | null | undefined,
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

export function summarizeWebRuntime() {
  if (typeof navigator === "undefined") {
    return {
      browser_family: "unknown",
      is_ios: false,
      is_mobile_safari: false,
      is_safari: false,
    };
  }
  const ua = navigator.userAgent ?? "";
  const vendor = navigator.vendor ?? "";
  const isIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isSafari =
    /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
  const isMobileSafari = isIOS && isSafari;
  const browserFamily = /CriOS|Chrome|Chromium/i.test(ua)
    ? "chrome"
    : /FxiOS|Firefox/i.test(ua)
      ? "firefox"
      : /Edg/i.test(ua)
        ? "edge"
        : isSafari || /Apple/i.test(vendor)
          ? "safari"
          : "unknown";
  return {
    browser_family: browserFamily,
    is_ios: isIOS,
    is_mobile_safari: isMobileSafari,
    is_safari: isSafari,
  };
}

export function stopMediaStreamTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* best-effort cleanup */
    }
  });
}

export function firstLiveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  return tracks.find((track) => track.readyState !== "ended") ?? null;
}

export type LiveVideoDateMediaTracks = {
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack;
};
export type DailyParticipantMediaTrack = NonNullable<
  NonNullable<DailyParticipant["tracks"]>["audio"]
>;

export function getLiveVideoDateMediaTracks(
  stream: MediaStream | null | undefined,
): LiveVideoDateMediaTracks | null {
  const videoTrack = firstLiveTrack(stream?.getVideoTracks() ?? []);
  if (!videoTrack) return null;
  const audioTrack = firstLiveTrack(stream?.getAudioTracks() ?? []);
  if (!audioTrack) return null;
  return { videoTrack, audioTrack };
}

export function missingLiveVideoDateMediaTrackReason(
  stream: MediaStream | null | undefined,
): "missing_video_track" | "missing_audio_track" {
  return firstLiveTrack(stream?.getVideoTracks() ?? [])
    ? "missing_audio_track"
    : "missing_video_track";
}

export function requireLiveVideoDateMediaTracks(
  stream: MediaStream | null | undefined,
  source: string,
): LiveVideoDateMediaTracks {
  const videoTrack = firstLiveTrack(stream?.getVideoTracks() ?? []);
  if (!videoTrack) throw new Error(`${source} returned no live video track`);
  const audioTrack = firstLiveTrack(stream?.getAudioTracks() ?? []);
  if (!audioTrack) throw new Error(`${source} returned no live audio track`);
  return { videoTrack, audioTrack };
}

export function dailyTrackHasLiveMedia(
  track: DailyParticipantMediaTrack | undefined,
): boolean {
  if (track?.state !== "playable") return false;
  const mediaTrack = track?.persistentTrack;
  return Boolean(mediaTrack && mediaTrack.readyState !== "ended");
}

export function hasLiveDailyLocalCameraAndMicrophone(
  call: Pick<DailyCall, "participants">,
): boolean {
  const localParticipant = call.participants().local;
  return (
    dailyTrackHasLiveMedia(localParticipant?.tracks?.video) &&
    dailyTrackHasLiveMedia(localParticipant?.tracks?.audio)
  );
}

export type DailyReconnectState =
  | "connected"
  | "interrupted"
  | "partner_reconnecting"
  | "partner_left_grace"
  | "recovered"
  | "failed_after_grace";

export function tierFromNetworkQualityEvent(
  event: { threshold?: string; quality?: number } | undefined,
): VideoCallNetworkTier {
  const q = typeof event?.quality === "number" ? event.quality : 100;
  const th = event?.threshold;
  if (th === "low" || q < 30) return "poor";
  if (q < 70) return "fair";
  return "good";
}

export function withTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDailyMeetingState(
  call: DailyCall,
  expectedState: string,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const meetingState = readDailyMeetingState(call);
    if (meetingState === expectedState) return true;
    if (isTerminalDailyMeetingState(meetingState)) return false;
    await sleep(WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_POLL_MS);
  }
  return readDailyMeetingState(call) === expectedState;
}

export function normalizeCameraFacingMode(
  value: unknown,
): VideoDateCameraFacingMode | null {
  if (value === "user" || value === "environment") return value;
  return null;
}

export function oppositeCameraFacingMode(
  value: VideoDateCameraFacingMode | null,
): VideoDateCameraFacingMode | null {
  if (value === "user") return "environment";
  if (value === "environment") return "user";
  return null;
}

export function getDeviceId(
  device: WebCameraDevice | null | undefined,
): string | null {
  if (!device) return null;
  if (typeof device.deviceId === "string" && device.deviceId)
    return device.deviceId;
  if (typeof device.id === "string" && device.id) return device.id;
  return null;
}

export function inferCameraFacingModeFromLabel(
  label: unknown,
): VideoDateCameraFacingMode | null {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return "user";
  if (/\b(back|rear|environment|world)\b/.test(normalized))
    return "environment";
  return null;
}

export function getDeviceFacingMode(
  device: WebCameraDevice | null | undefined,
): VideoDateCameraFacingMode | null {
  if (!device) return null;
  return (
    normalizeCameraFacingMode(device.facingMode) ??
    normalizeCameraFacingMode(device.facing) ??
    inferCameraFacingModeFromLabel(device.label)
  );
}

export function getTrackDeviceId(
  track: MediaStreamTrack | null | undefined,
): string | null {
  if (!track || typeof track.getSettings !== "function") return null;
  const settings = track.getSettings();
  return typeof settings.deviceId === "string" && settings.deviceId
    ? settings.deviceId
    : null;
}

export function getTrackFacingMode(
  track: MediaStreamTrack | null | undefined,
): VideoDateCameraFacingMode | null {
  if (!track || typeof track.getSettings !== "function") return null;
  return (
    normalizeCameraFacingMode(track.getSettings().facingMode) ??
    inferCameraFacingModeFromLabel(track.label)
  );
}

export function getLocalVideoTrack(
  participant: DailyParticipant | undefined,
): MediaStreamTrack | null {
  return participant?.tracks?.video?.persistentTrack ?? null;
}

export function getLocalCameraSnapshot(
  participant: DailyParticipant | undefined,
): LocalCameraSnapshot {
  const track = getLocalVideoTrack(participant);
  return {
    trackId: track?.id ?? null,
    deviceId: getTrackDeviceId(track),
    facingMode: getTrackFacingMode(track),
    readyState: track?.readyState ?? null,
    enabled: typeof track?.enabled === "boolean" ? track.enabled : null,
  };
}

export async function enumerateWebVideoDevices(
  call: DailyCall,
): Promise<WebCameraDevice[]> {
  try {
    if (typeof call.enumerateDevices === "function") {
      const dailyDevices = await call.enumerateDevices();
      const devices = Array.isArray(dailyDevices?.devices)
        ? dailyDevices.devices
        : [];
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      if (videoDevices.length > 0) return videoDevices;
    }
  } catch {
    /* Fall back to browser enumeration below. */
  }

  try {
    const browserDevices = await navigator.mediaDevices?.enumerateDevices?.();
    return (browserDevices ?? []).filter(
      (device) => device.kind === "videoinput",
    );
  } catch {
    return [];
  }
}

export function chooseWebVideoDevice(
  devices: WebCameraDevice[],
  before: LocalCameraSnapshot,
  desiredFacing: VideoDateCameraFacingMode | null,
): WebCameraDevice | null {
  if (devices.length === 0) return null;
  const currentDeviceId = before.deviceId;
  const candidates = currentDeviceId
    ? devices.filter((device) => getDeviceId(device) !== currentDeviceId)
    : devices;
  if (currentDeviceId && candidates.length === 0) return null;
  if (desiredFacing) {
    const facingMatch = candidates.find(
      (device) => getDeviceFacingMode(device) === desiredFacing,
    );
    if (facingMatch) return facingMatch;
    if (!currentDeviceId) return null;
  }
  return currentDeviceId ? (candidates[0] ?? null) : null;
}

export function videoOnlyCameraSwitchConstraints(
  captureProfile: VideoDateWebMediaCaptureProfile,
  desiredFacing: VideoDateCameraFacingMode | null,
  deviceId?: string | null,
): MediaStreamConstraints {
  const constraints = videoDateWebMediaStreamConstraints(captureProfile);
  const video: MediaTrackConstraints =
    constraints.video && typeof constraints.video === "object"
      ? { ...constraints.video }
      : {};
  if (deviceId) {
    video.deviceId = { exact: deviceId };
  } else if (desiredFacing) {
    video.facingMode = { ideal: desiredFacing };
  }
  return { audio: false, video };
}

export function isWebKitCameraSwitchRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const vendor = navigator.vendor ?? "";
  const isiOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isSafari =
    /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
  return (
    isiOS || (/Apple/i.test(vendor) && /AppleWebKit/i.test(ua) && isSafari)
  );
}

export function readRemoteRenderFrameState(
  videoEl: HTMLVideoElement | null | undefined,
): RemoteRenderFrameState | null {
  if (!videoEl) return null;
  const extended = videoEl as HTMLVideoElement & {
    webkitDecodedFrameCount?: number;
  };
  let playbackQualityFrames: number | null = null;
  try {
    const quality =
      typeof videoEl.getVideoPlaybackQuality === "function"
        ? videoEl.getVideoPlaybackQuality()
        : null;
    playbackQualityFrames =
      typeof quality?.totalVideoFrames === "number" &&
      Number.isFinite(quality.totalVideoFrames)
        ? quality.totalVideoFrames
        : null;
  } catch {
    playbackQualityFrames = null;
  }
  const webkitFrames =
    typeof extended.webkitDecodedFrameCount === "number" &&
    Number.isFinite(extended.webkitDecodedFrameCount)
      ? extended.webkitDecodedFrameCount
      : null;
  return {
    currentTime:
      typeof videoEl.currentTime === "number" &&
      Number.isFinite(videoEl.currentTime)
        ? Number(videoEl.currentTime.toFixed(3))
        : null,
    decodedFrameCount: playbackQualityFrames ?? webkitFrames,
    readyState:
      typeof videoEl.readyState === "number" ? videoEl.readyState : null,
    videoWidth:
      typeof videoEl.videoWidth === "number" ? videoEl.videoWidth : null,
    videoHeight:
      typeof videoEl.videoHeight === "number" ? videoEl.videoHeight : null,
  };
}

export function hasRenderableRemoteFrame(
  state: RemoteRenderFrameState | null,
): boolean {
  return Boolean(
    state &&
    (state.readyState ?? 0) >= 2 &&
    (state.videoWidth ?? 0) > 0 &&
    (state.videoHeight ?? 0) > 0,
  );
}

export function hasFreshRemoteRenderFrame(
  baseline: RemoteRenderFrameState | null | undefined,
  latest: RemoteRenderFrameState | null,
  metadata?: RemoteVideoFrameCallbackMetadata,
): boolean {
  if (!hasRenderableRemoteFrame(latest)) return false;
  if (!baseline) return true;

  let comparedFreshSignals = false;
  if (
    typeof metadata?.presentedFrames === "number" &&
    typeof baseline.decodedFrameCount === "number"
  ) {
    comparedFreshSignals = true;
    if (metadata.presentedFrames > baseline.decodedFrameCount) return true;
  }
  if (
    typeof metadata?.mediaTime === "number" &&
    typeof baseline.currentTime === "number"
  ) {
    comparedFreshSignals = true;
    if (metadata.mediaTime > baseline.currentTime + 0.03) return true;
  }
  if (
    typeof latest?.decodedFrameCount === "number" &&
    typeof baseline.decodedFrameCount === "number"
  ) {
    comparedFreshSignals = true;
    if (latest.decodedFrameCount > baseline.decodedFrameCount) return true;
  }
  if (
    typeof latest?.currentTime === "number" &&
    typeof baseline.currentTime === "number"
  ) {
    comparedFreshSignals = true;
    if (latest.currentTime > baseline.currentTime + 0.03) return true;
    if (
      latest.currentTime < Math.max(0, baseline.currentTime - 0.25) &&
      latest.currentTime > 0.03
    ) {
      return true;
    }
  }
  if ((baseline.videoWidth ?? 0) <= 0 || (baseline.videoHeight ?? 0) <= 0)
    return true;
  if (metadata && !comparedFreshSignals) return true;
  return false;
}

export function describeCameraSwitchError(error: unknown): {
  name: string;
  message: string;
} {
  if (error instanceof Error)
    return { name: error.name || "Error", message: error.message };
  return { name: "unknown", message: String(error) };
}

export function isInvokeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out after/i.test(error.message);
}

export function buildStreamFromParticipant(
  p: DailyParticipant | undefined,
  opts: { includeAudio: boolean },
): MediaStream | null {
  const videoTrack = p?.tracks?.video?.persistentTrack;
  const audioTrack = p?.tracks?.audio?.persistentTrack;
  if (!videoTrack && !audioTrack) return null;
  const stream = new MediaStream();
  if (videoTrack) stream.addTrack(videoTrack);
  if (opts.includeAudio && audioTrack) stream.addTrack(audioTrack);
  return stream;
}

export function getTrackIdsKey(
  p: DailyParticipant | undefined,
  includeAudio: boolean,
): string {
  const videoId = p?.tracks?.video?.persistentTrack?.id ?? "";
  const audioId = includeAudio
    ? (p?.tracks?.audio?.persistentTrack?.id ?? "")
    : "";
  return `${videoId}|${audioId}`;
}

export function getParticipantIdentity(
  p: DailyParticipant | undefined,
): string | null {
  if (!p) return null;
  const participant = p as DailyParticipant & {
    user_id?: string;
    userId?: string;
  };
  return (
    participant.session_id ?? participant.user_id ?? participant.userId ?? null
  );
}

export function normalizeRemoteRenderRecoveryScope(scope: string): string {
  if (scope.startsWith("camera_switch_hint:")) return "camera_switch_hint";
  if (scope.includes("camera_switch_hint")) return "camera_switch_hint";
  if (scope.includes("participant_updated_same_track"))
    return "participant_updated_same_track";
  if (scope.includes("remote_render_recovery_followup"))
    return "remote_render_recovery_followup";
  return scope;
}

export function pruneRemoteRenderRecoveryAttempts(
  attempts: Map<string, RemoteRenderRecoveryAttemptEntry>,
  nowMs: number,
) {
  for (const [key, entry] of attempts) {
    if (nowMs - entry.updatedAtMs > REMOTE_RENDER_RECOVERY_ATTEMPT_TTL_MS)
      attempts.delete(key);
  }
  while (attempts.size > REMOTE_RENDER_RECOVERY_MAX_ATTEMPT_KEYS) {
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

export function streamHasTrackId(
  stream: MediaStream | null,
  trackId: string,
): boolean {
  if (!stream || !trackId) return false;
  return stream.getTracks().some((t) => t.id === trackId);
}

export function createRemotePlaybackState(): RemotePlaybackState {
  return {
    participantPresent: false,
    mediaAttached: false,
    playSucceeded: false,
    firstFrameRendered: false,
    playRejected: false,
    retryCount: 0,
  };
}

export function describeMediaError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

