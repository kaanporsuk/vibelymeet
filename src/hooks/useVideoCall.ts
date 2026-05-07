import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { emitWebVideoDateClientStuckState } from "@/lib/videoDateClientStuckObservability";
import {
  dailyVideoDateCallObjectOptions,
  dailyVideoDateCallObjectOptionsWithAppAcquiredMedia,
  videoDateWebMediaStreamConstraints,
} from "@/lib/dailyCallObjectConfig";
import {
  consumeWebVideoDateDailyPrewarm,
  markWebVideoDateDailyPrewarmFallback,
} from "@/lib/videoDateDailyPrewarm";
import {
  consumePreparedVideoDateEntry,
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import { markDailyJoinedWithBackoff } from "@clientShared/matching/dailyJoinedConfirmation";
import {
  classifyDailyRoomTokenFailureClass,
  type DailyRoomFailureKind,
} from "@clientShared/matching/dailyRoomFailure";
import type { PreparedVideoDateEntryCacheEntry } from "@clientShared/matching/videoDatePrepareEntry";
import {
  VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER,
  isVideoDateCameraConstraintError,
  videoDateAspectRatio,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import {
  createVideoDateCameraSwitchRenderHint,
  parseVideoDateCameraSwitchRenderHint,
} from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import { getVideoDatePermissionHandoff } from "@clientShared/matching/videoDatePermissionHandoff";

interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  eventId?: string;
  videoSessionState?: string;
  localDecisionPersisted?: boolean;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
  onPartnerTransientDisconnect?: () => void;
  onPartnerTransientRecover?: () => void;
}

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

const VIDEO_DATE_PREJOIN_TIMEOUT_MS = 12_000;
const FIRST_REMOTE_TIMEOUT_MS = 25_000;
const CREATE_DATE_ROOM_RETRY_DELAYS_MS = [700, 1_600] as const;
const DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000;
const REMOTE_RENDER_VALIDATION_DELAY_MS = 650;
const REMOTE_RENDER_FRAME_TIMEOUT_MS = 1_400;
const REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK = 4;
const REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE = 2;
const REMOTE_RENDER_RECOVERY_ATTEMPT_TTL_MS = 30_000;
const REMOTE_RENDER_RECOVERY_MAX_ATTEMPT_KEYS = 24;
const CAMERA_SWITCH_COMMIT_TIMEOUT_MS = 1_800;
const CAMERA_SWITCH_COMMIT_POLL_MS = 80;
const REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS = 8_000;
// Camera-switch fresh-frame watchdog must be long enough to span Daily's
// keyframe interval on cellular/Safari paths. Falling back to teardown before
// a natural keyframe arrives causes the receiver to go black until the next
// GOP, which is the original bug we are fixing.
const REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS = 3_000;

type RemoteVideoFrameCallbackMetadata = {
  presentedFrames?: number;
  mediaTime?: number;
  width?: number;
  height?: number;
};

type RemoteVideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: RemoteVideoFrameCallbackMetadata) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type RemoteRenderRecoveryAttemptEntry = {
  attempts: number;
  updatedAtMs: number;
};

type RemoteRenderValidationOptions = {
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

type RemoteRenderFrameState = {
  currentTime: number | null;
  decodedFrameCount: number | null;
  readyState: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
};

type RemoteCameraSwitchRenderWatch = {
  switchId: string;
  expiresAtMs: number;
};

type VideoDateCameraFacingMode = "user" | "environment";

type WebCameraSwitchCommitMethod = "cycle_camera" | "set_input_device" | "video_source";

type WebCameraDevice = Partial<MediaDeviceInfo> & {
  facing?: unknown;
  facingMode?: unknown;
  id?: unknown;
  label?: unknown;
};

type LocalCameraSnapshot = {
  trackId: string | null;
  deviceId: string | null;
  facingMode: VideoDateCameraFacingMode | null;
  readyState: MediaStreamTrackState | null;
  enabled: boolean | null;
};

type WebCameraSwitchCommit = LocalCameraSnapshot & {
  method: WebCameraSwitchCommitMethod;
  latencyMs: number;
  publishRefreshApplied: boolean;
};

type AppAcquiredVideoDateMedia = {
  stream: MediaStream;
  captureProfile: VideoDateWebMediaCaptureProfile;
  acquiredAtMs: number;
  consumedByDaily: boolean;
};

function summarizeVideoTrackSettings(track: MediaStreamTrack | null | undefined) {
  if (!track || typeof track.getSettings !== "function") return null;
  const settings = track.getSettings();
  return {
    deviceId: typeof settings.deviceId === "string" ? settings.deviceId : null,
    width: typeof settings.width === "number" ? settings.width : null,
    height: typeof settings.height === "number" ? settings.height : null,
    aspectRatio: videoDateAspectRatio(settings.width, settings.height),
    frameRate: typeof settings.frameRate === "number" ? settings.frameRate : null,
    facingMode: typeof settings.facingMode === "string" ? settings.facingMode : null,
  };
}

function summarizeWebRuntime() {
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
  const isSafari = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
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

function stopMediaStreamTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* best-effort cleanup */
    }
  });
}

function firstLiveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  return tracks.find((track) => track.readyState !== "ended") ?? null;
}

type VideoDateTruthRow = {
  id: string;
  event_id: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
  handshake_started_at: string | null;
  daily_room_name: string | null;
  daily_room_url?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
};

type DailyRoomSuccessResponse = {
  room_name: string;
  room_url: string;
  token: string;
  token_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_verify_skipped?: boolean;
};

export type VideoCallStartFailure = {
  kind: DailyRoomFailureKind | "daily_join_failed" | "media_permission_denied" | "session_unavailable";
  retryable: boolean;
  httpStatus?: number;
  serverCode?: string;
};

export type VideoCallStartResult =
  | { ok: true }
  | {
      ok: false;
      failure: VideoCallStartFailure;
    };

export type DailyReconnectState =
  | "connected"
  | "interrupted"
  | "partner_reconnecting"
  | "partner_left_grace"
  | "recovered"
  | "failed_after_grace";

function tierFromNetworkQualityEvent(event: { threshold?: string; quality?: number } | undefined): VideoCallNetworkTier {
  const q = typeof event?.quality === "number" ? event.quality : 100;
  const th = event?.threshold;
  if (th === "low" || q < 30) return "poor";
  if (q < 70) return "fair";
  return "good";
}

function withTimeout<T>(operation: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
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
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCameraFacingMode(value: unknown): VideoDateCameraFacingMode | null {
  if (value === "user" || value === "environment") return value;
  return null;
}

function oppositeCameraFacingMode(value: VideoDateCameraFacingMode | null): VideoDateCameraFacingMode | null {
  if (value === "user") return "environment";
  if (value === "environment") return "user";
  return null;
}

function getDeviceId(device: WebCameraDevice | null | undefined): string | null {
  if (!device) return null;
  if (typeof device.deviceId === "string" && device.deviceId) return device.deviceId;
  if (typeof device.id === "string" && device.id) return device.id;
  return null;
}

function inferCameraFacingModeFromLabel(label: unknown): VideoDateCameraFacingMode | null {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return "user";
  if (/\b(back|rear|environment|world)\b/.test(normalized)) return "environment";
  return null;
}

function getDeviceFacingMode(device: WebCameraDevice | null | undefined): VideoDateCameraFacingMode | null {
  if (!device) return null;
  return (
    normalizeCameraFacingMode(device.facingMode) ??
    normalizeCameraFacingMode(device.facing) ??
    inferCameraFacingModeFromLabel(device.label)
  );
}

function getTrackDeviceId(track: MediaStreamTrack | null | undefined): string | null {
  if (!track || typeof track.getSettings !== "function") return null;
  const settings = track.getSettings();
  return typeof settings.deviceId === "string" && settings.deviceId ? settings.deviceId : null;
}

function getTrackFacingMode(track: MediaStreamTrack | null | undefined): VideoDateCameraFacingMode | null {
  if (!track || typeof track.getSettings !== "function") return null;
  return normalizeCameraFacingMode(track.getSettings().facingMode) ?? inferCameraFacingModeFromLabel(track.label);
}

function getLocalVideoTrack(participant: DailyParticipant | undefined): MediaStreamTrack | null {
  return participant?.tracks?.video?.persistentTrack ?? null;
}

function getLocalCameraSnapshot(participant: DailyParticipant | undefined): LocalCameraSnapshot {
  const track = getLocalVideoTrack(participant);
  return {
    trackId: track?.id ?? null,
    deviceId: getTrackDeviceId(track),
    facingMode: getTrackFacingMode(track),
    readyState: track?.readyState ?? null,
    enabled: typeof track?.enabled === "boolean" ? track.enabled : null,
  };
}

async function enumerateWebVideoDevices(call: DailyCall): Promise<WebCameraDevice[]> {
  try {
    if (typeof call.enumerateDevices === "function") {
      const dailyDevices = await call.enumerateDevices();
      const devices = Array.isArray(dailyDevices?.devices) ? dailyDevices.devices : [];
      const videoDevices = devices.filter((device) => device.kind === "videoinput");
      if (videoDevices.length > 0) return videoDevices;
    }
  } catch {
    /* Fall back to browser enumeration below. */
  }

  try {
    const browserDevices = await navigator.mediaDevices?.enumerateDevices?.();
    return (browserDevices ?? []).filter((device) => device.kind === "videoinput");
  } catch {
    return [];
  }
}

function chooseWebVideoDevice(
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
    const facingMatch = candidates.find((device) => getDeviceFacingMode(device) === desiredFacing);
    if (facingMatch) return facingMatch;
    if (!currentDeviceId) return null;
  }
  return currentDeviceId ? candidates[0] ?? null : null;
}

function videoOnlyCameraSwitchConstraints(
  captureProfile: VideoDateWebMediaCaptureProfile,
  desiredFacing: VideoDateCameraFacingMode | null,
  deviceId?: string | null,
): MediaStreamConstraints {
  const constraints = videoDateWebMediaStreamConstraints(captureProfile);
  const video: MediaTrackConstraints =
    constraints.video && typeof constraints.video === "object" ? { ...constraints.video } : {};
  if (deviceId) {
    video.deviceId = { exact: deviceId };
  } else if (desiredFacing) {
    video.facingMode = { ideal: desiredFacing };
  }
  return { audio: false, video };
}

function isWebKitCameraSwitchRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  const vendor = navigator.vendor ?? "";
  const isiOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
  return isiOS || (/Apple/i.test(vendor) && /AppleWebKit/i.test(ua) && isSafari);
}

function readRemoteRenderFrameState(videoEl: HTMLVideoElement | null | undefined): RemoteRenderFrameState | null {
  if (!videoEl) return null;
  const extended = videoEl as HTMLVideoElement & {
    webkitDecodedFrameCount?: number;
  };
  let playbackQualityFrames: number | null = null;
  try {
    const quality =
      typeof videoEl.getVideoPlaybackQuality === "function" ? videoEl.getVideoPlaybackQuality() : null;
    playbackQualityFrames =
      typeof quality?.totalVideoFrames === "number" && Number.isFinite(quality.totalVideoFrames)
        ? quality.totalVideoFrames
        : null;
  } catch {
    playbackQualityFrames = null;
  }
  const webkitFrames =
    typeof extended.webkitDecodedFrameCount === "number" && Number.isFinite(extended.webkitDecodedFrameCount)
      ? extended.webkitDecodedFrameCount
      : null;
  return {
    currentTime:
      typeof videoEl.currentTime === "number" && Number.isFinite(videoEl.currentTime)
        ? Number(videoEl.currentTime.toFixed(3))
        : null,
    decodedFrameCount: playbackQualityFrames ?? webkitFrames,
    readyState: typeof videoEl.readyState === "number" ? videoEl.readyState : null,
    videoWidth: typeof videoEl.videoWidth === "number" ? videoEl.videoWidth : null,
    videoHeight: typeof videoEl.videoHeight === "number" ? videoEl.videoHeight : null,
  };
}

function hasRenderableRemoteFrame(state: RemoteRenderFrameState | null): boolean {
  return Boolean(
    state &&
      (state.readyState ?? 0) >= 2 &&
      (state.videoWidth ?? 0) > 0 &&
      (state.videoHeight ?? 0) > 0
  );
}

function hasFreshRemoteRenderFrame(
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
  if (typeof metadata?.mediaTime === "number" && typeof baseline.currentTime === "number") {
    comparedFreshSignals = true;
    if (metadata.mediaTime > baseline.currentTime + 0.03) return true;
  }
  if (typeof latest?.decodedFrameCount === "number" && typeof baseline.decodedFrameCount === "number") {
    comparedFreshSignals = true;
    if (latest.decodedFrameCount > baseline.decodedFrameCount) return true;
  }
  if (typeof latest?.currentTime === "number" && typeof baseline.currentTime === "number") {
    comparedFreshSignals = true;
    if (latest.currentTime > baseline.currentTime + 0.03) return true;
    if (latest.currentTime < Math.max(0, baseline.currentTime - 0.25) && latest.currentTime > 0.03) {
      return true;
    }
  }
  if ((baseline.videoWidth ?? 0) <= 0 || (baseline.videoHeight ?? 0) <= 0) return true;
  if (metadata && !comparedFreshSignals) return true;
  return false;
}

function describeCameraSwitchError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || "Error", message: error.message };
  return { name: "unknown", message: String(error) };
}

function isInvokeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out after/i.test(error.message);
}

function buildStreamFromParticipant(
  p: DailyParticipant | undefined,
  opts: { includeAudio: boolean }
): MediaStream | null {
  const videoTrack = p?.tracks?.video?.persistentTrack;
  const audioTrack = p?.tracks?.audio?.persistentTrack;
  if (!videoTrack && !audioTrack) return null;
  const stream = new MediaStream();
  if (videoTrack) stream.addTrack(videoTrack);
  if (opts.includeAudio && audioTrack) stream.addTrack(audioTrack);
  return stream;
}

function getTrackIdsKey(p: DailyParticipant | undefined, includeAudio: boolean): string {
  const videoId = p?.tracks?.video?.persistentTrack?.id ?? "";
  const audioId = includeAudio ? (p?.tracks?.audio?.persistentTrack?.id ?? "") : "";
  return `${videoId}|${audioId}`;
}

function getParticipantIdentity(p: DailyParticipant | undefined): string | null {
  if (!p) return null;
  const participant = p as DailyParticipant & { user_id?: string; userId?: string };
  return participant.session_id ?? participant.user_id ?? participant.userId ?? null;
}

function normalizeRemoteRenderRecoveryScope(scope: string): string {
  if (scope.startsWith("camera_switch_hint:")) return "camera_switch_hint";
  if (scope.includes("camera_switch_hint")) return "camera_switch_hint";
  if (scope.includes("participant_updated_same_track")) return "participant_updated_same_track";
  if (scope.includes("remote_render_recovery_followup")) return "remote_render_recovery_followup";
  return scope;
}

function pruneRemoteRenderRecoveryAttempts(
  attempts: Map<string, RemoteRenderRecoveryAttemptEntry>,
  nowMs: number
) {
  for (const [key, entry] of attempts) {
    if (nowMs - entry.updatedAtMs > REMOTE_RENDER_RECOVERY_ATTEMPT_TTL_MS) attempts.delete(key);
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

function streamHasTrackId(stream: MediaStream | null, trackId: string): boolean {
  if (!stream || !trackId) return false;
  return stream.getTracks().some((t) => t.id === trackId);
}

function createRemotePlaybackState(): RemotePlaybackState {
  return {
    participantPresent: false,
    mediaAttached: false,
    playSucceeded: false,
    firstFrameRendered: false,
    playRejected: false,
    retryCount: 0,
  };
}

function describeMediaError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [networkTier, setNetworkTier] = useState<VideoCallNetworkTier>("good");
  const [remotePlayback, setRemotePlayback] = useState<RemotePlaybackState>(() => createRemotePlaybackState());
  const [peerMissing, setPeerMissing] = useState<PeerMissingState>({ terminal: false });
  const [dailyReconnectState, setDailyReconnectState] = useState<DailyReconnectState>("connected");
  const [reconnectGraceTimeLeft, setReconnectGraceTimeLeft] = useState(0);
  const [mediaPermissionError, setMediaPermissionError] = useState<string | null>(null);
  const [captureProfile, setCaptureProfile] = useState<VideoDateWebMediaCaptureProfile>("ideal");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  const firstRemoteObservedRef = useRef(false);
  const localVideoReadyTrackedRef = useRef(false);
  const remoteFirstFrameTrackedRef = useRef(false);
  const lastLocalTrackIdsRef = useRef<string>("");
  const lastLocalStreamRef = useRef<MediaStream | null>(null);
  const lastRemoteTrackIdsRef = useRef<string>("");
  const lastRemoteStreamRef = useRef<MediaStream | null>(null);
  const lastLocalMountedTrackKeyRef = useRef<string>("");
  const lastRemoteMountedTrackKeyRef = useRef<string>("");
  const firstRemoteWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noRemoteAutoRecoveryCountRef = useRef(0);
  const remoteRenderValidationDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRenderValidationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRenderValidationFrameCallbackRef = useRef<number | null>(null);
  const remoteRenderValidationSeqRef = useRef(0);
  const remoteRenderRecoveryReattachTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRenderRecoveryTrackAttemptsRef = useRef<Map<string, RemoteRenderRecoveryAttemptEntry>>(new Map());
  const remoteRenderRecoveryScopedAttemptsRef = useRef<Map<string, RemoteRenderRecoveryAttemptEntry>>(new Map());
  const remoteRenderRecoveryInFlightRef = useRef<{
    trackKey: string;
    scopeKey: string;
    trackAttempt: number;
    scopeAttempt: number;
    source: string;
  } | null>(null);
  const scheduleRemoteRenderValidationRef = useRef<
    ((
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope?: string,
      options?: RemoteRenderValidationOptions
    ) => void) | null
  >(null);
  const lastRemoteRenderParticipantIdRef = useRef<string | null>(null);
  const startAttemptNonceRef = useRef(0);
  const startCallInFlightSessionRef = useRef<string | null>(null);
  const activeCallSessionIdRef = useRef<string | null>(null);
  const latestLocalParticipantRef = useRef<DailyParticipant | undefined>(undefined);
  const latestRemoteParticipantRef = useRef<DailyParticipant | undefined>(undefined);
  const cameraSwitchInFlightRef = useRef(false);
  const lastRemoteCameraSwitchHintIdRef = useRef<string | null>(null);
  const activeRemoteCameraSwitchRenderWatchRef = useRef<RemoteCameraSwitchRenderWatch | null>(null);
  const reconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectGraceTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRecoveryResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectGraceActiveRef = useRef(false);
  const reconnectPartnerAwayTriggeredRef = useRef(false);
  const reconnectSyncRequestedRef = useRef(false);
  const mediaPermissionDeniedRef = useRef(false);
  const playbackBlockedRef = useRef(false);
  const captureProfileRef = useRef<VideoDateWebMediaCaptureProfile>("ideal");
  const activePreparedEntryCacheRef = useRef<PreparedVideoDateEntryCacheEntry | null>(null);
  const activePreparedEntryCacheHitRef = useRef<boolean | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);
  const dailySdkUnresponsiveKeyRef = useRef<string | null>(null);
  const appAcquiredMediaRef = useRef<AppAcquiredVideoDateMedia | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!isConnecting && !isConnected) {
      dailySdkUnresponsiveKeyRef.current = null;
      return;
    }

    const emitUnresponsive = (reason: string, meetingState: string | null, error?: unknown) => {
      const sessionId = optionsRef.current?.roomId ?? null;
      const key = `${sessionId ?? "unknown"}:${reason}:${meetingState ?? "none"}`;
      if (dailySdkUnresponsiveKeyRef.current === key) return;
      dailySdkUnresponsiveKeyRef.current = key;
      const payload = {
        platform: "web",
        session_id: sessionId,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "daily_sdk_heartbeat",
        reason,
        daily_meeting_state: meetingState,
        connected: isConnected,
        connecting: isConnecting,
      };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_SDK_UNRESPONSIVE, payload);
      Sentry.captureMessage("video_date_daily_sdk_unresponsive", {
        level: "warning",
        extra: {
          ...payload,
          error: error instanceof Error ? { name: error.name, message: error.message } : error ?? null,
        },
      });
    };

    const intervalId = setInterval(() => {
      const call = callObjectRef.current as (DailyCall & { meetingState?: () => unknown }) | null;
      if (!call || typeof call.meetingState !== "function") return;
      let meetingState: string | null = null;
      try {
        const state = call.meetingState();
        meetingState = typeof state === "string" ? state : state == null ? null : String(state);
      } catch (error) {
        emitUnresponsive("meeting_state_throw", null, error);
        return;
      }
      if (meetingState === "error" || (isConnected && meetingState === "left-meeting")) {
        emitUnresponsive("unexpected_meeting_state", meetingState);
      }
    }, 5_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected, isConnecting]);

  const markRemoteFirstFrameRendered = useCallback((source: string) => {
    setRemotePlayback((prev) => {
      if (prev.firstFrameRendered) return prev;
      return {
        ...prev,
        mediaAttached: true,
        playRejected: false,
        firstFrameRendered: true,
      };
    });

    const currentOptions = optionsRef.current;
    if (remoteFirstFrameTrackedRef.current || !currentOptions?.roomId) return;
    const sessionId = currentOptions.roomId;
    remoteFirstFrameTrackedRef.current = true;

    const nowMs = Date.now();
    const entry = activePreparedEntryCacheRef.current;
    const bothReadyToFirstRemoteFrameMs =
      entry?.bothReadyObservedAtMs == null ? null : Math.max(0, nowMs - entry.bothReadyObservedAtMs);
    vdbg("daily_remote_first_frame_rendered", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      source,
      bothReadyToFirstRemoteFrameMs,
    });
    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: currentOptions.eventId ?? null,
      sourceSurface: "video_date_daily",
      checkpoint: "first_remote_frame",
      nowMs,
      entryAttemptId: entry?.entryAttemptId ?? entry?.value.entry_attempt_id ?? null,
      videoDateTraceId: entry?.value.video_date_trace_id ?? entry?.entryAttemptId ?? null,
      cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: latencyContext,
        checkpoint: "first_remote_frame",
        sourceAction: source,
        outcome: "success",
        durationMs: bothReadyToFirstRemoteFrameMs,
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME, {
      platform: "web",
      session_id: sessionId,
      event_id: currentOptions.eventId ?? null,
      source_surface: "video_date_daily",
      source_action: source,
      source,
      bothReadyToFirstRemoteFrameMs,
      duration_ms: bothReadyToFirstRemoteFrameMs,
      latency_bucket: bucketVideoDateLatencyMs(bothReadyToFirstRemoteFrameMs),
    });
  }, []);

  const attachTracks = useCallback(
    (participant: DailyParticipant | undefined, videoEl: HTMLVideoElement | null, isLocal: boolean) => {
      if (!isLocal && participant) {
        setRemotePlayback((prev) => ({ ...prev, participantPresent: true }));
      }
      if (!videoEl || !participant?.tracks) return;
      const stream = new MediaStream();
      const videoTrack = participant.tracks.video?.persistentTrack;
      const audioTrack = participant.tracks.audio?.persistentTrack;
      const remoteTrackKey = isLocal ? "" : getTrackIdsKey(participant, true);
      if (videoTrack) stream.addTrack(videoTrack);
      if (audioTrack && !isLocal) stream.addTrack(audioTrack);
      const hasRemoteMedia = !isLocal && (Boolean(videoTrack) || Boolean(audioTrack));
      try {
        videoEl.srcObject = stream;
        if (!isLocal) {
          setRemotePlayback((prev) => ({
            ...prev,
            participantPresent: true,
            mediaAttached: hasRemoteMedia,
            playRejected: hasRemoteMedia ? false : prev.playRejected,
            error: hasRemoteMedia ? undefined : prev.error,
          }));
          if (hasRemoteMedia) {
            videoEl.addEventListener("loadeddata", () => markRemoteFirstFrameRendered("loadeddata"), { once: true });
            videoEl.addEventListener("playing", () => markRemoteFirstFrameRendered("playing"), { once: true });
          }
          const playPromise = videoEl.play();
          if (playPromise && typeof playPromise.then === "function") {
            void playPromise
              .then(() => {
                const recoveredFromBlock = playbackBlockedRef.current;
                playbackBlockedRef.current = false;
                if (!isLocal && remoteTrackKey) {
                  const recovery = remoteRenderRecoveryInFlightRef.current;
                  if (recovery?.trackKey === remoteTrackKey) {
                    vdbg("daily_remote_render_recovery_play_resolved", {
                      sessionId: optionsRef.current?.roomId ?? null,
                      eventId: optionsRef.current?.eventId ?? null,
                      userId: optionsRef.current?.userId ?? null,
                      participantSessionId: participant.session_id ?? null,
                      videoTrackId: videoTrack?.id ?? null,
                      audioTrackId: audioTrack?.id ?? null,
                      source: recovery.source,
                      scopeKey: recovery.scopeKey,
                      trackAttempt: recovery.trackAttempt,
                      scopeAttempt: recovery.scopeAttempt,
                      videoElementReadyState: videoEl.readyState,
                      videoElementWidth: videoEl.videoWidth,
                      videoElementHeight: videoEl.videoHeight,
                    });
                  }
                }
                setRemotePlayback((prev) => ({
                  ...prev,
                  playSucceeded: true,
                  playRejected: false,
                  error: undefined,
                }));
                if (recoveredFromBlock) {
                  trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RECOVERED, {
                    platform: "web",
                    session_id: optionsRef.current?.roomId ?? null,
                    event_id: optionsRef.current?.eventId ?? null,
                  });
                }
              })
              .catch((error: unknown) => {
                playbackBlockedRef.current = true;
                if (!isLocal && remoteTrackKey) {
                  const recovery = remoteRenderRecoveryInFlightRef.current;
                  if (recovery?.trackKey === remoteTrackKey) {
                    vdbg("daily_remote_render_recovery_failed", {
                      sessionId: optionsRef.current?.roomId ?? null,
                      eventId: optionsRef.current?.eventId ?? null,
                      userId: optionsRef.current?.userId ?? null,
                      participantSessionId: participant.session_id ?? null,
                      videoTrackId: videoTrack?.id ?? null,
                      audioTrackId: audioTrack?.id ?? null,
                      source: recovery.source,
                      scopeKey: recovery.scopeKey,
                      trackAttempt: recovery.trackAttempt,
                      scopeAttempt: recovery.scopeAttempt,
                      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
                    });
                    remoteRenderRecoveryInFlightRef.current = null;
                  }
                }
                setRemotePlayback((prev) => ({
                  ...prev,
                  playSucceeded: false,
                  playRejected: true,
                  error: describeMediaError(error),
                }));
                vdbg("daily_remote_video_play_rejected", {
                  sessionId: optionsRef.current?.roomId ?? null,
                  eventId: optionsRef.current?.eventId ?? null,
                  userId: optionsRef.current?.userId ?? null,
                  participantSessionId: participant.session_id ?? null,
                  videoTrackId: videoTrack?.id ?? null,
                  audioTrackId: audioTrack?.id ?? null,
                  error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
                });
                trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_PLAYBACK_REQUIRES_GESTURE, {
                  platform: "web",
                  session_id: optionsRef.current?.roomId ?? null,
                  event_id: optionsRef.current?.eventId ?? null,
                });
                trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
                  platform: "web",
                  session_id: optionsRef.current?.roomId ?? null,
                  event_id: optionsRef.current?.eventId ?? null,
                  reason: error instanceof Error ? error.name : "play_rejected",
                });
              });
          }
        }
      } catch (error) {
        if (!isLocal) {
          setRemotePlayback((prev) => ({
            ...prev,
            mediaAttached: false,
            playRejected: true,
            error: describeMediaError(error),
          }));
        }
        vdbg(isLocal ? "daily_local_video_attach_failed" : "daily_remote_video_attach_failed", {
          sessionId: optionsRef.current?.roomId ?? null,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          participantSessionId: participant.session_id ?? null,
          videoTrackId: videoTrack?.id ?? null,
          audioTrackId: isLocal ? null : (audioTrack?.id ?? null),
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    },
    [markRemoteFirstFrameRendered]
  );

  const needsTrackReattach = useCallback(
    (videoEl: HTMLVideoElement | null, participant: DailyParticipant | undefined, isLocal: boolean) => {
      if (!videoEl || !participant?.tracks) return false;

      const expectedVideoId = participant.tracks.video?.persistentTrack?.id ?? "";
      const expectedAudioId = isLocal ? "" : (participant.tracks.audio?.persistentTrack?.id ?? "");
      if (!expectedVideoId && !expectedAudioId) return false;

      const current = videoEl.srcObject as MediaStream | null;
      if (!current) return true;

      const hasExpectedVideo = !expectedVideoId || streamHasTrackId(current, expectedVideoId);
      const hasExpectedAudio = !expectedAudioId || streamHasTrackId(current, expectedAudioId);
      return !(hasExpectedVideo && hasExpectedAudio);
    },
    []
  );

  const logTrackMounted = useCallback(
    (
      source: string,
      opts: { isLocal: boolean; participant: DailyParticipant | undefined; roomName: string | null }
    ) => {
      const videoTrack = opts.participant?.tracks?.video?.persistentTrack;
      const videoTrackId = videoTrack?.id ?? "";
      const audioTrackId = opts.isLocal
        ? ""
        : (opts.participant?.tracks?.audio?.persistentTrack?.id ?? "");
      const mountedKey = `${videoTrackId}|${audioTrackId}`;
      if (!mountedKey || mountedKey === "|") return;

      const mountedRef = opts.isLocal ? lastLocalMountedTrackKeyRef : lastRemoteMountedTrackKeyRef;
      if (mountedRef.current === mountedKey) return;
      mountedRef.current = mountedKey;

      vdbg(opts.isLocal ? "daily_local_track_mounted" : "daily_remote_track_mounted", {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        roomName: opts.roomName,
        source,
        captureProfile: captureProfileRef.current,
        videoTrackId: videoTrackId || null,
        videoTrack: summarizeVideoTrackSettings(videoTrack),
        audioTrackId: audioTrackId || null,
      });
    },
    []
  );

  const clearFirstRemoteWatchdog = useCallback(() => {
    if (!firstRemoteWatchdogRef.current) return;
    clearTimeout(firstRemoteWatchdogRef.current);
    firstRemoteWatchdogRef.current = null;
  }, []);

  const remoteRenderDiagnostics = useCallback(
    (participant: DailyParticipant | undefined, videoEl: HTMLVideoElement | null) => {
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      const audioTrack = participant?.tracks?.audio?.persistentTrack;
      return {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        participantSessionId: participant?.session_id ?? null,
        remoteTrackKey: getTrackIdsKey(participant, true) || null,
        videoTrackId: videoTrack?.id ?? null,
        audioTrackId: audioTrack?.id ?? null,
        videoTrackReadyState: videoTrack?.readyState ?? null,
        videoTrackMuted: typeof videoTrack?.muted === "boolean" ? videoTrack.muted : null,
        videoTrackEnabled: typeof videoTrack?.enabled === "boolean" ? videoTrack.enabled : null,
        videoElementReadyState: videoEl?.readyState ?? null,
        videoElementPaused: videoEl?.paused ?? null,
        videoElementWidth: videoEl?.videoWidth ?? null,
        videoElementHeight: videoEl?.videoHeight ?? null,
        videoElementCurrentTime:
          typeof videoEl?.currentTime === "number" ? Number(videoEl.currentTime.toFixed(3)) : null,
      };
    },
    []
  );

  const resetRemoteRenderRecoveryAttempts = useCallback(() => {
    remoteRenderRecoveryTrackAttemptsRef.current.clear();
    remoteRenderRecoveryScopedAttemptsRef.current.clear();
    remoteRenderRecoveryInFlightRef.current = null;
  }, []);

  const clearRemoteRenderValidation = useCallback((options?: { cancelReattach?: boolean }) => {
    remoteRenderValidationSeqRef.current += 1;
    if (remoteRenderValidationDelayRef.current) {
      clearTimeout(remoteRenderValidationDelayRef.current);
      remoteRenderValidationDelayRef.current = null;
    }
    if (remoteRenderValidationTimeoutRef.current) {
      clearTimeout(remoteRenderValidationTimeoutRef.current);
      remoteRenderValidationTimeoutRef.current = null;
    }
    const videoEl = remoteVideoRef.current as RemoteVideoElementWithFrameCallback | null;
    if (
      videoEl &&
      remoteRenderValidationFrameCallbackRef.current != null &&
      typeof videoEl.cancelVideoFrameCallback === "function"
    ) {
      videoEl.cancelVideoFrameCallback(remoteRenderValidationFrameCallbackRef.current);
    }
    remoteRenderValidationFrameCallbackRef.current = null;
    if (options?.cancelReattach !== false && remoteRenderRecoveryReattachTimeoutRef.current) {
      clearTimeout(remoteRenderRecoveryReattachTimeoutRef.current);
      remoteRenderRecoveryReattachTimeoutRef.current = null;
    }
  }, []);

  const resetRemoteRenderRecoveryForParticipant = useCallback((participant: DailyParticipant | undefined) => {
    const participantId = getParticipantIdentity(participant);
    if (!participantId || participantId === lastRemoteRenderParticipantIdRef.current) return;
    lastRemoteRenderParticipantIdRef.current = participantId;
    resetRemoteRenderRecoveryAttempts();
  }, [resetRemoteRenderRecoveryAttempts]);

  const forceRemoteMediaReattach = useCallback(
    (
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope = source,
      validationOptions: RemoteRenderValidationOptions = {},
    ) => {
      const videoEl = remoteVideoRef.current;
      const remoteKey = getTrackIdsKey(participant, true);
      const scopeKey = normalizeRemoteRenderRecoveryScope(recoveryScope);
      const scopedAttemptKey = `${remoteKey}:${scopeKey}`;
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      if (!videoEl || !participant?.tracks || !remoteKey || !videoTrack) {
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: !videoEl ? "missing_video_element" : !remoteKey || !videoTrack ? "missing_video_track" : "missing_tracks",
        });
        return;
      }

      const currentRecovery = remoteRenderRecoveryInFlightRef.current;
      if (
        currentRecovery?.trackKey === remoteKey &&
        currentRecovery.scopeKey === scopeKey &&
        validationOptions.recoveryFollowUp !== true
      ) {
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: "recovery_already_in_flight",
          recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
          trackAttempt: currentRecovery.trackAttempt,
          scopeAttempt: currentRecovery.scopeAttempt,
          originalSource: currentRecovery.source,
        });
        return;
      }

      const nowMs = Date.now();
      pruneRemoteRenderRecoveryAttempts(remoteRenderRecoveryTrackAttemptsRef.current, nowMs);
      pruneRemoteRenderRecoveryAttempts(remoteRenderRecoveryScopedAttemptsRef.current, nowMs);
      const trackAttempts = remoteRenderRecoveryTrackAttemptsRef.current.get(remoteKey)?.attempts ?? 0;
      const scopeAttempts = remoteRenderRecoveryScopedAttemptsRef.current.get(scopedAttemptKey)?.attempts ?? 0;
      // Camera-switch hints get a single last-resort reattach. The freshness
      // watchdog already gave the natural keyframe ~3s to arrive; if it
      // didn't, one teardown-and-rebind is enough. A second one would just
      // produce another black-screen window.
      const maxScopeAttemptsForScope =
        scopeKey === "camera_switch_hint" ? 1 : REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE;
      if (
        trackAttempts >= REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK ||
        scopeAttempts >= maxScopeAttemptsForScope
      ) {
        if (remoteRenderRecoveryInFlightRef.current?.trackKey === remoteKey) {
          remoteRenderRecoveryInFlightRef.current = null;
        }
        if (remoteRenderRecoveryReattachTimeoutRef.current) {
          clearTimeout(remoteRenderRecoveryReattachTimeoutRef.current);
          remoteRenderRecoveryReattachTimeoutRef.current = null;
        }
        vdbg("daily_remote_render_recovery_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          scopeKey,
          reason: "max_attempts_exhausted",
          trackAttempts,
          scopeAttempts,
          maxTrackAttempts: REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK,
          maxScopeAttempts: maxScopeAttemptsForScope,
        });
        setRemotePlayback((prev) => ({
          ...prev,
          mediaAttached: true,
          playSucceeded: false,
          playRejected: true,
          error: "Remote video paused. Tap to resume.",
        }));
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
          platform: "web",
          session_id: optionsRef.current?.roomId ?? null,
          event_id: optionsRef.current?.eventId ?? null,
          reason: "remote_render_recovery_exhausted",
        });
        return;
      }

      const nextTrackAttempt = trackAttempts + 1;
      const nextScopeAttempt = scopeAttempts + 1;
      remoteRenderRecoveryTrackAttemptsRef.current.set(remoteKey, {
        attempts: nextTrackAttempt,
        updatedAtMs: nowMs,
      });
      remoteRenderRecoveryScopedAttemptsRef.current.set(scopedAttemptKey, {
        attempts: nextScopeAttempt,
        updatedAtMs: nowMs,
      });
      pruneRemoteRenderRecoveryAttempts(remoteRenderRecoveryTrackAttemptsRef.current, nowMs);
      pruneRemoteRenderRecoveryAttempts(remoteRenderRecoveryScopedAttemptsRef.current, nowMs);
      remoteRenderRecoveryInFlightRef.current = {
        trackKey: remoteKey,
        scopeKey,
        trackAttempt: nextTrackAttempt,
        scopeAttempt: nextScopeAttempt,
        source,
      };
      clearRemoteRenderValidation({ cancelReattach: true });

      vdbg("daily_remote_render_recovery_started", {
        ...remoteRenderDiagnostics(participant, videoEl),
        source,
        recoveryScope,
        scopeKey,
        trackAttempt: nextTrackAttempt,
        scopeAttempt: nextScopeAttempt,
        maxTrackAttempts: REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK,
        maxScopeAttempts: maxScopeAttemptsForScope,
      });

      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch {
        videoEl.srcObject = null;
      }

      remoteRenderRecoveryReattachTimeoutRef.current = setTimeout(() => {
        remoteRenderRecoveryReattachTimeoutRef.current = null;
        const latestParticipant = latestRemoteParticipantRef.current ?? participant;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (latestKey !== remoteKey) {
          vdbg("daily_remote_render_recovery_skipped", {
            ...remoteRenderDiagnostics(latestParticipant, remoteVideoRef.current),
            source,
            reason: "stale_track_key",
            expectedTrackKey: remoteKey,
            latestTrackKey: latestKey || null,
            trackAttempt: nextTrackAttempt,
            scopeAttempt: nextScopeAttempt,
          });
          if (remoteRenderRecoveryInFlightRef.current?.trackKey === remoteKey) {
            remoteRenderRecoveryInFlightRef.current = null;
          }
          return;
        }
        attachTracks(latestParticipant, remoteVideoRef.current, false);
        logTrackMounted("remote_render_recovery", {
          isLocal: false,
          participant: latestParticipant,
          roomName,
        });
        scheduleRemoteRenderValidationRef.current?.(
          latestParticipant,
          "remote_render_recovery_followup",
          roomName,
          scopeKey,
          {
            allowRecovery: true,
            recoveryFollowUp: true,
            requireFreshFrame: validationOptions.requireFreshFrame,
            freshFrameBaseline: validationOptions.freshFrameBaseline,
          }
        );
      }, 0);
    },
    [attachTracks, clearRemoteRenderValidation, logTrackMounted, remoteRenderDiagnostics]
  );

  const scheduleRemoteRenderValidation = useCallback(
    (
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope = source,
      validationOptions: RemoteRenderValidationOptions = {}
    ) => {
      const videoEl = remoteVideoRef.current;
      const remoteKey = getTrackIdsKey(participant, true);
      const videoTrack = participant?.tracks?.video?.persistentTrack;
      const requireFreshFrame = validationOptions.requireFreshFrame === true;
      const freshFrameBaseline =
        validationOptions.freshFrameBaseline !== undefined
          ? validationOptions.freshFrameBaseline
          : requireFreshFrame
            ? readRemoteRenderFrameState(videoEl)
            : null;
      if (!videoEl || !participant?.tracks || !remoteKey || !videoTrack || videoTrack.readyState === "ended") {
        clearRemoteRenderValidation({ cancelReattach: true });
        vdbg("daily_remote_render_validation_skipped", {
          ...remoteRenderDiagnostics(participant, videoEl),
          source,
          recoveryScope,
          requireFreshFrame,
          freshFrameBaseline,
          reason: !videoEl
            ? "missing_video_element"
            : !remoteKey || !videoTrack
              ? "missing_video_track"
              : videoTrack?.readyState === "ended"
                ? "video_track_ended"
                : "missing_tracks",
        });
        return;
      }

      clearRemoteRenderValidation({ cancelReattach: true });
      const validationSeq = remoteRenderValidationSeqRef.current + 1;
      remoteRenderValidationSeqRef.current = validationSeq;
      remoteRenderValidationDelayRef.current = setTimeout(() => {
        remoteRenderValidationDelayRef.current = null;
        if (remoteRenderValidationSeqRef.current !== validationSeq) return;

        const latestParticipant = latestRemoteParticipantRef.current ?? participant;
        const latestVideoEl = remoteVideoRef.current;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (!latestVideoEl || latestKey !== remoteKey) {
          vdbg("daily_remote_render_validation_skipped", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            reason: !latestVideoEl ? "missing_video_element" : "stale_track_key",
            expectedTrackKey: remoteKey,
            latestTrackKey: latestKey || null,
          });
          return;
        }

        const effectiveFrameTimeoutMs =
          typeof validationOptions.freshFrameTimeoutMs === "number" &&
          Number.isFinite(validationOptions.freshFrameTimeoutMs) &&
          validationOptions.freshFrameTimeoutMs > 0
            ? validationOptions.freshFrameTimeoutMs
            : REMOTE_RENDER_FRAME_TIMEOUT_MS;

        vdbg("daily_remote_same_track_render_validation_started", {
          ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
          source,
          delayMs: REMOTE_RENDER_VALIDATION_DELAY_MS,
          timeoutMs: effectiveFrameTimeoutMs,
          requireFreshFrame,
          freshFrameBaseline,
        });

        function finishTimedOut(reason: string) {
          if (remoteRenderValidationSeqRef.current !== validationSeq) return;
          if (remoteRenderValidationTimeoutRef.current) {
            clearTimeout(remoteRenderValidationTimeoutRef.current);
            remoteRenderValidationTimeoutRef.current = null;
          }
          remoteRenderValidationFrameCallbackRef.current = null;
          const latestFrameState = readRemoteRenderFrameState(latestVideoEl);
          if (reconnectGraceActiveRef.current) {
            vdbg("daily_remote_render_validation_deferred", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source,
              recoveryScope,
              reason: "reconnect_grace_active",
              timeoutReason: reason,
              requireFreshFrame,
              freshFrameBaseline,
              latestFrameState,
            });
            return;
          }
          vdbg("daily_remote_render_validation_timed_out", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            recoveryScope,
            recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
            reason,
            timeoutMs: effectiveFrameTimeoutMs,
            requireFreshFrame,
            freshFrameBaseline,
            latestFrameState,
          });
          if (validationOptions.allowRecovery === false) {
            setRemotePlayback((prev) => ({
              ...prev,
              mediaAttached: true,
              playSucceeded: false,
              playRejected: true,
              error: "Remote video paused. Tap to resume.",
            }));
            return;
          }
          forceRemoteMediaReattach(latestParticipant, `${source}:${reason}`, roomName, recoveryScope, {
            ...validationOptions,
            requireFreshFrame,
            freshFrameBaseline,
          });
        }

        function finishValidated(method: string, metadata?: RemoteVideoFrameCallbackMetadata) {
          if (remoteRenderValidationSeqRef.current !== validationSeq) return;
          const latestFrameState = readRemoteRenderFrameState(latestVideoEl);
          if (requireFreshFrame && !hasFreshRemoteRenderFrame(freshFrameBaseline, latestFrameState, metadata)) {
            finishTimedOut("fresh_frame_not_observed");
            return;
          }
          if (remoteRenderValidationTimeoutRef.current) {
            clearTimeout(remoteRenderValidationTimeoutRef.current);
            remoteRenderValidationTimeoutRef.current = null;
          }
          remoteRenderValidationFrameCallbackRef.current = null;
          const recovery = remoteRenderRecoveryInFlightRef.current;
          if (recovery?.trackKey === remoteKey) {
            remoteRenderRecoveryTrackAttemptsRef.current.delete(remoteKey);
            remoteRenderRecoveryScopedAttemptsRef.current.delete(`${remoteKey}:${recovery.scopeKey}`);
            remoteRenderRecoveryInFlightRef.current = null;
            vdbg("daily_remote_render_recovery_succeeded", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source: recovery.source,
              validationSource: source,
              scopeKey: recovery.scopeKey,
              trackAttempt: recovery.trackAttempt,
              scopeAttempt: recovery.scopeAttempt,
              method,
              presentedFrames: metadata?.presentedFrames ?? null,
              mediaTime: metadata?.mediaTime ?? null,
              frameWidth: metadata?.width ?? null,
              frameHeight: metadata?.height ?? null,
              requireFreshFrame,
              freshFrameBaseline,
              latestFrameState,
            });
          }
          if (recoveryScope === "camera_switch_hint") {
            activeRemoteCameraSwitchRenderWatchRef.current = null;
            // The receiver kept decoding the same persistentTrack and observed
            // a fresh frame on its own. No srcObject teardown was needed.
            // This is the desired path; track its frequency to confirm the
            // fix is preventing unnecessary reattachments.
            vdbg("daily_camera_switch_no_reattach_needed", {
              ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
              source,
              method,
              presentedFrames: metadata?.presentedFrames ?? null,
              mediaTime: metadata?.mediaTime ?? null,
              frameWidth: metadata?.width ?? null,
              frameHeight: metadata?.height ?? null,
              freshFrameBaseline,
              latestFrameState,
            });
          }
          setRemotePlayback((prev) => ({
            ...prev,
            mediaAttached: true,
            playRejected: false,
            error: undefined,
          }));
          vdbg("daily_remote_same_track_render_validated", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            recoveryScope,
            recoveryFollowUp: Boolean(validationOptions.recoveryFollowUp),
            method,
            presentedFrames: metadata?.presentedFrames ?? null,
            mediaTime: metadata?.mediaTime ?? null,
            frameWidth: metadata?.width ?? null,
            frameHeight: metadata?.height ?? null,
            requireFreshFrame,
            freshFrameBaseline,
            latestFrameState,
          });
        }

        const videoWithFrameCallback = latestVideoEl as RemoteVideoElementWithFrameCallback;
        if (typeof videoWithFrameCallback.requestVideoFrameCallback === "function") {
          remoteRenderValidationFrameCallbackRef.current = videoWithFrameCallback.requestVideoFrameCallback(
            (_now, metadata) => finishValidated("request_video_frame_callback", metadata)
          );
          remoteRenderValidationTimeoutRef.current = setTimeout(
            () => finishTimedOut("request_video_frame_callback_timeout"),
            effectiveFrameTimeoutMs
          );
          return;
        }

        remoteRenderValidationTimeoutRef.current = setTimeout(() => {
          const hasRenderableMedia =
            latestVideoEl.readyState >= 2 && latestVideoEl.videoWidth > 0 && latestVideoEl.videoHeight > 0;
          if (hasRenderableMedia) {
            finishValidated("ready_state_fallback");
            return;
          }
          finishTimedOut("ready_state_fallback_timeout");
        }, effectiveFrameTimeoutMs);
      }, REMOTE_RENDER_VALIDATION_DELAY_MS);
    },
    [clearRemoteRenderValidation, forceRemoteMediaReattach, remoteRenderDiagnostics]
  );

  scheduleRemoteRenderValidationRef.current = scheduleRemoteRenderValidation;

  const readLocalCameraSnapshot = useCallback((call: DailyCall): LocalCameraSnapshot => {
    let localParticipant = latestLocalParticipantRef.current;
    try {
      localParticipant = call.participants().local ?? localParticipant;
    } catch {
      /* Keep the most recent participant snapshot from Daily events. */
    }
    return getLocalCameraSnapshot(localParticipant);
  }, []);

  const waitForLocalCameraSwitchCommit = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      method: WebCameraSwitchCommitMethod,
      opts: {
        expectedFacing?: VideoDateCameraFacingMode | null;
        expectedDeviceId?: string | null;
        publishRefreshApplied?: boolean;
        timeoutMs?: number;
      } = {},
    ): Promise<WebCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      const timeoutMs = opts.timeoutMs ?? CAMERA_SWITCH_COMMIT_TIMEOUT_MS;
      while (Date.now() - startedAtMs <= timeoutMs) {
        const snapshot = readLocalCameraSnapshot(call);
        const trackChanged = Boolean(before.trackId && snapshot.trackId && snapshot.trackId !== before.trackId);
        const deviceChanged = Boolean(before.deviceId && snapshot.deviceId && snapshot.deviceId !== before.deviceId);
        const facingChanged = Boolean(before.facingMode && snapshot.facingMode && snapshot.facingMode !== before.facingMode);
        const expectedDeviceMatched = Boolean(
          opts.expectedDeviceId &&
            opts.expectedDeviceId !== before.deviceId &&
            snapshot.deviceId === opts.expectedDeviceId
        );
        const expectedFacingMatched = Boolean(
          opts.expectedFacing &&
            opts.expectedFacing !== before.facingMode &&
            snapshot.facingMode === opts.expectedFacing
        );
        const live = snapshot.readyState === "live" && snapshot.enabled !== false;

        if (
          live &&
          (trackChanged ||
            deviceChanged ||
            facingChanged ||
            expectedDeviceMatched ||
            expectedFacingMatched ||
            !before.trackId)
        ) {
          return {
            ...snapshot,
            method,
            latencyMs: Date.now() - startedAtMs,
            publishRefreshApplied: opts.publishRefreshApplied === true,
          };
        }

        await sleep(CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readLocalCameraSnapshot],
  );

  const switchToWebCameraVideoSource = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      desiredFacing: VideoDateCameraFacingMode | null,
      expectedDeviceId?: string | null,
      restoreDeviceId = expectedDeviceId ?? before.deviceId,
    ): Promise<WebCameraSwitchCommit | null> => {
      if (typeof call.setInputDevicesAsync !== "function") return null;

      if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
        return null;
      }

      let stream: MediaStream | null = null;
      let videoTrack: MediaStreamTrack | null = null;
      let dailyVideoInputCleared = false;
      let dailyVideoTrackAdopted = false;
      const restoreDailyVideoInput = async () => {
        try {
          call.setLocalVideo(true);
          if (!dailyVideoInputCleared) return true;
          if (!restoreDeviceId) return false;
          await call.setInputDevicesAsync({ videoDeviceId: restoreDeviceId });
          call.setLocalVideo(true);
          dailyVideoInputCleared = false;
          dailyVideoTrackAdopted = false;
          return true;
        } catch (restoreError) {
          vdbg("daily_camera_switch_video_source_restore_failed", {
            sessionId: activeCallSessionIdRef.current,
            eventId: optionsRef.current?.eventId ?? null,
            userId: optionsRef.current?.userId ?? null,
            platform: "web",
            desiredFacing,
            restoreDeviceId,
            error: describeCameraSwitchError(restoreError),
          });
          return false;
        }
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          videoOnlyCameraSwitchConstraints(captureProfileRef.current, desiredFacing, expectedDeviceId)
        );
        videoTrack = stream.getVideoTracks()[0] ?? null;
        if (!videoTrack) return null;
        await call.setInputDevicesAsync({ videoSource: false });
        dailyVideoInputCleared = true;
        await call.setInputDevicesAsync({ videoSource: videoTrack });
        dailyVideoTrackAdopted = true;
        call.setLocalVideo(true);
        const sourceCommit = await waitForLocalCameraSwitchCommit(call, before, "video_source", {
          expectedDeviceId: getTrackDeviceId(videoTrack),
          expectedFacing: getTrackFacingMode(videoTrack) ?? desiredFacing,
          publishRefreshApplied: true,
        });
        if (sourceCommit) return sourceCommit;
        const restored = await restoreDailyVideoInput();
        if (restored || !dailyVideoTrackAdopted) videoTrack.stop();
        return null;
      } catch (error) {
        const restored = await restoreDailyVideoInput();
        if (restored || !dailyVideoTrackAdopted) videoTrack?.stop();
        vdbg("daily_camera_switch_video_source_fallback_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          error: describeCameraSwitchError(error),
        });
        return null;
      } finally {
        stream?.getAudioTracks().forEach((track) => track.stop());
      }
    },
    [waitForLocalCameraSwitchCommit],
  );

  const switchToDeterministicWebCamera = useCallback(
    async (
      call: DailyCall,
      before: LocalCameraSnapshot,
      desiredFacing: VideoDateCameraFacingMode | null,
      opts: { forceVideoSourceRefresh?: boolean } = {},
    ): Promise<WebCameraSwitchCommit | null> => {
      if (typeof call.setInputDevicesAsync !== "function") return null;

      const devices = await enumerateWebVideoDevices(call);
      const device = chooseWebVideoDevice(devices, before, desiredFacing);
      const deviceId = getDeviceId(device);
      if (deviceId) {
        const sourceFacing = getDeviceFacingMode(device) ?? desiredFacing;
        await call.setInputDevicesAsync({ videoDeviceId: deviceId });
        const deviceCommit = await waitForLocalCameraSwitchCommit(call, before, "set_input_device", {
          expectedDeviceId: deviceId,
          expectedFacing: sourceFacing,
        });
        if (deviceCommit && !opts.forceVideoSourceRefresh) return deviceCommit;
        const sourceCommit = await switchToWebCameraVideoSource(
          call,
          before,
          sourceFacing,
          deviceId
        );
        if (sourceCommit) return sourceCommit;
        if (opts.forceVideoSourceRefresh) {
          const facingSourceCommit = await switchToWebCameraVideoSource(call, before, sourceFacing, null, deviceId);
          if (facingSourceCommit) return facingSourceCommit;
        }
        if (deviceCommit) return deviceCommit;
      }

      return switchToWebCameraVideoSource(call, before, desiredFacing);
    },
    [switchToWebCameraVideoSource, waitForLocalCameraSwitchCommit],
  );

  // Hint is now a fire-and-forget signal. The receiver uses it to arm a
  // freshness watchdog over the same persistentTrack. No resend needed,
  // and the publishSequence / hintSequence retry protocol from the previous
  // (regression-prone) revisions is gone.
  const sendCommittedCameraSwitchHint = useCallback(async (call: DailyCall, commit: WebCameraSwitchCommit) => {
    if (typeof call.sendAppMessage !== "function") {
      vdbg("daily_camera_switch_render_hint_send_failed", {
        sessionId: activeCallSessionIdRef.current,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        platform: "web",
        reason: "send_app_message_unavailable",
      });
      return;
    }

    const hint = createVideoDateCameraSwitchRenderHint({
      sourcePlatform: "web",
      facingMode: commit.facingMode,
      commitConfirmed: true,
      commitMethod: commit.method,
      localVideoTrackId: commit.trackId,
      commitLatencyMs: commit.latencyMs,
    });

    await Promise.resolve(call.sendAppMessage(hint));
    vdbg("daily_camera_switch_render_hint_sent", {
      sessionId: activeCallSessionIdRef.current,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      platform: "web",
      switchId: hint.switchId,
      facingMode: hint.facingMode,
      commitMethod: hint.commitMethod,
      localVideoTrackId: hint.localVideoTrackId,
      commitLatencyMs: hint.commitLatencyMs,
    });
  }, []);

  const releaseAppAcquiredMedia = useCallback((reason: string) => {
    const entry = appAcquiredMediaRef.current;
    if (!entry) return;
    appAcquiredMediaRef.current = null;
    stopMediaStreamTracks(entry.stream);
    vdbg("daily_app_acquired_media_released", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      captureProfile: entry.captureProfile,
      consumedByDaily: entry.consumedByDaily,
      reason,
      ageMs: Math.max(0, Date.now() - entry.acquiredAtMs),
    });
  }, []);

  const preflightMediaPermission = useCallback(
    async (sessionId: string, eventId: string | null | undefined, userId: string | null | undefined) => {
      const permissionStartedAt = Date.now();
      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_daily",
        checkpoint: "permission_check_started",
        nowMs: permissionStartedAt,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: "permission_check_started",
          sourceAction: "permission_check_started",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_STARTED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "permission_check_started",
      });
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        releaseAppAcquiredMedia("media_devices_unavailable");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        setMediaPermissionError("Camera and microphone access are not available in this browser.");
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          reason: "media_devices_unavailable",
        });
        return false;
      }

      const permissionHandoff = userId ? getVideoDatePermissionHandoff(sessionId, userId) : null;
      if (permissionHandoff) {
        releaseAppAcquiredMedia("permission_handoff_media_restart");
        let handoffCaptureProfile: VideoDateWebMediaCaptureProfile = permissionHandoff.captureProfile ?? "ideal";
        let handoffStream: MediaStream | null = null;
        let handoffMediaAcquired = false;
        try {
          for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
            try {
              handoffStream = await navigator.mediaDevices.getUserMedia(videoDateWebMediaStreamConstraints(profile));
              handoffCaptureProfile = profile;
              break;
            } catch (profileError) {
              if (!isVideoDateCameraConstraintError(profileError) || profile === "fallback") {
                throw profileError;
              }
              vdbg("daily_media_permission_handoff_constraint_fallback", {
                sessionId,
                eventId: eventId ?? null,
                userId: userId ?? null,
                attemptedProfile: profile,
                error:
                  profileError instanceof Error
                    ? { name: profileError.name, message: profileError.message }
                    : String(profileError),
              });
            }
          }
          const videoTrack = firstLiveTrack(handoffStream?.getVideoTracks() ?? []);
          const audioTrack = firstLiveTrack(handoffStream?.getAudioTracks() ?? []);
          if (handoffStream && videoTrack) {
            const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
            appAcquiredMediaRef.current = {
              stream: handoffStream,
              captureProfile: handoffCaptureProfile,
              acquiredAtMs: Date.now(),
              consumedByDaily: false,
            };
            handoffMediaAcquired = true;
            handoffStream = null;
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
              platform: "web",
              session_id: sessionId,
              event_id: eventId ?? null,
              source_surface: "video_date_daily",
              source_action: "permission_handoff_media_acquired",
              diagnostic_scope: "sender_capture",
              capture_profile: handoffCaptureProfile,
              app_acquired_media: true,
              audio_track_present: Boolean(audioTrack),
              video_track_present: true,
              video_track_width: videoTrackSettings?.width ?? null,
              video_track_height: videoTrackSettings?.height ?? null,
              video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
              video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
              video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
              ...summarizeWebRuntime(),
            });
          }
        } catch (error) {
          vdbg("daily_media_permission_handoff_media_acquire_failed", {
            sessionId,
            eventId: eventId ?? null,
            userId: userId ?? null,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
        } finally {
          stopMediaStreamTracks(handoffStream);
        }
        if (handoffMediaAcquired) {
          captureProfileRef.current = handoffCaptureProfile;
          setCaptureProfile(handoffCaptureProfile);
          setHasPermission(true);
          setMediaPermissionError(null);
          const durationMs = Math.max(0, Date.now() - permissionStartedAt);
          const successContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId: eventId ?? null,
            sourceSurface: "video_date_daily",
            checkpoint: "permission_check_success",
            permissionHandoffUsed: true,
          });
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: successContext,
              checkpoint: "permission_check_success",
              sourceAction: "permission_handoff",
              outcome: "success",
              durationMs,
            }),
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "permission_handoff",
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
          });
          vdbg("daily_media_permission_handoff_used", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            handoffSource: permissionHandoff.source,
          });
          return true;
        }
        vdbg("daily_media_permission_handoff_fallback_to_preflight", {
          sessionId,
          eventId: eventId ?? null,
          userId,
          handoffSource: permissionHandoff.source,
        });
      }

      try {
        releaseAppAcquiredMedia("media_permission_preflight_restart");
        let stream: MediaStream | null = null;
        let nextCaptureProfile: VideoDateWebMediaCaptureProfile = "ideal";
        let lastConstraintError: unknown = null;

        for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(videoDateWebMediaStreamConstraints(profile));
            nextCaptureProfile = profile;
            break;
          } catch (profileError) {
            if (!isVideoDateCameraConstraintError(profileError) || profile === "fallback") {
              throw profileError;
            }
            lastConstraintError = profileError;
            vdbg("daily_media_permission_preflight_constraint_fallback", {
              sessionId,
              eventId: eventId ?? null,
              userId: userId ?? null,
              attemptedProfile: profile,
              nextProfiles: VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER.slice(
                VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER.indexOf(profile) + 1,
              ),
              error:
                profileError instanceof Error
                  ? { name: profileError.name, message: profileError.message }
                  : String(profileError),
            });
          }
        }

        if (!stream) {
          throw lastConstraintError ?? new Error("Media permission preflight returned no stream");
        }

        captureProfileRef.current = nextCaptureProfile;
        setCaptureProfile(nextCaptureProfile);
        const videoTrack = firstLiveTrack(stream.getVideoTracks());
        const audioTrack = firstLiveTrack(stream.getAudioTracks());
        if (!videoTrack) {
          stopMediaStreamTracks(stream);
          throw new Error("Video Date media permission preflight returned no live video track");
        }
        const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
        appAcquiredMediaRef.current = {
          stream,
          captureProfile: nextCaptureProfile,
          acquiredAtMs: Date.now(),
          consumedByDaily: false,
        };
        setHasPermission(true);
        setMediaPermissionError(null);
        const durationMs = Math.max(0, Date.now() - permissionStartedAt);
        const successContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: eventId ?? null,
          sourceSurface: "video_date_daily",
          checkpoint: "permission_check_success",
          permissionHandoffUsed: false,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: successContext,
            checkpoint: "permission_check_success",
            sourceAction: "media_permission_preflight_succeeded",
            outcome: "success",
            durationMs,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "media_permission_preflight_succeeded",
          duration_ms: durationMs,
          latency_bucket: bucketVideoDateLatencyMs(durationMs),
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "media_permission_preflight_succeeded",
          diagnostic_scope: "sender_capture",
          capture_profile: nextCaptureProfile,
          app_acquired_media: true,
          audio_track_present: Boolean(audioTrack),
          video_track_present: Boolean(videoTrack),
          video_track_width: videoTrackSettings?.width ?? null,
          video_track_height: videoTrackSettings?.height ?? null,
          video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
          video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
          video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
          ...summarizeWebRuntime(),
        });
        vdbg("daily_media_permission_preflight_succeeded", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          captureProfile: nextCaptureProfile,
          appAcquiredMedia: true,
          audioTrackPresent: Boolean(audioTrack),
          videoTrack: videoTrackSettings,
        });
        if (mediaPermissionDeniedRef.current) {
          mediaPermissionDeniedRef.current = false;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_RECOVERED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
          });
        }
        return true;
      } catch (error) {
        releaseAppAcquiredMedia("media_permission_preflight_failed");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        const description = describeMediaError(error);
        setMediaPermissionError(description || "Camera or microphone permission was denied.");
        vdbg("daily_media_permission_preflight_failed", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
        trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source: "media_preflight",
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          reason: error instanceof Error ? error.name : "media_permission_error",
        });
        Sentry.captureMessage("video_date_media_permission_denied", {
          level: "warning",
          extra: {
            sessionId,
            eventId: eventId ?? null,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          },
        });
        return false;
      }
    },
    [releaseAppAcquiredMedia]
  );

  const clearReconnectGraceTimers = useCallback(() => {
    if (reconnectGraceTimeoutRef.current) {
      clearTimeout(reconnectGraceTimeoutRef.current);
      reconnectGraceTimeoutRef.current = null;
    }
    if (reconnectGraceTickerRef.current) {
      clearInterval(reconnectGraceTickerRef.current);
      reconnectGraceTickerRef.current = null;
    }
    if (reconnectRecoveryResetTimeoutRef.current) {
      clearTimeout(reconnectRecoveryResetTimeoutRef.current);
      reconnectRecoveryResetTimeoutRef.current = null;
    }
  }, []);

  const cleanupCallObject = useCallback(
    async (caller: string, reason: string) => {
      const callObject = callObjectRef.current;
      const roomName = roomNameRef.current;
      const sessionId = optionsRef.current?.roomId ?? null;
      const eventId = optionsRef.current?.eventId ?? null;

      vdbg("daily_call_cleanup_start", {
        caller,
        reason,
        sessionId,
        eventId,
        roomName,
        hasCallObject: Boolean(callObject),
      });

      if (callObject) {
        try {
          vdbg("daily_call_leave_before", { caller, reason, sessionId, eventId, roomName });
          await callObject.leave();
          vdbg("daily_call_leave_after", { caller, reason, sessionId, eventId, roomName, ok: true });
        } catch (error) {
          vdbg("daily_call_leave_after", {
            caller,
            reason,
            sessionId,
            eventId,
            roomName,
            ok: false,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
        }

        try {
          callObject.destroy();
          vdbg("daily_call_destroy", { caller, reason, sessionId, eventId, roomName, ok: true });
        } catch (error) {
          vdbg("daily_call_destroy", {
            caller,
            reason,
            sessionId,
            eventId,
            roomName,
            ok: false,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
        }
        callObjectRef.current = null;
      }
      activeCallSessionIdRef.current = null;

      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setLocalStream(null);
      setHasPermission(null);
      setIsConnected(false);
      setIsConnecting(false);
      setNetworkTier("good");
      setRemotePlayback(createRemotePlaybackState());
      setPeerMissing({ terminal: false });
      clearRemoteRenderValidation({ cancelReattach: true });
      clearReconnectGraceTimers();
      reconnectGraceActiveRef.current = false;
      reconnectPartnerAwayTriggeredRef.current = false;
      reconnectSyncRequestedRef.current = false;
      resetRemoteRenderRecoveryAttempts();
      lastRemoteRenderParticipantIdRef.current = null;
      activePreparedEntryCacheRef.current = null;
      dailyJoinStartedAtMsRef.current = null;
      localVideoReadyTrackedRef.current = false;
      remoteFirstFrameTrackedRef.current = false;
      setDailyReconnectState("connected");
      setReconnectGraceTimeLeft(0);
      firstRemoteObservedRef.current = false;
      clearFirstRemoteWatchdog();
      lastLocalTrackIdsRef.current = "";
      lastLocalStreamRef.current = null;
      lastRemoteTrackIdsRef.current = "";
      lastRemoteStreamRef.current = null;
      lastLocalMountedTrackKeyRef.current = "";
      lastRemoteMountedTrackKeyRef.current = "";
      latestLocalParticipantRef.current = undefined;
      latestRemoteParticipantRef.current = undefined;
      cameraSwitchInFlightRef.current = false;
      lastRemoteCameraSwitchHintIdRef.current = null;
      activeRemoteCameraSwitchRenderWatchRef.current = null;
      releaseAppAcquiredMedia("daily_call_cleanup");
    },
    [
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      clearRemoteRenderValidation,
      releaseAppAcquiredMedia,
      resetRemoteRenderRecoveryAttempts,
    ]
  );

  const fetchVideoDateTruth = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from("video_sessions")
      .select(
        "id, event_id, ended_at, state, phase, handshake_started_at, daily_room_name, daily_room_url, ready_gate_status, ready_gate_expires_at",
      )
      .eq("id", sessionId)
      .maybeSingle();
    return {
      truth: (data as VideoDateTruthRow | null) ?? null,
      error,
    };
  }, []);

  const acquireDateRoom = useCallback(
    async (
      sessionId: string,
      eventId: string | null,
      userId: string | null,
      truthRow: VideoDateTruthRow | null
    ): Promise<
      | { ok: true; roomData: DailyRoomSuccessResponse; cacheEntry: PreparedVideoDateEntryCacheEntry; cached: boolean }
      | {
          ok: false;
          failure: VideoCallStartFailure;
        }
    > => {
      if (userId) {
        const handoff = consumePreparedVideoDateEntry(sessionId, userId);
        if (handoff.ok === true) {
          const successfulRoomData: DailyRoomSuccessResponse = {
            room_name: handoff.envelope.roomName,
            room_url: handoff.envelope.roomUrl,
            token: handoff.envelope.token,
            token_expires_at: handoff.envelope.tokenExpiresAt,
            entry_attempt_id: handoff.envelope.entryAttemptId,
            video_date_trace_id: handoff.envelope.videoDateTraceId,
            reused_room: handoff.cacheEntry.value.reused_room,
            provider_room_recreated: handoff.cacheEntry.value.provider_room_recreated,
            provider_verify_skipped: handoff.cacheEntry.value.provider_verify_skipped,
          };
          const entryAttemptId = successfulRoomData.entry_attempt_id ?? handoff.cacheEntry.entryAttemptId ?? null;
          const videoDateTraceId = successfulRoomData.video_date_trace_id ?? entryAttemptId;
          vdbg("daily_room_handoff_used", {
            action: "prepare_date_entry",
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: successfulRoomData.room_name,
            entryAttemptId,
            videoDateTraceId,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_handoff_used",
            cached: true,
            handoff_used: true,
            attempt: 1,
            attempt_count: 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: 0,
            latency_bucket: bucketVideoDateLatencyMs(0),
          });
          return {
            ok: true,
            roomData: successfulRoomData,
            cacheEntry: handoff.cacheEntry,
            cached: true,
          };
        }
        vdbg("daily_room_handoff_missed", {
          action: "prepare_date_entry",
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          reason: handoff.reason,
        });
      }
      let lastFailure: VideoCallStartFailure | null = null;

      for (let attempt = 0; attempt <= CREATE_DATE_ROOM_RETRY_DELAYS_MS.length; attempt += 1) {
        vdbg("daily_room_before", {
          action: "prepare_date_entry",
          args: { action: "prepare_date_entry", sessionId },
          eventId: truthRow?.event_id ?? eventId,
          userId,
          timeoutMs: VIDEO_DATE_PREJOIN_TIMEOUT_MS,
          attempt: attempt + 1,
        });
        let result: Awaited<ReturnType<typeof prepareVideoDateEntry>>;
        try {
          result = await withTimeout(
            "daily_room",
            prepareVideoDateEntry(sessionId, {
              eventId: truthRow?.event_id ?? eventId,
              userId,
              source: "use_video_call_start",
              force: attempt > 0,
            }),
            VIDEO_DATE_PREJOIN_TIMEOUT_MS
          );
        } catch (error) {
          lastFailure = {
            kind: "network",
            retryable: true,
            serverCode: isInvokeTimeoutError(error) ? "PREPARE_ENTRY_TIMEOUT" : undefined,
          };
          vdbg("daily_room_after", {
            action: "prepare_date_entry",
            ok: false,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            classifiedCode: lastFailure.kind,
            retryable: lastFailure.retryable,
            attempt: attempt + 1,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_failure",
            code: lastFailure.kind,
            reason_code: lastFailure.kind,
            failure_class: classifyDailyRoomTokenFailureClass(lastFailure.kind),
            retryable: true,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
          });
          const delayMs = CREATE_DATE_ROOM_RETRY_DELAYS_MS[attempt];
          if (delayMs == null) break;
          await sleep(delayMs);
          continue;
        }

        if (result.ok === true) {
          const successfulRoomData: DailyRoomSuccessResponse = {
            ...result.data,
            token: result.data.token,
            room_name: result.data.room_name,
            room_url: result.data.room_url,
            token_expires_at: result.data.token_expires_at ?? null,
          };
          const entryAttemptId = successfulRoomData.entry_attempt_id ?? result.cacheEntry.entryAttemptId ?? null;
          const videoDateTraceId = successfulRoomData.video_date_trace_id ?? entryAttemptId;
          vdbg("daily_room_after", {
            action: "prepare_date_entry",
            ok: true,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: successfulRoomData.room_name,
            hasToken: true,
            reusedRoom: successfulRoomData.reused_room ?? null,
            providerRoomRecreated: successfulRoomData.provider_room_recreated ?? null,
            providerVerifySkipped: successfulRoomData.provider_verify_skipped ?? null,
            cached: result.cached,
            attempt: attempt + 1,
            entryAttemptId,
            videoDateTraceId,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_success",
            reused_room: successfulRoomData.reused_room === true,
            provider_room_recreated: successfulRoomData.provider_room_recreated === true,
            provider_verify_skipped: successfulRoomData.provider_verify_skipped === true,
            cached: result.cached,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: result.cacheEntry
              ? Math.max(0, result.cacheEntry.prepareFinishedAtMs - result.cacheEntry.prepareStartedAtMs)
              : null,
            latency_bucket: bucketVideoDateLatencyMs(
              result.cacheEntry
                ? Math.max(0, result.cacheEntry.prepareFinishedAtMs - result.cacheEntry.prepareStartedAtMs)
                : null,
            ),
          });
          return {
            ok: true,
            roomData: successfulRoomData,
            cacheEntry: result.cacheEntry,
            cached: result.cached,
          };
        }

        lastFailure = {
          kind: result.code as DailyRoomFailureKind,
          retryable: result.retryable,
          httpStatus: result.httpStatus,
          serverCode: result.code,
        };
        vdbg("daily_room_after", {
          action: "prepare_date_entry",
          ok: false,
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          httpStatus: result.httpStatus ?? null,
          serverCode: result.code,
          classifiedCode: result.code,
          retryable: result.retryable,
          attempt: attempt + 1,
          entryAttemptId: result.entryAttemptId ?? null,
          videoDateTraceId: result.entryAttemptId ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow?.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: "daily_token_failure",
          code: result.code,
          reason_code: result.code,
          failure_class: classifyDailyRoomTokenFailureClass(result.code),
          retryable: result.retryable,
          attempt: attempt + 1,
          attempt_count: attempt + 1,
          entry_attempt_id: result.entryAttemptId ?? null,
          video_date_trace_id: result.entryAttemptId ?? null,
        });

        if (!lastFailure?.retryable) {
          return {
            ok: false,
            failure: {
              kind: lastFailure?.kind ?? "unknown",
              retryable: false,
              httpStatus: lastFailure?.httpStatus,
              serverCode: lastFailure?.serverCode,
            },
          };
        }

        const delayMs = CREATE_DATE_ROOM_RETRY_DELAYS_MS[attempt];
        if (delayMs == null) break;
        vdbg("daily_room_retry_scheduled", {
          action: "prepare_date_entry",
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          delayMs,
          classifiedCode: lastFailure.kind,
        });
        await sleep(delayMs);
      }

      return {
        ok: false,
        failure: {
          kind: lastFailure?.kind ?? "unknown",
          retryable: lastFailure?.retryable ?? false,
          httpStatus: lastFailure?.httpStatus,
          serverCode: lastFailure?.serverCode,
        },
      };
    },
    []
  );

  const startCall = useCallback(
    async (roomId?: string, opts?: { internalRetry?: boolean }) => {
      const sessionId = roomId || optionsRef.current?.roomId;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      if (!sessionId) {
        toast.error("No session ID provided");
        return { ok: false, failure: { kind: "session_unavailable", retryable: false } } as VideoCallStartResult;
      }
      if (activeCallSessionIdRef.current === sessionId && callObjectRef.current) {
        vdbg("daily_call_reuse_decision", {
          sessionId,
          eventId,
          userId,
          reusedCallObject: true,
          reason: "existing_call_object_already_started",
          roomName: roomNameRef.current,
        });
        return { ok: true } as VideoCallStartResult;
      }
      if (startCallInFlightSessionRef.current === sessionId) {
        vdbg("daily_call_reuse_decision", {
          sessionId,
          eventId,
          userId,
          reusedCallObject: true,
          reason: "start_call_already_in_flight",
          roomName: roomNameRef.current,
        });
        return { ok: true } as VideoCallStartResult;
      }
      startCallInFlightSessionRef.current = sessionId;

      setIsConnecting(true);
      setIsConnected(false);
      setHasPermission(null);
      setMediaPermissionError(null);
      setRemotePlayback(createRemotePlaybackState());
      setPeerMissing({ terminal: false });
      firstRemoteObservedRef.current = false;
      remoteFirstFrameTrackedRef.current = false;
      playbackBlockedRef.current = false;
      activePreparedEntryCacheHitRef.current = null;
      clearFirstRemoteWatchdog();
      startAttemptNonceRef.current += 1;
      const startNonce = startAttemptNonceRef.current;
      let dailyPrewarmConsumedForJoin = false;
      if (!opts?.internalRetry) {
        noRemoteAutoRecoveryCountRef.current = 0;
      }

      try {
        if (callObjectRef.current) {
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: "existing_call_object_rebuilt_before_start",
            previousRoomName: roomNameRef.current,
          });
          await cleanupCallObject("startCall", "existing_call_object_rebuild");
        } else {
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: "fresh_call_object_required",
          });
        }

        const { truth: initialTruthRow, error: truthError } = await fetchVideoDateTruth(sessionId);
        const truthRow = initialTruthRow;
        vdbg("date_prejoin_truth_row", {
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          row: truthRow ?? null,
          error: truthError ? { code: truthError.code, message: truthError.message } : null,
        });

        if (truthError || !truthRow) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "session_unavailable", retryable: false },
          } as VideoCallStartResult;
        }

        if (truthRow.ended_at) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "SESSION_ENDED", retryable: false },
          } as VideoCallStartResult;
        }

        vdbg("video_date_transition_skipped", {
          action: "sync_reconnect_enter_handshake",
          sessionId,
          userId,
          eventId: truthRow.event_id ?? eventId,
          reason: "prepare_date_entry_owns_reconnect_and_handshake",
          state: truthRow.state,
          phase: truthRow.phase,
          handshakeStarted: Boolean(truthRow.handshake_started_at),
        });

        const mediaAllowed = await preflightMediaPermission(
          sessionId,
          truthRow.event_id ?? eventId,
          userId
        );
        if (!mediaAllowed) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "media_permission_denied", retryable: true },
          } as VideoCallStartResult;
        }

        const roomResult = await acquireDateRoom(
          sessionId,
          truthRow.event_id ?? eventId,
          userId,
          truthRow
        );
        if (roomResult.ok === false) {
          releaseAppAcquiredMedia("daily_room_failed_after_media_preflight");
          setIsConnecting(false);
          return { ok: false, failure: roomResult.failure } as VideoCallStartResult;
        }
        const roomData = roomResult.roomData;
        activePreparedEntryCacheRef.current = roomResult.cacheEntry;
        activePreparedEntryCacheHitRef.current = roomResult.cached;
        const entryAttemptId = roomData.entry_attempt_id ?? roomResult.cacheEntry.entryAttemptId ?? null;
        const videoDateTraceId = roomData.video_date_trace_id ?? entryAttemptId;

        roomNameRef.current = roomData.room_name;

        let captureProfileForCall = captureProfileRef.current;
        const prewarmedCall = userId
          ? consumeWebVideoDateDailyPrewarm({
              sessionId,
              userId,
              eventId: truthRow.event_id ?? eventId,
              roomName: roomData.room_name,
              roomUrl: roomData.room_url,
              captureProfile: captureProfileForCall,
            })
          : { ok: false as const, reason: "missing_user" };
        if (prewarmedCall.ok === false) {
          vdbg("daily_prewarm_fallback", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            reason: prewarmedCall.reason,
          });
        }
        if (
          prewarmedCall.ok === false &&
          !appAcquiredMediaRef.current &&
          typeof navigator !== "undefined" &&
          navigator.mediaDevices?.getUserMedia
        ) {
          let stream: MediaStream | null = null;
          let nextCaptureProfile: VideoDateWebMediaCaptureProfile = captureProfileForCall;
          try {
            for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
              try {
                stream = await navigator.mediaDevices.getUserMedia(videoDateWebMediaStreamConstraints(profile));
                nextCaptureProfile = profile;
                break;
              } catch (profileError) {
                if (!isVideoDateCameraConstraintError(profileError) || profile === "fallback") {
                  throw profileError;
                }
                vdbg("daily_media_permission_handoff_capture_fallback", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  attemptedProfile: profile,
                  reason: prewarmedCall.reason,
                  error:
                    profileError instanceof Error
                      ? { name: profileError.name, message: profileError.message }
                      : String(profileError),
                });
              }
            }
            if (stream) {
              const videoTrack = firstLiveTrack(stream.getVideoTracks());
              const audioTrack = firstLiveTrack(stream.getAudioTracks());
              if (!videoTrack) {
                stopMediaStreamTracks(stream);
                stream = null;
                throw new Error("Video Date handoff capture returned no live video track");
              }
              const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
              captureProfileForCall = nextCaptureProfile;
              captureProfileRef.current = nextCaptureProfile;
              setCaptureProfile(nextCaptureProfile);
              appAcquiredMediaRef.current = {
                stream,
                captureProfile: nextCaptureProfile,
                acquiredAtMs: Date.now(),
                consumedByDaily: false,
              };
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source_surface: "video_date_daily",
                source_action: "daily_create_without_prewarm",
                diagnostic_scope: "sender_capture",
                capture_profile: nextCaptureProfile,
                app_acquired_media: true,
                audio_track_present: Boolean(audioTrack),
                video_track_present: Boolean(videoTrack),
                video_track_width: videoTrackSettings?.width ?? null,
                video_track_height: videoTrackSettings?.height ?? null,
                video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
                video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
                video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
                ...summarizeWebRuntime(),
              });
              vdbg("daily_app_acquired_media_after_prewarm_miss", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                captureProfile: nextCaptureProfile,
                prewarmFallbackReason: prewarmedCall.reason,
                videoTrack: videoTrackSettings,
              });
            }
          } catch (error) {
            if (stream) stopMediaStreamTracks(stream);
            vdbg("daily_app_acquired_media_after_prewarm_miss_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              reason: prewarmedCall.reason,
              error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
            });
          }
        }
        const prewarmAppAcquiredMedia =
          prewarmedCall.ok === true ? prewarmedCall.entry.appAcquiredMedia : null;
        if (prewarmAppAcquiredMedia) {
          const existingMedia = appAcquiredMediaRef.current;
          if (existingMedia && existingMedia.stream !== prewarmAppAcquiredMedia.stream) {
            releaseAppAcquiredMedia("prewarmed_app_acquired_media_replaced_route_media");
          }
          appAcquiredMediaRef.current = {
            stream: prewarmAppAcquiredMedia.stream,
            captureProfile: prewarmAppAcquiredMedia.captureProfile,
            acquiredAtMs: prewarmAppAcquiredMedia.acquiredAtMs,
            consumedByDaily: true,
          };
          vdbg("daily_prewarm_app_acquired_media_consumed", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            captureProfile: prewarmAppAcquiredMedia.captureProfile,
            source: prewarmAppAcquiredMedia.source,
            videoTrack: summarizeVideoTrackSettings(
              firstLiveTrack(prewarmAppAcquiredMedia.stream.getVideoTracks()),
            ),
          });
        }
        const prewarmedAlreadyJoined = prewarmedCall.ok === true && prewarmedCall.entry.joined;
        const prewarmedJoinPromise = prewarmedCall.ok === true ? prewarmedCall.entry.joinPromise : null;
        const acquiredMedia = appAcquiredMediaRef.current;
        const appAcquiredMediaForCall =
          acquiredMedia && acquiredMedia.captureProfile === captureProfileForCall
            ? {
                audioTrack: firstLiveTrack(acquiredMedia.stream.getAudioTracks()),
                videoTrack: firstLiveTrack(acquiredMedia.stream.getVideoTracks()),
              }
            : undefined;
        const hasAppAcquiredVideoTrack = Boolean(appAcquiredMediaForCall?.videoTrack);
        if (acquiredMedia && acquiredMedia.captureProfile !== captureProfileForCall) {
          releaseAppAcquiredMedia("capture_profile_changed_before_daily_create");
        }
        const callObject = prewarmedCall.ok === true
          ? prewarmedCall.entry.call
          : DailyIframe.createCallObject(
              hasAppAcquiredVideoTrack && appAcquiredMediaForCall
                ? dailyVideoDateCallObjectOptionsWithAppAcquiredMedia(
                    captureProfileForCall,
                    appAcquiredMediaForCall,
                  )
                : dailyVideoDateCallObjectOptions(captureProfileForCall)
            );
        if (prewarmedCall.ok === true && appAcquiredMediaRef.current && !prewarmAppAcquiredMedia) {
          releaseAppAcquiredMedia("prewarmed_call_reused");
        } else if (hasAppAcquiredVideoTrack && appAcquiredMediaRef.current) {
          appAcquiredMediaRef.current.consumedByDaily = true;
          vdbg("daily_call_object_app_acquired_media_used", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            captureProfile: captureProfileForCall,
            audioTrackId: appAcquiredMediaForCall?.audioTrack?.id ?? null,
            videoTrackId: appAcquiredMediaForCall?.videoTrack?.id ?? null,
            videoTrack: summarizeVideoTrackSettings(appAcquiredMediaForCall?.videoTrack),
          });
        }
        dailyPrewarmConsumedForJoin = prewarmedCall.ok === true;
        callObjectRef.current = callObject;
        vdbg("daily_call_object_created", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          entryAttemptId,
          videoDateTraceId,
          reusedCallObject: prewarmedCall.ok === true,
          reusedJoinedCallObject: prewarmedAlreadyJoined,
          reusedJoinInFlight: Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined),
          appAcquiredMediaUsed: hasAppAcquiredVideoTrack && prewarmedCall.ok === false,
          prewarmFallbackReason: prewarmedCall.ok === false ? prewarmedCall.reason : null,
        });

        const getRemoteParticipantCount = () => {
          const activeCall = callObjectRef.current;
          if (!activeCall) return 0;
          try {
            return Object.values(activeCall.participants()).filter((p) => !p.local).length;
          } catch {
            return 0;
          }
        };

        const getMeetingState = () => {
          const activeCall = callObjectRef.current as (DailyCall & { meetingState?: () => unknown }) | null;
          if (!activeCall || typeof activeCall.meetingState !== "function") return null;
          try {
            const state = activeCall.meetingState();
            return typeof state === "string" ? state : String(state);
          } catch {
            return null;
          }
        };

        const logTransportState = (message: string, extra?: Record<string, unknown>) => {
          vdbg(message, {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            localParticipantId: latestLocalParticipantRef.current?.session_id ?? null,
            entryAttemptId,
            videoDateTraceId,
            remoteParticipantCount: getRemoteParticipantCount(),
            dailyMeetingState: getMeetingState(),
            videoSessionState: optionsRef.current?.videoSessionState ?? null,
            localJoined: activeCallSessionIdRef.current === sessionId,
            localDecisionPersisted: optionsRef.current?.localDecisionPersisted ?? null,
            reconnectState: reconnectGraceActiveRef.current ? "interrupted" : "connected",
            ...extra,
          });
        };

        const syncReconnectOnce = async (reason: string) => {
          if (reconnectSyncRequestedRef.current) return;
          reconnectSyncRequestedRef.current = true;
          const args = { p_session_id: sessionId, p_action: "sync_reconnect" };
          vdbg("video_date_transition_before", { action: "sync_reconnect", args, reason });
          const { data, error } = await supabase.rpc("video_date_transition", args);
          vdbg("video_date_transition_after", {
            action: "sync_reconnect",
            ok: !error,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
            reason,
          });
          if (error) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_SYNC_RECONNECT_FAILED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
              code: error.code ?? null,
            });
          }
        };

        const clearReconnectGrace = (reason: string, recovered: boolean) => {
          if (!reconnectGraceActiveRef.current) return;
          clearReconnectGraceTimers();
          reconnectGraceActiveRef.current = false;
          reconnectSyncRequestedRef.current = false;
          setReconnectGraceTimeLeft(0);
          logTransportState("reconnect_grace_cleared", { reason, recovered });
          if (recovered) {
            setDailyReconnectState("recovered");
            logTransportState("daily_transport_recovered", { reason });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_RECOVERED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            optionsRef.current?.onPartnerTransientRecover?.();
            if (reconnectRecoveryResetTimeoutRef.current) {
              clearTimeout(reconnectRecoveryResetTimeoutRef.current);
            }
            reconnectRecoveryResetTimeoutRef.current = setTimeout(() => {
              reconnectRecoveryResetTimeoutRef.current = null;
              if (!reconnectGraceActiveRef.current) {
                setDailyReconnectState("connected");
              }
            }, 1200);
          } else {
            setDailyReconnectState("connected");
          }
        };

        const startReconnectGrace = (reason: string) => {
          if (reconnectGraceActiveRef.current) {
            logTransportState("daily_transport_reconnecting", { reason, duplicate: true });
            return;
          }
          reconnectGraceActiveRef.current = true;
          reconnectSyncRequestedRef.current = false;
          const deadlineMs = Date.now() + DAILY_TRANSPORT_RECONNECT_GRACE_MS;
          const remainingSeconds = () =>
            Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
          const expireGrace = () => {
            if (!reconnectGraceActiveRef.current) return;
            clearReconnectGraceTimers();
            reconnectGraceActiveRef.current = false;
            reconnectSyncRequestedRef.current = false;
            setReconnectGraceTimeLeft(0);
            setDailyReconnectState("failed_after_grace");
            logTransportState("reconnect_grace_expired", { reason });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_EXPIRED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_EXPIRED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            if (!reconnectPartnerAwayTriggeredRef.current) {
              reconnectPartnerAwayTriggeredRef.current = true;
              optionsRef.current?.onPartnerLeft?.();
            }
          };
          setDailyReconnectState("interrupted");
          setReconnectGraceTimeLeft(remainingSeconds());
          logTransportState("daily_transport_disconnected", { reason });
          logTransportState("reconnect_grace_started", { reason, graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            reason,
          });
          optionsRef.current?.onPartnerTransientDisconnect?.();
          void syncReconnectOnce(reason);

          reconnectGraceTickerRef.current = setInterval(() => {
            const next = remainingSeconds();
            setReconnectGraceTimeLeft(next);
            if (next <= 0) expireGrace();
          }, 1000);

          reconnectGraceTimeoutRef.current = setTimeout(expireGrace, DAILY_TRANSPORT_RECONNECT_GRACE_MS);
        };

        const recoverTransport = (reason: string) => {
          if (!reconnectGraceActiveRef.current) {
            reconnectSyncRequestedRef.current = false;
            setReconnectGraceTimeLeft(0);
            setDailyReconnectState("connected");
            return;
          }
          setDailyReconnectState("partner_reconnecting");
          clearReconnectGrace(reason, true);
          if (reconnectPartnerAwayTriggeredRef.current) {
            reconnectPartnerAwayTriggeredRef.current = false;
            const returnArgs = { p_session_id: sessionId, p_action: "mark_reconnect_return" };
            vdbg("video_date_transition_before", { action: "mark_reconnect_return", args: returnArgs, reason });
            void supabase.rpc("video_date_transition", returnArgs).then(({ data, error }) => {
              vdbg("video_date_transition_after", {
                action: "mark_reconnect_return",
                ok: !error,
                payload: data ?? null,
                error: error ? { code: error.code, message: error.message } : null,
                reason,
              });
            });
          }
          void syncReconnectOnce(`${reason}_recovered`);
        };

        callObject.on("participant-joined", (event) => {
          if (event && !event.participant?.local) {
            recoverTransport("participant_joined");
            latestRemoteParticipantRef.current = event.participant;
            resetRemoteRenderRecoveryForParticipant(event.participant);
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              clearFirstRemoteWatchdog();
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                source: "participant_joined",
              });
              const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                sessionId,
                platform: "web",
                eventId: truthRow.event_id ?? eventId,
                sourceSurface: "video_date_daily",
                checkpoint: "remote_seen",
                entryAttemptId,
                videoDateTraceId,
                cachedPrepareEntry: roomResult.cached,
                providerVerifySkipped: roomData.provider_verify_skipped ?? null,
              });
              const latencyPayload = buildReadyGateToDateLatencyPayload({
                context: latencyContext,
                checkpoint: "remote_seen",
                sourceAction: "participant_joined",
                outcome: "success",
              });
              trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source_surface: "video_date_daily",
                source_action: "participant_joined",
                source: "participant_joined",
                duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
                latency_bucket: latencyPayload.latency_bucket,
              });
            }
            setIsConnected(true);
            setIsConnecting(false);
            setPeerMissing({ terminal: false });
            toast.success("You're both here. Starting gently.");
            optionsRef.current?.onPartnerJoined?.();
            attachTracks(event.participant, remoteVideoRef.current, false);
          }
        });

        callObject.on("participant-updated", (event) => {
          if (!event?.participant) return;
          if (event.participant.local) {
            latestLocalParticipantRef.current = event.participant;
            const localKey = getTrackIdsKey(event.participant, false);
            const localKeyChanged = localKey !== lastLocalTrackIdsRef.current;
            if (localKeyChanged) {
              const newStream = buildStreamFromParticipant(event.participant, { includeAudio: false });
              lastLocalTrackIdsRef.current = localKey;
              lastLocalStreamRef.current = newStream;
              setLocalStream(newStream);
              vdbg("daily_local_tracks_changed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                key: localKey,
              });
            }
            if (localVideoRef.current && (localKeyChanged || needsTrackReattach(localVideoRef.current, event.participant, true))) {
              attachTracks(event.participant, localVideoRef.current, true);
              logTrackMounted("participant_updated", {
                isLocal: true,
                participant: event.participant,
                roomName: roomData.room_name ?? null,
              });
            }
          } else {
            recoverTransport("participant_updated");
            latestRemoteParticipantRef.current = event.participant;
            resetRemoteRenderRecoveryForParticipant(event.participant);
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              clearFirstRemoteWatchdog();
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                source: "participant_updated",
              });
              const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                sessionId,
                platform: "web",
                eventId: truthRow.event_id ?? eventId,
                sourceSurface: "video_date_daily",
                checkpoint: "remote_seen",
                entryAttemptId,
                videoDateTraceId,
                cachedPrepareEntry: roomResult.cached,
                providerVerifySkipped: roomData.provider_verify_skipped ?? null,
              });
              const latencyPayload = buildReadyGateToDateLatencyPayload({
                context: latencyContext,
                checkpoint: "remote_seen",
                sourceAction: "participant_updated",
                outcome: "success",
              });
              trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source_surface: "video_date_daily",
                source_action: "participant_updated",
                source: "participant_updated",
                duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
                latency_bucket: latencyPayload.latency_bucket,
              });
            }
            const remoteKey = getTrackIdsKey(event.participant, true);
            const remoteKeyChanged = remoteKey !== lastRemoteTrackIdsRef.current;
            let remoteRenderValidationSource = remoteKeyChanged
              ? "participant_updated_track_changed"
              : "participant_updated_same_track";
            const cameraSwitchRenderWatch = activeRemoteCameraSwitchRenderWatchRef.current;
            const cameraSwitchRenderWatchActive = Boolean(
              cameraSwitchRenderWatch && cameraSwitchRenderWatch.expiresAtMs > Date.now()
            );
            if (cameraSwitchRenderWatch && !cameraSwitchRenderWatchActive) {
              activeRemoteCameraSwitchRenderWatchRef.current = null;
            }
            if (remoteKeyChanged) {
              lastRemoteTrackIdsRef.current = remoteKey;
              resetRemoteRenderRecoveryAttempts();
              if (remoteVideoRef.current) {
                attachTracks(event.participant, remoteVideoRef.current, false);
                logTrackMounted("participant_updated", {
                  isLocal: false,
                  participant: event.participant,
                  roomName: roomData.room_name ?? null,
                });
              }
              lastRemoteStreamRef.current = null;
              vdbg("daily_remote_tracks_changed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                key: remoteKey,
              });
            } else if (
              remoteVideoRef.current &&
              needsTrackReattach(remoteVideoRef.current, event.participant, false)
            ) {
              remoteRenderValidationSource = "participant_updated_reattach";
              attachTracks(event.participant, remoteVideoRef.current, false);
              logTrackMounted("participant_updated_reattach", {
                isLocal: false,
                participant: event.participant,
                roomName: roomData.room_name ?? null,
              });
            }
            const sameTrackCameraSwitchCandidate =
              !remoteKeyChanged && remoteRenderValidationSource === "participant_updated_same_track";
            const useFreshFrameGuard =
              cameraSwitchRenderWatchActive || sameTrackCameraSwitchCandidate;
            const freshFrameGuardBaseline = useFreshFrameGuard
              ? readRemoteRenderFrameState(remoteVideoRef.current)
              : null;
            if (cameraSwitchRenderWatchActive && !remoteKeyChanged && remoteKey) {
              // Hint receiver already armed the freshness watcher for this
              // switchId. Don't double-arm and do NOT tear down srcObject;
              // the persistentTrack is still live and decoding the new camera
              // frames as soon as the next keyframe arrives.
              vdbg("daily_camera_switch_render_watch_participant_update", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                switchId: cameraSwitchRenderWatch?.switchId ?? null,
                remoteRenderValidationSource,
                remoteKey,
                freshFrameBaseline: freshFrameGuardBaseline,
              });
            } else {
              scheduleRemoteRenderValidation(
                event.participant,
                cameraSwitchRenderWatchActive
                  ? `${remoteRenderValidationSource}_camera_switch_watch`
                  : remoteRenderValidationSource,
                roomData.room_name ?? null,
                cameraSwitchRenderWatchActive ? "camera_switch_hint" : remoteRenderValidationSource,
                useFreshFrameGuard
                  ? {
                      requireFreshFrame: true,
                      freshFrameBaseline: freshFrameGuardBaseline,
                      freshFrameTimeoutMs: REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
                    }
                  : undefined
              );
            }
          }
        });

        callObject.on("participant-left", (event) => {
          if (event && !event.participant?.local) {
            clearRemoteRenderValidation({ cancelReattach: true });
            resetRemoteRenderRecoveryAttempts();
            lastRemoteRenderParticipantIdRef.current = null;
            lastRemoteCameraSwitchHintIdRef.current = null;
            activeRemoteCameraSwitchRenderWatchRef.current = null;
            setIsConnected(false);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            setRemotePlayback(createRemotePlaybackState());
            if (!reconnectGraceActiveRef.current) {
              startReconnectGrace("participant_left");
            }
            setDailyReconnectState("partner_left_grace");
            if (!reconnectPartnerAwayTriggeredRef.current) {
              reconnectPartnerAwayTriggeredRef.current = true;
              optionsRef.current?.onPartnerLeft?.();
            }
            if (reconnectGraceActiveRef.current) {
              logTransportState("daily_transport_reconnecting", {
                reason: "participant_left_during_grace",
              });
            }
          }
        });

        callObject.on("error", (event) => {
          console.error("[Daily] Fatal error:", event);
          const errorMsg =
            event && typeof event === "object" && "errorMsg" in event
              ? String((event as { errorMsg?: unknown }).errorMsg)
              : undefined;
          vdbg("daily_call_error", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            errorMsg: errorMsg ?? null,
          });
          const lowered = (errorMsg ?? "").toLowerCase();
          if (lowered.includes("stale")) {
            logTransportState("daily_ws_stale", { errorMsg: errorMsg ?? null });
            startReconnectGrace("daily_ws_stale");
            return;
          }
          if (lowered.includes("reconnect") || lowered.includes("transport")) {
            startReconnectGrace("daily_transport_error");
            return;
          }
          toast.error("Connection error. Please try again.");
          setIsConnecting(false);
          setIsConnected(false);
        });

        callObject.on("left-meeting", () => {
          clearReconnectGrace("left_meeting", false);
          clearRemoteRenderValidation({ cancelReattach: true });
          resetRemoteRenderRecoveryAttempts();
          lastRemoteRenderParticipantIdRef.current = null;
          lastRemoteCameraSwitchHintIdRef.current = null;
          activeRemoteCameraSwitchRenderWatchRef.current = null;
          vdbg("daily_call_left_meeting", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
          });
          setIsConnected(false);
          setIsConnecting(false);
          setRemotePlayback((prev) => ({
            ...prev,
            participantPresent: false,
            mediaAttached: false,
            playSucceeded: false,
            firstFrameRendered: false,
          }));
        });

        callObject.on("network-connection", (event: { event?: string } | undefined) => {
          if (event?.event === "interrupted") {
            logTransportState("daily_network_interrupted", { networkEvent: event.event });
            startReconnectGrace("network_interrupted");
            return;
          }
          if (event?.event === "reconnecting") {
            startReconnectGrace("network_reconnecting");
            setDailyReconnectState("partner_reconnecting");
            logTransportState("daily_transport_reconnecting", { networkEvent: event.event });
            return;
          }
          if (event?.event === "reconnected" || event?.event === "connected") {
            recoverTransport(`network_${event.event}`);
          }
        });

        callObject.on("nonfatal-error", (event) => {
          logTransportState("daily_nonfatal_error", {
            event:
              event && typeof event === "object"
                ? JSON.parse(JSON.stringify(event))
                : String(event),
          });
        });

        callObject.on("app-message", (event) => {
          const hint = parseVideoDateCameraSwitchRenderHint(
            event && typeof event === "object" && "data" in event ? (event as { data?: unknown }).data : undefined
          );
          logTransportState("daily_app_message", {
            hasData: Boolean(event && typeof event === "object" && "data" in (event as object)),
            isCameraSwitchRenderHint: Boolean(hint),
          });
          if (!hint) return;

          const fromId =
            event && typeof event === "object" && "fromId" in event
              ? String((event as { fromId?: unknown }).fromId ?? "")
              : "";
          const localSessionId =
            latestLocalParticipantRef.current?.session_id ?? callObject.participants().local?.session_id ?? "";
          if (fromId && localSessionId && fromId === localSessionId) {
            vdbg("daily_camera_switch_render_hint_ignored", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              switchId: hint.switchId,
              sourcePlatform: hint.sourcePlatform,
              reason: "self_origin",
            });
            return;
          }

          const participant = latestRemoteParticipantRef.current;
          const isNewCameraSwitchHint = lastRemoteCameraSwitchHintIdRef.current !== hint.switchId;
          const freshFrameBaseline = readRemoteRenderFrameState(remoteVideoRef.current);
          activeRemoteCameraSwitchRenderWatchRef.current = {
            switchId: hint.switchId,
            expiresAtMs: Date.now() + REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
          };
          if (isNewCameraSwitchHint) {
            lastRemoteCameraSwitchHintIdRef.current = hint.switchId;
            resetRemoteRenderRecoveryAttempts();
          }
          vdbg("daily_camera_switch_render_hint_received", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            switchId: hint.switchId,
            sourcePlatform: hint.sourcePlatform,
            facingMode: hint.facingMode,
            commitConfirmed: hint.commitConfirmed,
            commitMethod: hint.commitMethod,
            localVideoTrackId: hint.localVideoTrackId,
            commitLatencyMs: hint.commitLatencyMs,
            fromId: fromId || null,
            hasRemoteParticipant: Boolean(participant),
            isNewCameraSwitchHint,
            freshFrameBaseline,
          });
          vdbg("daily_camera_switch_render_watch_started", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            switchId: hint.switchId,
            sourcePlatform: hint.sourcePlatform,
            facingMode: hint.facingMode,
            isNewCameraSwitchHint,
            freshFrameBaseline,
            watchTtlMs: REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
            freshFrameTimeoutMs: REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
          });
          // Daily's cycleCamera / setCamera (and replaceTrack on the wire) keep
          // the receiver's persistentTrack live; only the underlying camera
          // source changes. Tearing down `srcObject` and rebinding the same
          // track destroys the decoder pipeline and forces the receiver to
          // wait for the next periodic keyframe (multi-second on Safari /
          // cellular), which is exactly the "black screen" symptom this fix
          // exists to prevent. So: do NOT call forceRemoteMediaReattach on
          // hint receipt. Arm the freshness watcher instead, with a longer
          // timeout that covers a natural keyframe interval. If frames still
          // don't arrive after the watchdog, the validator escalates to one
          // last-resort reattach via its existing timeout path.
          scheduleRemoteRenderValidation(
            participant,
            "app_message_camera_switch_hint",
            roomData.room_name ?? null,
            "camera_switch_hint",
            {
              requireFreshFrame: true,
              freshFrameBaseline,
              freshFrameTimeoutMs: REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
            }
          );
        });

        callObject.on("network-quality-change", (event: { threshold?: string; quality?: number }) => {
          setNetworkTier(tierFromNetworkQualityEvent(event));
        });

        callObject.on("camera-error", (event) => {
          const rawErrorMsg =
            event && typeof event === "object" && "errorMsg" in event
              ? (event as { errorMsg?: unknown }).errorMsg
              : undefined;
          const errorMsg =
            typeof rawErrorMsg === "string"
              ? rawErrorMsg
              : rawErrorMsg && typeof rawErrorMsg === "object" && "errorMsg" in rawErrorMsg
                ? String((rawErrorMsg as { errorMsg?: unknown }).errorMsg ?? "")
                : undefined;
          const rawError =
            event && typeof event === "object" && "error" in event
              ? (event as { error?: unknown }).error
              : undefined;
          vdbg("daily_camera_error", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            errorMsg: errorMsg ?? null,
            error: rawError ?? null,
          });
          setHasPermission(false);
          setMediaPermissionError(errorMsg ?? "Camera or microphone permission was denied.");
          trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
          });
          Sentry.captureMessage("daily_camera_error", { level: "error", extra: { event } });
        });

        callObject.on("track-stopped", (event) => {
          if (!event?.participant?.local) return;
          vdbg("daily_local_track_stopped", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            trackKind: event?.track?.kind ?? null,
            participantSessionId: event?.participant?.session_id ?? null,
          });
        });

        const dailyJoinStartedAtMs = Date.now();
        dailyJoinStartedAtMsRef.current = dailyJoinStartedAtMs;
        const prepareToJoinStartMs = Math.max(0, dailyJoinStartedAtMs - roomResult.cacheEntry.prepareFinishedAtMs);
        const joinStartLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: truthRow.event_id ?? eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_started",
          nowMs: dailyJoinStartedAtMs,
          attemptCount: opts?.internalRetry ? 2 : 1,
          entryAttemptId,
          videoDateTraceId,
          cachedPrepareEntry: roomResult.cached,
          providerVerifySkipped: roomData.provider_verify_skipped ?? null,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: joinStartLatencyContext,
            checkpoint: "daily_join_started",
            sourceAction: opts?.internalRetry ? "daily_join_retry_started" : "daily_join_started",
            outcome: "success",
            attemptCount: opts?.internalRetry ? 2 : 1,
          }),
        );
        vdbg("daily_join_start", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          hasToken: Boolean(roomData.token),
          captureProfile: captureProfileForCall,
          prepareToJoinStartMs,
          cachedPrepareEntry: roomResult.cached,
          entryAttemptId,
          videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: opts?.internalRetry ? "daily_join_retry_started" : "daily_join_started",
          capture_profile: captureProfileForCall,
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          cached_prepare_entry: roomResult.cached,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        if (prewarmedAlreadyJoined) {
          vdbg("daily_join_skipped_prewarmed_already_joined", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource: prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else if (prewarmedJoinPromise) {
          const prewarmedJoinOk = await prewarmedJoinPromise;
          if (!prewarmedJoinOk) throw new Error("daily_prewarm_join_failed");
          vdbg("daily_join_completed_by_prewarm_inflight", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource: prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else {
          await callObject.join({ url: roomData.room_url, token: roomData.token });
        }
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        setHasPermission(true);
        activeCallSessionIdRef.current = sessionId;
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          joinDurationMs,
          entryAttemptId,
          videoDateTraceId,
        });
        const joinSuccessLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: truthRow.event_id ?? eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_success",
          nowMs: Date.now(),
          attemptCount: opts?.internalRetry ? 2 : 1,
          entryAttemptId,
          videoDateTraceId,
          cachedPrepareEntry: roomResult.cached,
          providerVerifySkipped: roomData.provider_verify_skipped ?? null,
        });
        const joinSuccessPayload = buildReadyGateToDateLatencyPayload({
          context: joinSuccessLatencyContext,
          checkpoint: "daily_join_success",
          sourceAction: "daily_join_success",
          outcome: "success",
          durationMs: joinSuccessLatencyContext.readyGateOpenedAtMs == null
            ? joinDurationMs
            : undefined,
          attemptCount: opts?.internalRetry ? 2 : 1,
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, joinSuccessPayload);
        trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_COMPLETED, joinSuccessPayload);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_SUCCESS, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: "daily_join_success",
          capture_profile: captureProfileForCall,
          joinDurationMs,
          duration_ms: joinDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(joinDurationMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          bothReadyToDailyJoinMs: joinSuccessPayload.bothReadyToDailyJoinMs,
          prepareToJoinStartMs,
          cached_prepare_entry: roomResult.cached,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOINED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          capture_profile: captureProfileForCall,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });

        const joinedArgs = { p_session_id: sessionId };
        vdbg("mark_video_date_daily_joined_before", {
          args: joinedArgs,
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
        });
        void markDailyJoinedWithBackoff({
          sleep,
          confirm: async (attempt) => {
            const { data: joinedData, error: joinedError } = await supabase.rpc(
              "mark_video_date_daily_joined",
              joinedArgs
            );
            const payload = joinedData as { ok?: boolean; error?: string | null } | null;
            const ok = !joinedError && payload?.ok === true;
            const code = joinedError?.code ?? payload?.error ?? null;
            vdbg("mark_video_date_daily_joined_after", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              attempt,
              ok,
              payload: joinedData ?? null,
              error: joinedError ? { code: joinedError.code, message: joinedError.message } : null,
            });
            return {
              ok,
              code,
              retryable: joinedError ? true : undefined,
              error: joinedError ?? undefined,
              payload: joinedData ?? null,
            };
          },
          onAttemptResult: ({ attempt, ok, code, retryable, willRetry }) => {
            if (!ok && attempt === 1) {
              trackEvent(LobbyPostDateEvents.MARK_VIDEO_DATE_DAILY_JOINED_FAILED, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                code,
                retryable,
                will_retry: willRetry,
                entry_attempt_id: entryAttemptId,
                video_date_trace_id: videoDateTraceId,
              });
              toast.info("Keeping your date state in sync...", { duration: 3000 });
            }
            if (attempt > 1) {
              vdbg("mark_video_date_daily_joined_retry_after_failure", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                attempt,
                ok,
                code,
                retryable,
                willRetry,
              });
            }
          },
        }).then((joinedConfirmation) => {
          if (!joinedConfirmation.ok) {
            void emitWebVideoDateClientStuckState({
              sessionId,
              eventName: "daily_join_confirmation_failed",
              payload: {
                source_surface: "video_date_daily",
                source_action: "mark_video_date_daily_joined",
                reason_code: joinedConfirmation.code ?? "unknown",
                code: joinedConfirmation.code ?? "unknown",
                retryable: joinedConfirmation.retryable,
                exhausted: joinedConfirmation.exhausted,
                attempt_count: joinedConfirmation.attempts,
                entry_attempt_id: entryAttemptId ?? undefined,
                video_date_trace_id: videoDateTraceId ?? undefined,
              },
            });
          }
        });

        const localParticipant = callObject.participants().local;
        if (localParticipant) {
          latestLocalParticipantRef.current = localParticipant;
          const localKey = getTrackIdsKey(localParticipant, false);
          if (localKey !== lastLocalTrackIdsRef.current) {
            const newStream = buildStreamFromParticipant(localParticipant, { includeAudio: false });
            lastLocalTrackIdsRef.current = localKey;
            lastLocalStreamRef.current = newStream;
            setLocalStream(newStream);
            vdbg("daily_local_tracks_changed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              key: localKey,
            });
          }
          if (localVideoRef.current) {
            attachTracks(localParticipant, localVideoRef.current, true);
            logTrackMounted("post_join_snapshot", {
              isLocal: true,
              participant: localParticipant,
              roomName: roomData.room_name ?? null,
            });
          }
          if (!localVideoReadyTrackedRef.current) {
            localVideoReadyTrackedRef.current = true;
            const localVideoContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "web",
              eventId: truthRow.event_id ?? eventId,
              sourceSurface: "video_date_daily",
              checkpoint: "local_video_ready",
            });
            trackEvent(
              LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
              buildReadyGateToDateLatencyPayload({
                context: localVideoContext,
                checkpoint: "local_video_ready",
                sourceAction: "post_join_snapshot",
                outcome: "success",
              }),
            );
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_LOCAL_VIDEO_READY, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: "post_join_snapshot",
            });
          }
        }

        const participants = callObject.participants();
        const remoteParticipants = Object.values(participants).filter((p) => !p.local);
        if (remoteParticipants.length > 0) {
          latestRemoteParticipantRef.current = remoteParticipants[0];
          resetRemoteRenderRecoveryForParticipant(remoteParticipants[0]);
          if (!firstRemoteObservedRef.current) {
            firstRemoteObservedRef.current = true;
            clearFirstRemoteWatchdog();
            vdbg("first_remote_participant_seen", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              source: "post_join_snapshot",
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "web",
              eventId: truthRow.event_id ?? eventId,
              sourceSurface: "video_date_daily",
              checkpoint: "remote_seen",
            });
            const latencyPayload = buildReadyGateToDateLatencyPayload({
              context: latencyContext,
              checkpoint: "remote_seen",
              sourceAction: "post_join_snapshot",
              outcome: "success",
            });
            trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: "post_join_snapshot",
              source: "post_join_snapshot",
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
          setIsConnected(true);
          setIsConnecting(false);
          setPeerMissing({ terminal: false });
          toast.success("You're both here. Starting gently.");
          optionsRef.current?.onPartnerJoined?.();
          attachTracks(remoteParticipants[0], remoteVideoRef.current, false);
          logTrackMounted("post_join_snapshot", {
            isLocal: false,
            participant: remoteParticipants[0],
            roomName: roomData.room_name ?? null,
          });
        } else {
          vdbg("daily_no_remote_watchdog_start", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            timeoutMs: FIRST_REMOTE_TIMEOUT_MS,
            autoRecoveryCount: noRemoteAutoRecoveryCountRef.current,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_WAIT_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            timeout_ms: FIRST_REMOTE_TIMEOUT_MS,
            auto_recovery_count: noRemoteAutoRecoveryCountRef.current,
          });
          firstRemoteWatchdogRef.current = setTimeout(() => {
            if (
              startAttemptNonceRef.current !== startNonce ||
              !callObjectRef.current ||
              firstRemoteObservedRef.current
            ) {
              return;
            }
            vdbg("daily_no_remote_watchdog_timeout", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              autoRecoveryCount: noRemoteAutoRecoveryCountRef.current,
            });
            if (noRemoteAutoRecoveryCountRef.current < 2) {
              noRemoteAutoRecoveryCountRef.current += 1;
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                attempt: noRemoteAutoRecoveryCountRef.current,
              });
              void (async () => {
                await cleanupCallObject("startCall", "no_remote_auto_recovery");
                vdbg("daily_no_remote_watchdog_recovery", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  result: "rejoin_scheduled",
                  attempt: noRemoteAutoRecoveryCountRef.current,
                });
                void startCall(sessionId, { internalRetry: true });
              })();
              return;
            }
            setIsConnecting(false);
            setIsConnected(false);
            setPeerMissing({ terminal: true });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              attempt_count: noRemoteAutoRecoveryCountRef.current,
            });
            void emitWebVideoDateClientStuckState({
              sessionId,
              eventName: "peer_missing_terminal",
              latencyMs: FIRST_REMOTE_TIMEOUT_MS,
              payload: {
                source_surface: "video_date_daily",
                source_action: "first_remote_watchdog",
                reason_code: "peer_missing_timeout",
                watchdog_ms: FIRST_REMOTE_TIMEOUT_MS,
                auto_recovery_count: noRemoteAutoRecoveryCountRef.current,
              },
            });
            toast.info("They're not in the room yet. We'll keep this gentle.");
          }, FIRST_REMOTE_TIMEOUT_MS);
        }

        return { ok: true } as VideoCallStartResult;
      } catch (error) {
        console.error("[Daily] Failed to start call:", error);
        const preparedEntryAtFailure = activePreparedEntryCacheRef.current;
        vdbg("daily_join_failure", {
          sessionId,
          eventId,
          userId,
          roomName: roomNameRef.current,
          captureProfile: captureProfileRef.current,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          entryAttemptId: preparedEntryAtFailure?.entryAttemptId ?? null,
          videoDateTraceId: preparedEntryAtFailure?.value.video_date_trace_id ?? preparedEntryAtFailure?.entryAttemptId ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "video_date_daily",
          source_action: "daily_join_failure",
          capture_profile: captureProfileRef.current,
          reason: "daily_join_failed",
          reason_code: "daily_join_failed",
          entry_attempt_id: preparedEntryAtFailure?.entryAttemptId ?? null,
          video_date_trace_id: preparedEntryAtFailure?.value.video_date_trace_id ?? preparedEntryAtFailure?.entryAttemptId ?? null,
        });
        const failureContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_failure",
          attemptCount: opts?.internalRetry ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: failureContext,
            checkpoint: "daily_join_failure",
            sourceAction: "daily_join_failure",
            outcome: "failure",
            reasonCode: "daily_join_failed",
            attemptCount: opts?.internalRetry ? 2 : 1,
          }),
        );
        if (dailyPrewarmConsumedForJoin && userId) {
          markWebVideoDateDailyPrewarmFallback({
            sessionId,
            userId,
            eventId,
            reason: "daily_join_failed_after_prewarm_consumed",
          });
        }
        await cleanupCallObject("startCall", "start_failure");
        if (preparedEntryAtFailure && userId && !opts?.internalRetry) {
          rejectPreparedVideoDateEntry(sessionId, userId, "daily_join_failed", eventId);
          startCallInFlightSessionRef.current = null;
          vdbg("daily_join_failure_prepare_retry", {
            sessionId,
            eventId,
            userId,
            roomName: preparedEntryAtFailure.value.room_name,
            reason: "prepared_token_rejected_before_retry",
          });
          return startCall(sessionId, { internalRetry: true });
        }
        setHasPermission(false);
        toast.error("Video is temporarily unavailable. Please try again.");
        setIsConnecting(false);
        return {
          ok: false,
          failure: { kind: "daily_join_failed", retryable: true },
        } as VideoCallStartResult;
      } finally {
        if (startCallInFlightSessionRef.current === sessionId) {
          startCallInFlightSessionRef.current = null;
        }
      }
    },
    [
      acquireDateRoom,
      attachTracks,
      cleanupCallObject,
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      fetchVideoDateTruth,
      logTrackMounted,
      needsTrackReattach,
      preflightMediaPermission,
      releaseAppAcquiredMedia,
      resetRemoteRenderRecoveryAttempts,
      resetRemoteRenderRecoveryForParticipant,
      scheduleRemoteRenderValidation,
      clearRemoteRenderValidation,
    ]
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      const localParticipant = latestLocalParticipantRef.current;
      const remoteParticipant = latestRemoteParticipantRef.current;

      if (localVideoRef.current && needsTrackReattach(localVideoRef.current, localParticipant, true)) {
        attachTracks(localParticipant, localVideoRef.current, true);
        logTrackMounted("maintenance_reattach", {
          isLocal: true,
          participant: localParticipant,
          roomName: roomNameRef.current,
        });
      }

      if (remoteVideoRef.current && needsTrackReattach(remoteVideoRef.current, remoteParticipant, false)) {
        attachTracks(remoteParticipant, remoteVideoRef.current, false);
        logTrackMounted("maintenance_reattach", {
          isLocal: false,
          participant: remoteParticipant,
          roomName: roomNameRef.current,
        });
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [attachTracks, logTrackMounted, needsTrackReattach]);

  const retryRemotePlayback = useCallback(() => {
    const participant = latestRemoteParticipantRef.current;
    const videoEl = remoteVideoRef.current;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RETRY, {
      platform: "web",
      session_id: optionsRef.current?.roomId ?? null,
      event_id: optionsRef.current?.eventId ?? null,
    });
    setRemotePlayback((prev) => ({
      ...prev,
      playRejected: false,
      error: undefined,
      retryCount: prev.retryCount + 1,
    }));

    if (!participant || !videoEl) {
      vdbg("daily_remote_video_play_retry_skipped", {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        hasParticipant: Boolean(participant),
        hasVideoElement: Boolean(videoEl),
      });
      return;
    }

    vdbg("daily_remote_video_play_retry", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      participantSessionId: participant.session_id ?? null,
    });
    attachTracks(participant, videoEl, false);
  }, [attachTracks]);

  const clearPeerMissing = useCallback(() => {
    setPeerMissing({ terminal: false });
  }, []);

  const clearMediaPermissionError = useCallback(() => {
    setMediaPermissionError(null);
  }, []);

  const endCall = useCallback(
    async (reason = "manual_end") => {
      const roomName = roomNameRef.current;
      const sessionId = optionsRef.current?.roomId ?? null;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      await cleanupCallObject("endCall", reason);

      if (roomName) {
        vdbg("daily_room_delete_skipped", {
          action: "delete_room",
          caller: "useVideoCall.endCall",
          reason: "backend_cleanup_owns_video_date_rooms",
          endReason: reason,
          sessionId,
          eventId,
          userId,
          roomName,
        });
        roomNameRef.current = null;
      }

      optionsRef.current?.onCallEnded?.();
    },
    [cleanupCallObject]
  );

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      const newMuted = !isMuted;
      co.setLocalAudio(!newMuted);
      setIsMuted(newMuted);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      const newOff = !isVideoOff;
      co.setLocalVideo(!newOff);
      setIsVideoOff(newOff);
    }
  }, [isVideoOff]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const co = callObjectRef.current;
      if (!co || (typeof co.cycleCamera !== "function" && typeof co.setInputDevicesAsync !== "function")) {
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      try {
        const devices = await enumerateWebVideoDevices(co);
        if (!cancelled) setCanFlipCamera(!isVideoOff && devices.length > 1);
      } catch {
        if (!cancelled) setCanFlipCamera(!isVideoOff && typeof co.cycleCamera === "function");
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [isConnected, isVideoOff, localStream]);

  const flipCamera = useCallback(async () => {
    const co = callObjectRef.current;
    if (!co || isFlippingCamera || cameraSwitchInFlightRef.current || isVideoOff) return;
    if (typeof co.cycleCamera !== "function" && typeof co.setInputDevicesAsync !== "function") {
      setCanFlipCamera(false);
      return;
    }

    cameraSwitchInFlightRef.current = true;
    setIsFlippingCamera(true);
    try {
      const before = readLocalCameraSnapshot(co);
      const desiredFacing = oppositeCameraFacingMode(before.facingMode);
      const forceVideoSourceRefresh = isWebKitCameraSwitchRuntime();
      let commit: WebCameraSwitchCommit | null = null;

      try {
        commit = await switchToDeterministicWebCamera(co, before, desiredFacing, {
          forceVideoSourceRefresh,
        });
      } catch (error) {
        vdbg("daily_camera_switch_deterministic_publish_refresh_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          forceVideoSourceRefresh,
          error: describeCameraSwitchError(error),
        });
      }

      if (!commit && typeof co.cycleCamera === "function") {
        const result = await co.cycleCamera({ preferDifferentFacingMode: true });
        const resultDevice = result?.device as WebCameraDevice | null | undefined;
        commit = await waitForLocalCameraSwitchCommit(co, before, "cycle_camera", {
          expectedDeviceId: getDeviceId(resultDevice),
          expectedFacing: getDeviceFacingMode(resultDevice) ?? desiredFacing,
        });
      }

      if (!commit) {
        const after = readLocalCameraSnapshot(co);
        vdbg("daily_camera_switch_commit_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          desiredFacing,
          forceVideoSourceRefresh,
          before,
          after,
        });
        trackEvent("video_date_camera_switch_commit_failed", {
          platform: "web",
          session_id: activeCallSessionIdRef.current,
          event_id: optionsRef.current?.eventId ?? null,
          source_surface: "video_date_call",
          source_action: "camera_switch_commit_failed",
          desired_facing_mode: desiredFacing,
          before_track_id: before.trackId,
          before_device_id: before.deviceId,
          before_facing_mode: before.facingMode,
          after_track_id: after.trackId,
          after_device_id: after.deviceId,
          after_facing_mode: after.facingMode,
          after_ready_state: after.readyState,
        });
        return;
      }

      trackEvent("video_date_camera_switch_committed", {
        platform: "web",
        session_id: activeCallSessionIdRef.current,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_call",
        source_action: "camera_switch_committed",
        method: commit.method,
        facing_mode: commit.facingMode,
        local_video_track_id: commit.trackId,
        local_video_device_id: commit.deviceId,
        commit_latency_ms: commit.latencyMs,
        publish_refresh_applied: commit.publishRefreshApplied,
      });

      try {
        await sendCommittedCameraSwitchHint(co, commit);
      } catch (hintError) {
        vdbg("daily_camera_switch_render_hint_send_failed", {
          sessionId: activeCallSessionIdRef.current,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          platform: "web",
          commitMethod: commit.method,
          error: describeCameraSwitchError(hintError),
        });
      }
    } catch (error) {
      trackEvent("video_date_flip_camera_failed", {
        platform: "web",
        session_id: activeCallSessionIdRef.current,
        event_id: optionsRef.current?.eventId ?? null,
        source_surface: "video_date_call",
        source_action: "flip_camera_failed",
        reason_code: error instanceof Error ? error.name : "unknown",
      });
      vdbg("daily_camera_flip_failed", {
        sessionId: activeCallSessionIdRef.current,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        platform: "web",
        error: describeCameraSwitchError(error),
      });
    } finally {
      cameraSwitchInFlightRef.current = false;
      setIsFlippingCamera(false);
    }
  }, [
    isFlippingCamera,
    isVideoOff,
    readLocalCameraSnapshot,
    sendCommittedCameraSwitchHint,
    switchToDeterministicWebCamera,
    waitForLocalCameraSwitchCommit,
  ]);

  useEffect(() => {
    return () => {
      void cleanupCallObject("useVideoCall.unmount", "component_unmount");
    };
  }, [cleanupCallObject]);

  /** Stable getter for the canonical room name after startCall succeeds. */
  const getRoomName = useCallback(() => roomNameRef.current, []);

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    mediaPermissionError,
    networkTier,
    remotePlayback,
    peerMissing,
    dailyReconnectState,
    reconnectGraceTimeLeft,
    captureProfile,
    localVideoRef,
    remoteVideoRef,
    localStream,
    canFlipCamera,
    isFlippingCamera,
    startCall,
    endCall,
    retryRemotePlayback,
    clearPeerMissing,
    clearMediaPermissionError,
    toggleMute,
    toggleVideo,
    flipCamera,
    getRoomName,
  };
};
