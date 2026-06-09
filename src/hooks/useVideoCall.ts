import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, {
  DailyCall,
  DailyParticipant,
  type DailyEvent,
  type DailyEventObject,
} from "@daily-co/daily-js";
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
  createDailyCallObjectGuarded,
  isTerminalDailyMeetingState,
  readDailyMeetingState,
  registerWebVideoDateDailyCleanup,
} from "@/lib/dailyCallInstance";
import {
  consumeWebVideoDateDailyPrewarm,
  markWebVideoDateDailyPrewarmFallback,
} from "@/lib/videoDateDailyPrewarm";
import { consumeWebVideoDateMediaHandoff } from "@/lib/videoDateMediaHandoff";
import {
  consumePreparedVideoDateEntry,
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import { refreshVideoDateToken } from "@/lib/videoDateTokenRefresh";
import {
  isVideoDateDailyMeetingEnded,
  isVideoDateTokenRefreshRateLimited,
  isVideoDateTokenRefreshTerminal,
  videoDateTokenRefreshRetryAfterMs,
} from "@clientShared/matching/videoDatePublicApi";
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
import { shouldRefreshDailyTokenBeforeReconnect } from "@clientShared/matching/videoDatePhase4";
import type { PreparedVideoDateEntryCacheEntry } from "@clientShared/matching/videoDatePrepareEntry";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import { adviseVideoDateTokenRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER,
  isVideoDateCameraConstraintError,
  videoDateAspectRatio,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import {
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionResultForStatus,
  type MediaPermissionQueryState,
  type MediaPermissionResult,
} from "@clientShared/media/mediaPermissionResult";
import {
  createVideoDateCameraSwitchRenderHint,
  parseVideoDateCameraSwitchRenderHint,
} from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import { getVideoDatePermissionHandoff } from "@clientShared/matching/videoDatePermissionHandoff";
import {
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
} from "@clientShared/matching/activeSession";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";

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
  onTerminalSurveyTruth?: (source: string) => void;
  resilienceV2?: boolean;
  dailyCallSingletonEligible?: boolean;
  dailyTokenRefreshV2?: boolean;
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
const PREPARE_DATE_ENTRY_RETRY_DELAYS_MS = [700, 1_600] as const;
const START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS = 60_000;
const START_CALL_IN_FLIGHT_WAIT_POLL_MS = 250;
const WEB_VIDEO_DATE_START_GATE_TTL_MS = 60_000;
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
const WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS: number | null = null;
const WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_MS = 8_000;
const WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_POLL_MS = 150;
const WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS = 6;
const WEB_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS = 300;
const VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS = 3_000;

export type VideoDateMediaPromptIntent = "auto" | "user_retry";

type VideoCallStartOptions = {
  internalRetry?: boolean;
  mediaPromptIntent?: VideoDateMediaPromptIntent;
  skipStartGate?: boolean;
};

type ActiveDailyCallIdentity = {
  sessionId: string;
  userId: string;
  ownerId: string | null;
  callInstanceId: string;
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
};

type WebVideoDateMediaCaptureReadiness = {
  canAcquire: boolean;
  permissionState: MediaPermissionQueryState;
  sourceAction: string;
  reasonCode: string | null;
};

function hasLabeledMediaDevice(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
): boolean {
  return devices.some(
    (device) => device.kind === kind && device.label.trim().length > 0,
  );
}

async function hasPriorGrantedVideoDateDeviceLabels(): Promise<boolean> {
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

async function queryVideoDateMediaPermissionState(
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

async function resolveWebVideoDateMediaCaptureReadiness(
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

const REMOTE_SEEN_RPC_MAX_ATTEMPTS = 3;
const REMOTE_SEEN_RPC_RETRY_DELAY_MS = 1_500;
const REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS = 10_000;

function safeMeetingState(
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

function readDailyProviderSessionId(call: DailyCall | null): string | null {
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

type RemoteVideoFrameCallbackMetadata = {
  presentedFrames?: number;
  mediaTime?: number;
  width?: number;
  height?: number;
};

type RemoteVideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (
      now: DOMHighResTimeStamp,
      metadata: RemoteVideoFrameCallbackMetadata,
    ) => void,
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

type WebCameraSwitchCommitMethod =
  | "cycle_camera"
  | "set_input_device"
  | "video_source";

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

function summarizeVideoTrackSettings(
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

type LiveVideoDateMediaTracks = {
  videoTrack: MediaStreamTrack;
  audioTrack: MediaStreamTrack;
};
type DailyParticipantMediaTrack = NonNullable<
  NonNullable<DailyParticipant["tracks"]>["audio"]
>;

function getLiveVideoDateMediaTracks(
  stream: MediaStream | null | undefined,
): LiveVideoDateMediaTracks | null {
  const videoTrack = firstLiveTrack(stream?.getVideoTracks() ?? []);
  if (!videoTrack) return null;
  const audioTrack = firstLiveTrack(stream?.getAudioTracks() ?? []);
  if (!audioTrack) return null;
  return { videoTrack, audioTrack };
}

function missingLiveVideoDateMediaTrackReason(
  stream: MediaStream | null | undefined,
): "missing_video_track" | "missing_audio_track" {
  return firstLiveTrack(stream?.getVideoTracks() ?? [])
    ? "missing_audio_track"
    : "missing_video_track";
}

function requireLiveVideoDateMediaTracks(
  stream: MediaStream | null | undefined,
  source: string,
): LiveVideoDateMediaTracks {
  const videoTrack = firstLiveTrack(stream?.getVideoTracks() ?? []);
  if (!videoTrack) throw new Error(`${source} returned no live video track`);
  const audioTrack = firstLiveTrack(stream?.getAudioTracks() ?? []);
  if (!audioTrack) throw new Error(`${source} returned no live audio track`);
  return { videoTrack, audioTrack };
}

function dailyTrackHasLiveMedia(
  track: DailyParticipantMediaTrack | undefined,
): boolean {
  if (track?.state !== "playable") return false;
  const mediaTrack = track?.persistentTrack;
  return Boolean(mediaTrack && mediaTrack.readyState !== "ended");
}

function hasLiveDailyLocalCameraAndMicrophone(
  call: Pick<DailyCall, "participants">,
): boolean {
  const localParticipant = call.participants().local;
  return (
    dailyTrackHasLiveMedia(localParticipant?.tracks?.video) &&
    dailyTrackHasLiveMedia(localParticipant?.tracks?.audio)
  );
}

type WebDailyCallSingletonEntry = {
  call: DailyCall;
  userId: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  appAcquiredMedia: AppAcquiredVideoDateMedia | null;
  previousSessionId: string | null;
  previousRoomName: string | null;
  parkingMode: "live_same_session_remount";
  parkedAtMs: number;
  idleMs: number | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  stopHeartbeat?: (reason: string) => void;
};

let webDailyCallSingletonEntry: WebDailyCallSingletonEntry | null = null;

function getWebDailyCallSingletonIdleAgeMs(entry: WebDailyCallSingletonEntry) {
  return Math.max(0, Date.now() - entry.parkedAtMs);
}

function isWebDailyCallSingletonIdleExpired(entry: WebDailyCallSingletonEntry) {
  return (
    typeof entry.idleMs === "number" &&
    getWebDailyCallSingletonIdleAgeMs(entry) > entry.idleMs
  );
}

function shouldPersistWebDailyCallSingletonDestroy(reason: string) {
  return reason.includes("idle") || reason.includes("expired");
}

function destroyWebDailyCallSingleton(reason: string) {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return;
  webDailyCallSingletonEntry = null;
  if (entry.destroyTimer) clearTimeout(entry.destroyTimer);
  entry.stopHeartbeat?.(`daily_call_singleton_destroy:${reason}`);
  void registerWebVideoDateDailyCleanup(
    Promise.resolve()
      .then(async () => {
        try {
          await Promise.resolve(entry.call.leave());
        } catch {
          // Best effort: destroy below still releases the Daily instance.
        }
        await Promise.resolve(entry.call.destroy());
      })
      .finally(() => {
        stopMediaStreamTracks(entry.appAcquiredMedia?.stream);
      }),
    {
      source: "web_video_date_daily_singleton",
      reason,
      onDiagnostic: (eventName, payload) => vdbg(eventName, payload),
    },
  ).catch(() => undefined);
  if (shouldPersistWebDailyCallSingletonDestroy(reason)) {
    void emitWebVideoDateClientStuckState({
      sessionId: entry.previousSessionId,
      eventName: "daily_call_singleton_idle_destroy",
      dedupe: false,
      payload: {
        source_surface: "video_date_daily",
        source_action: "daily_call_singleton_destroyed",
        reason_code: reason,
        previous_session_id: entry.previousSessionId ?? undefined,
        previous_room_name: entry.previousRoomName ?? undefined,
        singleton_parking_mode: entry.parkingMode,
        idle_ms: entry.idleMs ?? undefined,
        idle_age_ms: getWebDailyCallSingletonIdleAgeMs(entry),
        idle_destroy_disabled: entry.idleMs == null,
        leave_called: true,
        destroy_called: true,
      },
    });
  }
  vdbg("daily_call_singleton_destroyed", {
    platform: "web",
    reason,
    previousSessionId: entry.previousSessionId,
    previousRoomName: entry.previousRoomName,
    parkingMode: entry.parkingMode,
    idleDestroyDisabled: entry.idleMs == null,
    idleMs: entry.idleMs,
    idleAgeMs: getWebDailyCallSingletonIdleAgeMs(entry),
    hadAppAcquiredMedia: Boolean(entry.appAcquiredMedia),
  });
}

function parkWebDailyCallSingleton(params: {
  call: DailyCall;
  userId: string;
  captureProfile: VideoDateWebMediaCaptureProfile;
  appAcquiredMedia: AppAcquiredVideoDateMedia | null;
  previousSessionId: string | null;
  previousRoomName: string | null;
  reason: string;
  stopHeartbeat?: (reason: string) => void;
}) {
  if (
    webDailyCallSingletonEntry &&
    webDailyCallSingletonEntry.call !== params.call
  ) {
    destroyWebDailyCallSingleton("replaced_by_new_singleton");
  } else if (webDailyCallSingletonEntry?.destroyTimer) {
    clearTimeout(webDailyCallSingletonEntry.destroyTimer);
  }
  const parkingMode: WebDailyCallSingletonEntry["parkingMode"] =
    "live_same_session_remount";
  const idleMs = WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS;
  const entry: WebDailyCallSingletonEntry = {
    call: params.call,
    userId: params.userId,
    captureProfile: params.captureProfile,
    appAcquiredMedia: params.appAcquiredMedia,
    previousSessionId: params.previousSessionId,
    previousRoomName: params.previousRoomName,
    parkingMode,
    parkedAtMs: Date.now(),
    idleMs,
    destroyTimer: null,
    stopHeartbeat: params.stopHeartbeat,
  };
  if (typeof idleMs === "number") {
    entry.destroyTimer = setTimeout(() => {
      if (webDailyCallSingletonEntry?.call === params.call) {
        destroyWebDailyCallSingleton("idle_timeout");
      }
    }, idleMs);
  }
  webDailyCallSingletonEntry = entry;
  vdbg("daily_call_singleton_parked", {
    platform: "web",
    reason: params.reason,
    parkingMode,
    previousSessionId: params.previousSessionId,
    previousRoomName: params.previousRoomName,
    idleMs,
    idleDestroyDisabled: idleMs == null,
  });
}

function consumeWebDailyCallSingleton(params: {
  userId: string;
  nextSessionId: string;
  nextRoomName: string;
}):
  | { ok: true; entry: WebDailyCallSingletonEntry; meetingState: string | null }
  | { ok: false; reason: string } {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return { ok: false, reason: "missing_singleton" };
  if (isWebDailyCallSingletonIdleExpired(entry)) {
    destroyWebDailyCallSingleton("expired_before_consume");
    return { ok: false, reason: "expired_before_consume" };
  }
  if (entry.call.isDestroyed()) {
    destroyWebDailyCallSingleton("destroyed_before_consume");
    return { ok: false, reason: "destroyed_before_consume" };
  }
  if (entry.userId !== params.userId) {
    destroyWebDailyCallSingleton("user_changed");
    return { ok: false, reason: "user_changed" };
  }
  if (
    entry.previousSessionId !== params.nextSessionId ||
    entry.previousRoomName !== params.nextRoomName
  ) {
    destroyWebDailyCallSingleton("session_or_room_changed_before_consume");
    return { ok: false, reason: "session_or_room_changed" };
  }
  const meetingState = readDailyMeetingState(entry.call);
  if (meetingState !== "joined-meeting" && meetingState !== "joining-meeting") {
    destroyWebDailyCallSingleton("not_joined_before_consume");
    return { ok: false, reason: "not_joined" };
  }
  if (
    meetingState === "joined-meeting" &&
    !hasLiveDailyLocalCameraAndMicrophone(entry.call)
  ) {
    destroyWebDailyCallSingleton("local_media_not_live_before_consume");
    return { ok: false, reason: "local_media_not_live" };
  }
  if (entry.destroyTimer) {
    clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  webDailyCallSingletonEntry = null;
  entry.stopHeartbeat?.("daily_call_singleton_consumed");
  vdbg("daily_call_singleton_reused", {
    platform: "web",
    previousSessionId: entry.previousSessionId,
    nextSessionId: params.nextSessionId,
    previousRoomName: entry.previousRoomName,
    nextRoomName: params.nextRoomName,
    meetingState,
    parkingMode: entry.parkingMode,
    idleAgeMs: getWebDailyCallSingletonIdleAgeMs(entry),
    idleDestroyDisabled: entry.idleMs == null,
    heartbeatTransferred: Boolean(entry.stopHeartbeat),
  });
  return { ok: true, entry, meetingState };
}

function hasReusableWebDailyCallSingleton(params: {
  userId: string;
  nextSessionId: string;
}): boolean {
  const entry = webDailyCallSingletonEntry;
  if (!entry) return false;
  if (isWebDailyCallSingletonIdleExpired(entry)) {
    destroyWebDailyCallSingleton("expired_before_preflight");
    return false;
  }
  if (entry.call.isDestroyed()) {
    destroyWebDailyCallSingleton("destroyed_before_preflight");
    return false;
  }
  if (entry.userId !== params.userId) {
    destroyWebDailyCallSingleton("user_changed_before_preflight");
    return false;
  }
  if (entry.previousSessionId !== params.nextSessionId) {
    destroyWebDailyCallSingleton("session_changed_before_preflight");
    return false;
  }
  const meetingState = readDailyMeetingState(entry.call);
  if (meetingState !== "joined-meeting" && meetingState !== "joining-meeting") {
    destroyWebDailyCallSingleton("not_joined_before_preflight");
    return false;
  }
  if (
    meetingState === "joined-meeting" &&
    !hasLiveDailyLocalCameraAndMicrophone(entry.call)
  ) {
    destroyWebDailyCallSingleton("local_media_not_live_before_preflight");
    return false;
  }
  return true;
}

type VideoDateTruthRow = {
  id: string;
  event_id: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  state: string | null;
  phase: string | null;
  handshake_started_at: string | null;
  date_started_at?: string | null;
  daily_room_name: string | null;
  daily_room_url?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
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
  kind:
    | DailyRoomFailureKind
    | "daily_join_failed"
    | "daily_call_busy"
    | "start_call_in_flight_failed"
    | "media_permission_denied"
    | "session_unavailable";
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

type WebVideoDateStartGateEntry = {
  sessionId: string;
  userId: string | null;
  promise: Promise<VideoCallStartResult>;
  startedAtMs: number;
  observeCount: number;
};

const webVideoDateStartGateEntries = new Map<
  string,
  WebVideoDateStartGateEntry
>();

function webVideoDateStartGateKey(
  sessionId: string,
  userId: string | null | undefined,
) {
  return `${sessionId}:${userId ?? "anonymous"}`;
}

function getWebVideoDateStartGateEntry(
  sessionId: string,
  userId: string | null | undefined,
): WebVideoDateStartGateEntry | null {
  const key = webVideoDateStartGateKey(sessionId, userId);
  const entry = webVideoDateStartGateEntries.get(key) ?? null;
  if (!entry) return null;
  if (Date.now() - entry.startedAtMs > WEB_VIDEO_DATE_START_GATE_TTL_MS) {
    webVideoDateStartGateEntries.delete(key);
    return null;
  }
  return entry;
}

function registerWebVideoDateStartGateEntry(
  sessionId: string,
  userId: string | null | undefined,
  promise: Promise<VideoCallStartResult>,
): WebVideoDateStartGateEntry {
  const key = webVideoDateStartGateKey(sessionId, userId);
  const entry: WebVideoDateStartGateEntry = {
    sessionId,
    userId: userId ?? null,
    promise,
    startedAtMs: Date.now(),
    observeCount: 1,
  };
  webVideoDateStartGateEntries.set(key, entry);
  const clearEntry = () => {
    if (webVideoDateStartGateEntries.get(key) === entry) {
      webVideoDateStartGateEntries.delete(key);
    }
  };
  void promise.then(clearEntry, clearEntry);
  return entry;
}

export type DailyReconnectState =
  | "connected"
  | "interrupted"
  | "partner_reconnecting"
  | "partner_left_grace"
  | "recovered"
  | "failed_after_grace";

function tierFromNetworkQualityEvent(
  event: { threshold?: string; quality?: number } | undefined,
): VideoCallNetworkTier {
  const q = typeof event?.quality === "number" ? event.quality : 100;
  const th = event?.threshold;
  if (th === "low" || q < 30) return "poor";
  if (q < 70) return "fair";
  return "good";
}

function withTimeout<T>(
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDailyMeetingState(
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

function normalizeCameraFacingMode(
  value: unknown,
): VideoDateCameraFacingMode | null {
  if (value === "user" || value === "environment") return value;
  return null;
}

function oppositeCameraFacingMode(
  value: VideoDateCameraFacingMode | null,
): VideoDateCameraFacingMode | null {
  if (value === "user") return "environment";
  if (value === "environment") return "user";
  return null;
}

function getDeviceId(
  device: WebCameraDevice | null | undefined,
): string | null {
  if (!device) return null;
  if (typeof device.deviceId === "string" && device.deviceId)
    return device.deviceId;
  if (typeof device.id === "string" && device.id) return device.id;
  return null;
}

function inferCameraFacingModeFromLabel(
  label: unknown,
): VideoDateCameraFacingMode | null {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return "user";
  if (/\b(back|rear|environment|world)\b/.test(normalized))
    return "environment";
  return null;
}

function getDeviceFacingMode(
  device: WebCameraDevice | null | undefined,
): VideoDateCameraFacingMode | null {
  if (!device) return null;
  return (
    normalizeCameraFacingMode(device.facingMode) ??
    normalizeCameraFacingMode(device.facing) ??
    inferCameraFacingModeFromLabel(device.label)
  );
}

function getTrackDeviceId(
  track: MediaStreamTrack | null | undefined,
): string | null {
  if (!track || typeof track.getSettings !== "function") return null;
  const settings = track.getSettings();
  return typeof settings.deviceId === "string" && settings.deviceId
    ? settings.deviceId
    : null;
}

function getTrackFacingMode(
  track: MediaStreamTrack | null | undefined,
): VideoDateCameraFacingMode | null {
  if (!track || typeof track.getSettings !== "function") return null;
  return (
    normalizeCameraFacingMode(track.getSettings().facingMode) ??
    inferCameraFacingModeFromLabel(track.label)
  );
}

function getLocalVideoTrack(
  participant: DailyParticipant | undefined,
): MediaStreamTrack | null {
  return participant?.tracks?.video?.persistentTrack ?? null;
}

function getLocalCameraSnapshot(
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

async function enumerateWebVideoDevices(
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
    const facingMatch = candidates.find(
      (device) => getDeviceFacingMode(device) === desiredFacing,
    );
    if (facingMatch) return facingMatch;
    if (!currentDeviceId) return null;
  }
  return currentDeviceId ? (candidates[0] ?? null) : null;
}

function videoOnlyCameraSwitchConstraints(
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

function isWebKitCameraSwitchRuntime(): boolean {
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

function readRemoteRenderFrameState(
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

function hasRenderableRemoteFrame(
  state: RemoteRenderFrameState | null,
): boolean {
  return Boolean(
    state &&
    (state.readyState ?? 0) >= 2 &&
    (state.videoWidth ?? 0) > 0 &&
    (state.videoHeight ?? 0) > 0,
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

function describeCameraSwitchError(error: unknown): {
  name: string;
  message: string;
} {
  if (error instanceof Error)
    return { name: error.name || "Error", message: error.message };
  return { name: "unknown", message: String(error) };
}

function isInvokeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out after/i.test(error.message);
}

function buildStreamFromParticipant(
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

function getTrackIdsKey(
  p: DailyParticipant | undefined,
  includeAudio: boolean,
): string {
  const videoId = p?.tracks?.video?.persistentTrack?.id ?? "";
  const audioId = includeAudio
    ? (p?.tracks?.audio?.persistentTrack?.id ?? "")
    : "";
  return `${videoId}|${audioId}`;
}

function getParticipantIdentity(
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

function normalizeRemoteRenderRecoveryScope(scope: string): string {
  if (scope.startsWith("camera_switch_hint:")) return "camera_switch_hint";
  if (scope.includes("camera_switch_hint")) return "camera_switch_hint";
  if (scope.includes("participant_updated_same_track"))
    return "participant_updated_same_track";
  if (scope.includes("remote_render_recovery_followup"))
    return "remote_render_recovery_followup";
  return scope;
}

function pruneRemoteRenderRecoveryAttempts(
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

function streamHasTrackId(
  stream: MediaStream | null,
  trackId: string,
): boolean {
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
  const [remotePlayback, setRemotePlayback] = useState<RemotePlaybackState>(
    () => createRemotePlaybackState(),
  );
  const [peerMissing, setPeerMissing] = useState<PeerMissingState>({
    terminal: false,
  });
  const [dailyReconnectState, setDailyReconnectState] =
    useState<DailyReconnectState>("connected");
  const [dailyMeetingState, setDailyMeetingState] = useState<string | null>(
    null,
  );
  const [localInDailyRoom, setLocalInDailyRoom] = useState(false);
  const [reconnectGraceTimeLeft, setReconnectGraceTimeLeft] = useState(0);
  const [mediaPermissionError, setMediaPermissionError] = useState<
    string | null
  >(null);
  const [mediaPermissionResult, setMediaPermissionResult] =
    useState<MediaPermissionResult | null>(null);
  const [captureProfile, setCaptureProfile] =
    useState<VideoDateWebMediaCaptureProfile>("ideal");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  const firstRemoteObservedRef = useRef(false);
  const localVideoReadyTrackedRef = useRef(false);
  const remoteFirstFrameTrackedRef = useRef(false);
  const remoteSeenInFlightSessionRef = useRef<string | null>(null);
  const remoteSeenLastStampRef = useRef<{
    sessionId: string;
    stampedAtMs: number;
  } | null>(null);
  const remoteSeenRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeDailyCallIdentityRef = useRef<ActiveDailyCallIdentity | null>(
    null,
  );
  const lastLocalTrackIdsRef = useRef<string>("");
  const lastLocalStreamRef = useRef<MediaStream | null>(null);
  const lastRemoteTrackIdsRef = useRef<string>("");
  const lastRemoteStreamRef = useRef<MediaStream | null>(null);
  const lastLocalMountedTrackKeyRef = useRef<string>("");
  const lastRemoteMountedTrackKeyRef = useRef<string>("");
  const firstRemoteWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const peerMissingTruthRefreshCountRef = useRef(0);
  const remoteRenderValidationDelayRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderValidationTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderValidationFrameCallbackRef = useRef<number | null>(null);
  const remoteRenderValidationSeqRef = useRef(0);
  const remoteRenderRecoveryReattachTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const remoteRenderRecoveryTrackAttemptsRef = useRef<
    Map<string, RemoteRenderRecoveryAttemptEntry>
  >(new Map());
  const remoteRenderRecoveryScopedAttemptsRef = useRef<
    Map<string, RemoteRenderRecoveryAttemptEntry>
  >(new Map());
  const remoteRenderRecoveryInFlightRef = useRef<{
    trackKey: string;
    scopeKey: string;
    trackAttempt: number;
    scopeAttempt: number;
    source: string;
  } | null>(null);
  const scheduleRemoteRenderValidationRef = useRef<
    | ((
        participant: DailyParticipant | undefined,
        source: string,
        roomName: string | null,
        recoveryScope?: string,
        options?: RemoteRenderValidationOptions,
      ) => void)
    | null
  >(null);
  const lastRemoteRenderParticipantIdRef = useRef<string | null>(null);
  const startAttemptNonceRef = useRef(0);
  const startCallInFlightSessionRef = useRef<string | null>(null);
  const activeCallSessionIdRef = useRef<string | null>(null);
  const sameSessionDailyContinuityLatchedRef = useRef<{
    sessionId: string;
    latchedAtMs: number;
    source: string;
  } | null>(null);
  const latestLocalParticipantRef = useRef<DailyParticipant | undefined>(
    undefined,
  );
  const latestRemoteParticipantRef = useRef<DailyParticipant | undefined>(
    undefined,
  );
  const cameraSwitchInFlightRef = useRef(false);
  const lastRemoteCameraSwitchHintIdRef = useRef<string | null>(null);
  const activeRemoteCameraSwitchRenderWatchRef =
    useRef<RemoteCameraSwitchRenderWatch | null>(null);
  const reconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectGraceTickerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const reconnectRecoveryResetTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reconnectGraceActiveRef = useRef(false);
  const reconnectPartnerAwayTriggeredRef = useRef(false);
  const reconnectSyncRequestedRef = useRef(false);
  const mediaPermissionDeniedRef = useRef(false);
  const playbackBlockedRef = useRef(false);
  const captureProfileRef = useRef<VideoDateWebMediaCaptureProfile>("ideal");
  const activePreparedEntryCacheRef =
    useRef<PreparedVideoDateEntryCacheEntry | null>(null);
  const activePreparedEntryCacheHitRef = useRef<boolean | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);
  const dailySdkUnresponsiveKeyRef = useRef<string | null>(null);
  const appAcquiredMediaRef = useRef<AppAcquiredVideoDateMedia | null>(null);
  const lastMediaHandoffUsedRef = useRef(false);
  const lastMediaHandoffMissReasonRef = useRef<string | null>(null);
  const lastDailyPrewarmConsumedRef = useRef(false);
  const lastPrewarmedJoinInFlightRef = useRef(false);
  const lastPrewarmedAlreadyJoinedRef = useRef(false);
  const lastProviderVerifySkippedRef = useRef<boolean | null>(null);
  const resilienceReceiveSettingsKeyRef = useRef<string | null>(null);
  const dailyListenerGenerationRef = useRef(0);
  const dailyEventListenerCleanupsRef = useRef<Array<() => void>>([]);
  const dailyTokenRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const dailyTokenRecoveryInFlightRef = useRef(false);
  const dailyAliveHeartbeatTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const dailyAliveHeartbeatKeyRef = useRef<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const latchSameSessionDailyContinuity = useCallback(
    (sessionId: string, source: string) => {
      const existing = sameSessionDailyContinuityLatchedRef.current;
      if (existing?.sessionId === sessionId) return;
      sameSessionDailyContinuityLatchedRef.current = {
        sessionId,
        latchedAtMs: Date.now(),
        source,
      };
      vdbg("daily_call_same_session_continuity_latched", {
        sessionId,
        source,
      });
    },
    [],
  );

  const clearSameSessionDailyContinuity = useCallback(
    (sessionId: string | null, source: string) => {
      const existing = sameSessionDailyContinuityLatchedRef.current;
      if (!existing) return;
      if (sessionId && existing.sessionId !== sessionId) return;
      sameSessionDailyContinuityLatchedRef.current = null;
      vdbg("daily_call_same_session_continuity_cleared", {
        sessionId: sessionId ?? existing.sessionId,
        source,
        previousSource: existing.source,
        ageMs: Math.max(0, Date.now() - existing.latchedAtMs),
      });
    },
    [],
  );

  const hasSameSessionDailyContinuity = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return false;
      return (
        sameSessionDailyContinuityLatchedRef.current?.sessionId === sessionId
      );
    },
    [],
  );

  const clearDailyEventListeners = useCallback((reason: string) => {
    const cleanups = dailyEventListenerCleanupsRef.current;
    if (cleanups.length === 0) return;
    dailyEventListenerCleanupsRef.current = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        vdbg("daily_call_listener_cleanup_failed", {
          reason,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    }
    vdbg("daily_call_listeners_cleared", {
      reason,
      count: cleanups.length,
    });
  }, []);

  const clearDailyTokenRefreshTimer = useCallback(() => {
    if (!dailyTokenRefreshTimerRef.current) return;
    clearTimeout(dailyTokenRefreshTimerRef.current);
    dailyTokenRefreshTimerRef.current = null;
  }, []);

  const clearDailyAliveHeartbeatTimer = useCallback((reason: string) => {
    if (dailyAliveHeartbeatTimerRef.current) {
      clearInterval(dailyAliveHeartbeatTimerRef.current);
      dailyAliveHeartbeatTimerRef.current = null;
    }
    if (dailyAliveHeartbeatKeyRef.current) {
      vdbg("mark_video_date_daily_alive_stopped", {
        reason,
        heartbeatKey: dailyAliveHeartbeatKeyRef.current,
      });
      dailyAliveHeartbeatKeyRef.current = null;
    }
  }, []);

  const markVideoDateDailyAlive = useCallback(
    async (input: {
      sessionId: string;
      userId: string;
      roomName: string | null;
      entryAttemptId?: string | null;
      videoDateTraceId?: string | null;
      callInstanceId?: string | null;
      source: string;
    }) => {
      const call = callObjectRef.current;
      const providerSessionId = readDailyProviderSessionId(call);
      const meetingState = safeMeetingState(call);
      const providerBackedJoined =
        meetingState === "joined-meeting" && Boolean(providerSessionId);
      const dailyOwnerState = providerBackedJoined
        ? "joined"
        : meetingState === "left-meeting" || meetingState === "error"
          ? "lost"
          : "joining";
      const entryOwner = getVideoDateEntryOwner(input.sessionId, input.userId);
      const ownerId = entryOwner?.ownerId ?? null;
      updateVideoDateDailyOwnerState({
        sessionId: input.sessionId,
        userId: input.userId,
        ownerId,
        roomName: input.roomName,
        state: dailyOwnerState,
        source: input.source,
        entryAttemptId:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        videoDateTraceId:
          input.videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
        callInstanceId: input.callInstanceId ?? null,
        providerSessionId,
      });
      updateVideoDateEntryOwnerState({
        sessionId: input.sessionId,
        userId: input.userId,
        ownerId,
        state: providerBackedJoined ? "joined" : "joining",
        source: input.source,
        roomName: input.roomName,
        entryAttemptId:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        videoDateTraceId:
          input.videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
        callInstanceId: input.callInstanceId ?? null,
        providerSessionId,
      });

      if (!providerBackedJoined) {
        vdbg("mark_video_date_daily_alive_skipped_provider_missing", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          meetingState,
          ownerState: dailyOwnerState,
          terminal: dailyOwnerState === "lost",
        });
        if (dailyOwnerState === "lost") {
          clearDailyAliveHeartbeatTimer("provider_missing_terminal_state");
        }
        return;
      }

      const args = {
        p_session_id: input.sessionId,
        p_owner_id: ownerId,
        p_call_instance_id: input.callInstanceId ?? null,
        p_provider_session_id: providerSessionId,
        p_entry_attempt_id:
          input.entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
        p_owner_state: dailyOwnerState,
      };
      try {
        const { data, error } = await (
          supabase as unknown as {
            rpc: (
              name: string,
              args: Record<string, unknown>,
            ) => Promise<{
              data: unknown;
              error: { code?: string; message?: string } | null;
            }>;
          }
        ).rpc("mark_video_date_daily_alive", args);
        vdbg("mark_video_date_daily_alive_after", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          providerBackedJoined,
          meetingState,
          ownerState: dailyOwnerState,
          payload: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
        const payload =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;
        const terminalSurvey =
          videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
        const terminalStop =
          terminalSurvey ||
          videoDateLifecycleRpcIndicatesTerminalStop(payload) ||
          payload?.provider_presence_terminal === true;
        if (terminalStop) {
          clearDailyAliveHeartbeatTimer(
            videoDateLifecycleRpcCode(payload) === "session_ended"
              ? "server_session_ended"
              : payload?.provider_presence_terminal === true
                ? "provider_presence_terminal"
                : "server_terminal_truth",
          );
          if (terminalSurvey) {
            optionsRef.current?.onTerminalSurveyTruth?.(
              "daily_alive_terminal_survey_truth",
            );
          }
        }
      } catch (error) {
        vdbg("mark_video_date_daily_alive_failed", {
          sessionId: input.sessionId,
          userId: input.userId,
          roomName: input.roomName,
          source: input.source,
          ownerId,
          callInstanceId: input.callInstanceId ?? null,
          providerSessionId,
          providerBackedJoined,
          meetingState,
          ownerState: dailyOwnerState,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    },
    [clearDailyAliveHeartbeatTimer],
  );

  const startDailyAliveHeartbeat = useCallback(
    (input: {
      sessionId: string;
      userId: string;
      roomName: string | null;
      entryAttemptId?: string | null;
      videoDateTraceId?: string | null;
      callInstanceId?: string | null;
      source: string;
    }) => {
      const heartbeatKey = `${input.sessionId}:${input.userId}:${input.roomName ?? ""}:${input.callInstanceId ?? ""}`;
      if (dailyAliveHeartbeatKeyRef.current === heartbeatKey) {
        void markVideoDateDailyAlive(input);
        return;
      }
      clearDailyAliveHeartbeatTimer("heartbeat_replaced");
      dailyAliveHeartbeatKeyRef.current = heartbeatKey;
      void markVideoDateDailyAlive(input);
      dailyAliveHeartbeatTimerRef.current = setInterval(() => {
        void markVideoDateDailyAlive({
          ...input,
          source: "daily_alive_heartbeat",
        });
      }, VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS);
    },
    [clearDailyAliveHeartbeatTimer, markVideoDateDailyAlive],
  );

  useEffect(() => {
    const sessionId = options?.roomId ?? null;
    if (!options?.resilienceV2 || !sessionId) return;
    if (!isConnected) {
      resilienceReceiveSettingsKeyRef.current = null;
      return;
    }

    const mode = networkTier === "poor" ? "audio_priority" : "standard";
    if (mode === "standard" && resilienceReceiveSettingsKeyRef.current === null)
      return;

    const key = `${sessionId}:${mode}`;
    if (resilienceReceiveSettingsKeyRef.current === key) return;

    const call = callObjectRef.current;
    const payload = {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      network_tier: networkTier,
      adaptation: mode,
    };

    if (!call || typeof call.updateReceiveSettings !== "function") {
      resilienceReceiveSettingsKeyRef.current = key;
      trackEvent("video_date_resilience_daily_adaptation", {
        ...payload,
        capability_available: false,
        outcome: "unsupported",
      });
      return;
    }

    const receiveSettings: Parameters<DailyCall["updateReceiveSettings"]>[0] =
      mode === "audio_priority"
        ? { "*": { video: { layer: 0 } } }
        : { "*": "inherit" };
    resilienceReceiveSettingsKeyRef.current = key;
    void call
      .updateReceiveSettings(receiveSettings)
      .then(() => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "applied",
        });
      })
      .catch((error) => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "failed",
          reason:
            error instanceof Error ? error.message.slice(0, 120) : "unknown",
        });
      });
  }, [
    isConnected,
    networkTier,
    options?.eventId,
    options?.resilienceV2,
    options?.roomId,
  ]);

  useEffect(() => {
    if (!isConnecting && !isConnected) {
      dailySdkUnresponsiveKeyRef.current = null;
      return;
    }

    const emitUnresponsive = (
      reason: string,
      meetingState: string | null,
      error?: unknown,
    ) => {
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
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_DAILY_SDK_UNRESPONSIVE,
        payload,
      );
      Sentry.captureMessage("video_date_daily_sdk_unresponsive", {
        level: "warning",
        extra: {
          ...payload,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : (error ?? null),
        },
      });
    };

    const intervalId = setInterval(() => {
      const call = callObjectRef.current as
        | (DailyCall & { meetingState?: () => unknown })
        | null;
      if (!call || typeof call.meetingState !== "function") return;
      let meetingState: string | null = null;
      try {
        const state = call.meetingState();
        meetingState =
          typeof state === "string"
            ? state
            : state == null
              ? null
              : String(state);
      } catch (error) {
        emitUnresponsive("meeting_state_throw", null, error);
        return;
      }
      if (
        meetingState === "error" ||
        (isConnected && meetingState === "left-meeting")
      ) {
        emitUnresponsive("unexpected_meeting_state", meetingState);
      }
    }, 5_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected, isConnecting]);

  const markRemoteSeenOnServer = useCallback(
    (source: string) => {
      const currentOptions = optionsRef.current;
      const sessionId = currentOptions?.roomId ?? null;
      if (!sessionId) return;
      const activeSessionId = sessionId;
      const eventId = currentOptions?.eventId ?? null;
      const currentUserId = currentOptions?.userId;
      if (!currentUserId) return;
      const userId = currentUserId;
      if (remoteSeenInFlightSessionRef.current === sessionId) return;
      const nowMs = Date.now();
      const lastStamp = remoteSeenLastStampRef.current;
      const forceRestamp =
        source === "loadeddata" ||
        source === "playing" ||
        source === "remote_track_mounted" ||
        source === "first_remote_frame" ||
        source === "request_video_frame_callback";
      if (
        !forceRestamp &&
        lastStamp?.sessionId === sessionId &&
        nowMs - lastStamp.stampedAtMs < REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS
      ) {
        return;
      }

      const baseEvidenceSource = source;
      const buildProviderBoundRemoteSeenArgs = (attemptSource: string) => {
        const call = callObjectRef.current;
        const providerSessionId = readDailyProviderSessionId(call);
        const meetingState = safeMeetingState(call);
        const providerBackedJoined =
          meetingState === "joined-meeting" && Boolean(providerSessionId);
        const identity = activeDailyCallIdentityRef.current;
        const identityCurrent =
          identity?.sessionId === sessionId && identity.userId === userId
            ? identity
            : null;
        const entryOwner = getVideoDateEntryOwner(sessionId, userId);
        const ownerId = identityCurrent?.ownerId ?? entryOwner?.ownerId ?? null;
        const callInstanceId = identityCurrent?.callInstanceId ?? null;
        const entryAttemptId =
          identityCurrent?.entryAttemptId ?? entryOwner?.entryAttemptId ?? null;
        const videoDateTraceId =
          identityCurrent?.videoDateTraceId ??
          entryOwner?.videoDateTraceId ??
          null;

        if (!providerBackedJoined || !providerSessionId || !callInstanceId) {
          const terminal =
            meetingState === "left-meeting" || meetingState === "error";
          if (terminal) {
            clearDailyAliveHeartbeatTimer(
              "remote_seen_provider_missing_terminal_state",
            );
          }
          const code = !providerSessionId
            ? "REMOTE_SEEN_PROVIDER_SESSION_MISSING"
            : !callInstanceId
              ? "REMOTE_SEEN_CALL_INSTANCE_MISSING"
              : "REMOTE_SEEN_OWNER_NOT_JOINED";
          vdbg("mark_video_date_remote_seen_skipped_provider_missing", {
            sessionId,
            eventId,
            userId,
            source: attemptSource,
            providerSessionId,
            meetingState,
            providerBackedJoined,
            callInstanceId,
            ownerId,
            terminal,
          });
          return {
            ok: false as const,
            code,
            payload: {
              ok: false,
              error: code.toLowerCase(),
              code,
              retryable: false,
              provider_presence_required: true,
              provider_presence_missing: true,
              provider_presence_terminal: terminal,
            },
          };
        }

        return {
          ok: true as const,
          providerSessionId,
          meetingState,
          ownerId,
          callInstanceId,
          entryAttemptId,
          videoDateTraceId,
          args: {
            p_session_id: sessionId,
            p_owner_id: ownerId,
            p_call_instance_id: callInstanceId,
            p_provider_session_id: providerSessionId,
            p_entry_attempt_id: entryAttemptId,
            p_owner_state: "joined",
            p_evidence_source: baseEvidenceSource,
          },
        };
      };

      const initialProof = buildProviderBoundRemoteSeenArgs(source);
      if (!initialProof.ok) return;

      if (remoteSeenRetryTimerRef.current) {
        clearTimeout(remoteSeenRetryTimerRef.current);
        remoteSeenRetryTimerRef.current = null;
      }
      remoteSeenInFlightSessionRef.current = sessionId;

      const scheduleRetry = (attemptSource: string, nextAttempt: number) => {
        if (
          optionsRef.current?.roomId !== sessionId ||
          remoteSeenRetryTimerRef.current
        )
          return;
        remoteSeenRetryTimerRef.current = setTimeout(() => {
          remoteSeenRetryTimerRef.current = null;
          if (
            optionsRef.current?.roomId !== sessionId ||
            remoteSeenInFlightSessionRef.current === sessionId
          )
            return;
          remoteSeenInFlightSessionRef.current = sessionId;
          stamp(`${attemptSource}_retry_${nextAttempt}`, nextAttempt);
        }, REMOTE_SEEN_RPC_RETRY_DELAY_MS);
      };

      const handleFailure = (
        attemptSource: string,
        attempt: number,
        code: string,
        errorDetail: unknown,
        payload?: Record<string, unknown> | null,
      ) => {
        if (remoteSeenInFlightSessionRef.current === sessionId) {
          remoteSeenInFlightSessionRef.current = null;
        }
        const terminalSurvey =
          videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
        const terminalStop =
          terminalSurvey ||
          videoDateLifecycleRpcIndicatesTerminalStop(payload) ||
          payload?.provider_presence_terminal === true;
        const retryable =
          videoDateLifecycleRpcRetryable(payload) ?? !terminalStop;
        if (terminalStop) {
          if (remoteSeenRetryTimerRef.current) {
            clearTimeout(remoteSeenRetryTimerRef.current);
            remoteSeenRetryTimerRef.current = null;
          }
          clearDailyAliveHeartbeatTimer(
            terminalSurvey
              ? "remote_seen_terminal_survey_truth"
              : "remote_seen_terminal_truth",
          );
          if (terminalSurvey) {
            optionsRef.current?.onTerminalSurveyTruth?.(
              "remote_seen_terminal_survey_truth",
            );
          }
        }
        vdbg("mark_video_date_remote_seen_failed", {
          sessionId,
          eventId,
          userId,
          source: attemptSource,
          code,
          error: errorDetail,
          attempt,
          retryable,
          terminalStop,
          payload: payload ?? null,
        });
        if (!retryable || terminalStop) {
          return;
        }
        if (attempt < REMOTE_SEEN_RPC_MAX_ATTEMPTS) {
          scheduleRetry(attemptSource, attempt + 1);
          return;
        }
        void emitWebVideoDateClientStuckState({
          sessionId,
          eventName: "remote_seen_canonical_repair_failed",
          payload: {
            source_surface: "video_date_daily",
            source_action: "mark_video_date_remote_seen",
            reason_code: code,
            code,
            source: attemptSource,
            attempt_count: attempt,
            retryable,
            exhausted: true,
          },
        });
      };

      function stamp(attemptSource: string, attempt: number) {
        const proof = buildProviderBoundRemoteSeenArgs(attemptSource);
        if (!proof.ok) {
          handleFailure(
            attemptSource,
            attempt,
            proof.code,
            null,
            proof.payload,
          );
          return;
        }
        void Promise.resolve(
          supabase.rpc("mark_video_date_remote_seen", proof.args),
        )
          .then(({ data, error }) => {
            const payload =
              data && typeof data === "object" && !Array.isArray(data)
                ? (data as Record<string, unknown>)
                : null;
            if (error || payload?.ok !== true) {
              handleFailure(
                attemptSource,
                attempt,
                error?.code ??
                  videoDateLifecycleRpcCode(payload) ??
                  String(payload?.error ?? "unknown"),
                error ? { code: error.code, message: error.message } : null,
                payload,
              );
              return;
            }
            if (remoteSeenRetryTimerRef.current) {
              clearTimeout(remoteSeenRetryTimerRef.current);
              remoteSeenRetryTimerRef.current = null;
            }
            if (remoteSeenInFlightSessionRef.current === sessionId) {
              remoteSeenInFlightSessionRef.current = null;
            }
            remoteSeenLastStampRef.current = {
              sessionId: activeSessionId,
              stampedAtMs: Date.now(),
            };
            updateVideoDateEntryOwnerState({
              sessionId: activeSessionId,
              userId,
              ownerId: proof.ownerId,
              state: "remote_seen",
              source: `remote_seen_${attemptSource}`,
              roomName: roomNameRef.current,
              entryAttemptId: proof.entryAttemptId,
              videoDateTraceId: proof.videoDateTraceId,
              callInstanceId: proof.callInstanceId,
              providerSessionId: proof.providerSessionId,
            });
            updateVideoDateDailyOwnerState({
              sessionId: activeSessionId,
              userId,
              ownerId: proof.ownerId,
              roomName: roomNameRef.current,
              state: "remote_seen",
              source: `remote_seen_${attemptSource}`,
              entryAttemptId: proof.entryAttemptId,
              videoDateTraceId: proof.videoDateTraceId,
              callInstanceId: proof.callInstanceId,
              providerSessionId: proof.providerSessionId,
            });
            vdbg("mark_video_date_remote_seen_after", {
              sessionId,
              eventId,
              userId,
              source: attemptSource,
              providerSessionId: proof.providerSessionId,
              callInstanceId: proof.callInstanceId,
              participant1RemoteSeenAt:
                payload?.participant_1_remote_seen_at ?? null,
              participant2RemoteSeenAt:
                payload?.participant_2_remote_seen_at ?? null,
            });
          })
          .catch((error: unknown) => {
            handleFailure(
              attemptSource,
              attempt,
              "promise_rejected",
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: String(error) },
            );
          });
      }

      stamp(source, 1);
    },
    [clearDailyAliveHeartbeatTimer],
  );

  useEffect(() => {
    return () => {
      if (remoteSeenRetryTimerRef.current) {
        clearTimeout(remoteSeenRetryTimerRef.current);
        remoteSeenRetryTimerRef.current = null;
      }
      remoteSeenInFlightSessionRef.current = null;
      const sessionId = optionsRef.current?.roomId ?? null;
      const call = callObjectRef.current;
      const shouldPreserveActiveIdentity =
        Boolean(sessionId) &&
        Boolean(call) &&
        hasSameSessionDailyContinuity(sessionId) &&
        optionsRef.current?.videoSessionState !== "ended" &&
        !isTerminalDailyMeetingState(safeMeetingState(call));
      if (shouldPreserveActiveIdentity) {
        vdbg("daily_call_live_remount_identity_preserved", {
          sessionId,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          meetingState: safeMeetingState(call),
        });
        return;
      }
      activeDailyCallIdentityRef.current = null;
    };
  }, [hasSameSessionDailyContinuity]);

  const markRemoteFirstFrameRendered = useCallback(
    (source: string) => {
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
      if (!currentOptions?.roomId) return;
      const sessionId = currentOptions.roomId;
      markRemoteSeenOnServer(source);
      if (remoteFirstFrameTrackedRef.current) return;
      remoteFirstFrameTrackedRef.current = true;

      const nowMs = Date.now();
      const entry = activePreparedEntryCacheRef.current;
      const bothReadyToFirstRemoteFrameMs =
        entry?.bothReadyObservedAtMs == null
          ? null
          : Math.max(0, nowMs - entry.bothReadyObservedAtMs);
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
        entryAttemptId:
          entry?.entryAttemptId ?? entry?.value.entry_attempt_id ?? null,
        videoDateTraceId:
          entry?.value.video_date_trace_id ?? entry?.entryAttemptId ?? null,
        cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
        providerVerifySkipped:
          entry?.value.provider_verify_skipped ??
          lastProviderVerifySkippedRef.current,
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
        media_handoff_used: lastMediaHandoffUsedRef.current,
        media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        daily_prewarm_consumed: lastDailyPrewarmConsumedRef.current,
        prewarmed_join_in_flight: lastPrewarmedJoinInFlightRef.current,
        prewarmed_already_joined: lastPrewarmedAlreadyJoinedRef.current,
        provider_verify_skipped:
          entry?.value.provider_verify_skipped ??
          lastProviderVerifySkippedRef.current,
      });
    },
    [markRemoteSeenOnServer],
  );

  const attachTracks = useCallback(
    (
      participant: DailyParticipant | undefined,
      videoEl: HTMLVideoElement | null,
      isLocal: boolean,
    ) => {
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
      const hasRemoteVideo = !isLocal && Boolean(videoTrack);
      const hasRemoteMedia =
        !isLocal && (Boolean(videoTrack) || Boolean(audioTrack));
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
          if (hasRemoteVideo) {
            videoEl.addEventListener(
              "loadeddata",
              () => markRemoteFirstFrameRendered("loadeddata"),
              { once: true },
            );
            videoEl.addEventListener(
              "playing",
              () => markRemoteFirstFrameRendered("playing"),
              { once: true },
            );
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
                  trackEvent(
                    LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RECOVERED,
                    {
                      platform: "web",
                      session_id: optionsRef.current?.roomId ?? null,
                      event_id: optionsRef.current?.eventId ?? null,
                    },
                  );
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
                      error:
                        error instanceof Error
                          ? { name: error.name, message: error.message }
                          : String(error),
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
                  error:
                    error instanceof Error
                      ? { name: error.name, message: error.message }
                      : String(error),
                });
                trackEvent(
                  LobbyPostDateEvents.VIDEO_DATE_REMOTE_PLAYBACK_REQUIRES_GESTURE,
                  {
                    platform: "web",
                    session_id: optionsRef.current?.roomId ?? null,
                    event_id: optionsRef.current?.eventId ?? null,
                  },
                );
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
        vdbg(
          isLocal
            ? "daily_local_video_attach_failed"
            : "daily_remote_video_attach_failed",
          {
            sessionId: optionsRef.current?.roomId ?? null,
            eventId: optionsRef.current?.eventId ?? null,
            userId: optionsRef.current?.userId ?? null,
            participantSessionId: participant.session_id ?? null,
            videoTrackId: videoTrack?.id ?? null,
            audioTrackId: isLocal ? null : (audioTrack?.id ?? null),
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );
      }
    },
    [markRemoteFirstFrameRendered],
  );

  const needsTrackReattach = useCallback(
    (
      videoEl: HTMLVideoElement | null,
      participant: DailyParticipant | undefined,
      isLocal: boolean,
    ) => {
      if (!videoEl || !participant?.tracks) return false;

      const expectedVideoId =
        participant.tracks.video?.persistentTrack?.id ?? "";
      const expectedAudioId = isLocal
        ? ""
        : (participant.tracks.audio?.persistentTrack?.id ?? "");
      if (!expectedVideoId && !expectedAudioId) return false;

      const current = videoEl.srcObject as MediaStream | null;
      if (!current) return true;

      const hasExpectedVideo =
        !expectedVideoId || streamHasTrackId(current, expectedVideoId);
      const hasExpectedAudio =
        !expectedAudioId || streamHasTrackId(current, expectedAudioId);
      return !(hasExpectedVideo && hasExpectedAudio);
    },
    [],
  );

  const logTrackMounted = useCallback(
    (
      source: string,
      opts: {
        isLocal: boolean;
        participant: DailyParticipant | undefined;
        roomName: string | null;
      },
    ) => {
      const videoTrack = opts.participant?.tracks?.video?.persistentTrack;
      const videoTrackId = videoTrack?.id ?? "";
      const audioTrackId = opts.isLocal
        ? ""
        : (opts.participant?.tracks?.audio?.persistentTrack?.id ?? "");
      const mountedKey = `${videoTrackId}|${audioTrackId}`;
      if (!mountedKey || mountedKey === "|") return;

      const mountedRef = opts.isLocal
        ? lastLocalMountedTrackKeyRef
        : lastRemoteMountedTrackKeyRef;
      if (mountedRef.current === mountedKey) return;
      mountedRef.current = mountedKey;

      vdbg(
        opts.isLocal
          ? "daily_local_track_mounted"
          : "daily_remote_track_mounted",
        {
          sessionId: optionsRef.current?.roomId ?? null,
          eventId: optionsRef.current?.eventId ?? null,
          userId: optionsRef.current?.userId ?? null,
          roomName: opts.roomName,
          source,
          captureProfile: captureProfileRef.current,
          videoTrackId: videoTrackId || null,
          videoTrack: summarizeVideoTrackSettings(videoTrack),
          audioTrackId: audioTrackId || null,
        },
      );
    },
    [],
  );

  const clearFirstRemoteWatchdog = useCallback(() => {
    if (!firstRemoteWatchdogRef.current) return;
    clearTimeout(firstRemoteWatchdogRef.current);
    firstRemoteWatchdogRef.current = null;
  }, []);

  const remoteRenderDiagnostics = useCallback(
    (
      participant: DailyParticipant | undefined,
      videoEl: HTMLVideoElement | null,
    ) => {
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
        videoTrackMuted:
          typeof videoTrack?.muted === "boolean" ? videoTrack.muted : null,
        videoTrackEnabled:
          typeof videoTrack?.enabled === "boolean" ? videoTrack.enabled : null,
        videoElementReadyState: videoEl?.readyState ?? null,
        videoElementPaused: videoEl?.paused ?? null,
        videoElementWidth: videoEl?.videoWidth ?? null,
        videoElementHeight: videoEl?.videoHeight ?? null,
        videoElementCurrentTime:
          typeof videoEl?.currentTime === "number"
            ? Number(videoEl.currentTime.toFixed(3))
            : null,
      };
    },
    [],
  );

  const resetRemoteRenderRecoveryAttempts = useCallback(() => {
    remoteRenderRecoveryTrackAttemptsRef.current.clear();
    remoteRenderRecoveryScopedAttemptsRef.current.clear();
    remoteRenderRecoveryInFlightRef.current = null;
  }, []);

  const clearRemoteRenderValidation = useCallback(
    (options?: { cancelReattach?: boolean }) => {
      remoteRenderValidationSeqRef.current += 1;
      if (remoteRenderValidationDelayRef.current) {
        clearTimeout(remoteRenderValidationDelayRef.current);
        remoteRenderValidationDelayRef.current = null;
      }
      if (remoteRenderValidationTimeoutRef.current) {
        clearTimeout(remoteRenderValidationTimeoutRef.current);
        remoteRenderValidationTimeoutRef.current = null;
      }
      const videoEl =
        remoteVideoRef.current as RemoteVideoElementWithFrameCallback | null;
      if (
        videoEl &&
        remoteRenderValidationFrameCallbackRef.current != null &&
        typeof videoEl.cancelVideoFrameCallback === "function"
      ) {
        videoEl.cancelVideoFrameCallback(
          remoteRenderValidationFrameCallbackRef.current,
        );
      }
      remoteRenderValidationFrameCallbackRef.current = null;
      if (
        options?.cancelReattach !== false &&
        remoteRenderRecoveryReattachTimeoutRef.current
      ) {
        clearTimeout(remoteRenderRecoveryReattachTimeoutRef.current);
        remoteRenderRecoveryReattachTimeoutRef.current = null;
      }
    },
    [],
  );

  const resetRemoteRenderRecoveryForParticipant = useCallback(
    (participant: DailyParticipant | undefined) => {
      const participantId = getParticipantIdentity(participant);
      if (
        !participantId ||
        participantId === lastRemoteRenderParticipantIdRef.current
      )
        return;
      lastRemoteRenderParticipantIdRef.current = participantId;
      resetRemoteRenderRecoveryAttempts();
    },
    [resetRemoteRenderRecoveryAttempts],
  );

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
          reason: !videoEl
            ? "missing_video_element"
            : !remoteKey || !videoTrack
              ? "missing_video_track"
              : "missing_tracks",
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
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryTrackAttemptsRef.current,
        nowMs,
      );
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryScopedAttemptsRef.current,
        nowMs,
      );
      const trackAttempts =
        remoteRenderRecoveryTrackAttemptsRef.current.get(remoteKey)?.attempts ??
        0;
      const scopeAttempts =
        remoteRenderRecoveryScopedAttemptsRef.current.get(scopedAttemptKey)
          ?.attempts ?? 0;
      // Camera-switch hints get a single last-resort reattach. The freshness
      // watchdog already gave the natural keyframe ~3s to arrive; if it
      // didn't, one teardown-and-rebind is enough. A second one would just
      // produce another black-screen window.
      const maxScopeAttemptsForScope =
        scopeKey === "camera_switch_hint"
          ? 1
          : REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE;
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
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryTrackAttemptsRef.current,
        nowMs,
      );
      pruneRemoteRenderRecoveryAttempts(
        remoteRenderRecoveryScopedAttemptsRef.current,
        nowMs,
      );
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
        const latestParticipant =
          latestRemoteParticipantRef.current ?? participant;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (latestKey !== remoteKey) {
          vdbg("daily_remote_render_recovery_skipped", {
            ...remoteRenderDiagnostics(
              latestParticipant,
              remoteVideoRef.current,
            ),
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
          },
        );
      }, 0);
    },
    [
      attachTracks,
      clearRemoteRenderValidation,
      logTrackMounted,
      remoteRenderDiagnostics,
    ],
  );

  const scheduleRemoteRenderValidation = useCallback(
    (
      participant: DailyParticipant | undefined,
      source: string,
      roomName: string | null,
      recoveryScope = source,
      validationOptions: RemoteRenderValidationOptions = {},
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
      if (
        !videoEl ||
        !participant?.tracks ||
        !remoteKey ||
        !videoTrack ||
        videoTrack.readyState === "ended"
      ) {
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

        const latestParticipant =
          latestRemoteParticipantRef.current ?? participant;
        const latestVideoEl = remoteVideoRef.current;
        const latestKey = getTrackIdsKey(latestParticipant, true);
        if (!latestVideoEl || latestKey !== remoteKey) {
          vdbg("daily_remote_render_validation_skipped", {
            ...remoteRenderDiagnostics(latestParticipant, latestVideoEl),
            source,
            reason: !latestVideoEl
              ? "missing_video_element"
              : "stale_track_key",
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
          forceRemoteMediaReattach(
            latestParticipant,
            `${source}:${reason}`,
            roomName,
            recoveryScope,
            {
              ...validationOptions,
              requireFreshFrame,
              freshFrameBaseline,
            },
          );
        }

        function finishValidated(
          method: string,
          metadata?: RemoteVideoFrameCallbackMetadata,
        ) {
          if (remoteRenderValidationSeqRef.current !== validationSeq) return;
          const latestFrameState = readRemoteRenderFrameState(latestVideoEl);
          if (
            requireFreshFrame &&
            !hasFreshRemoteRenderFrame(
              freshFrameBaseline,
              latestFrameState,
              metadata,
            )
          ) {
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
            remoteRenderRecoveryScopedAttemptsRef.current.delete(
              `${remoteKey}:${recovery.scopeKey}`,
            );
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
          markRemoteFirstFrameRendered(
            method === "request_video_frame_callback"
              ? "request_video_frame_callback"
              : "first_remote_frame",
          );
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

        const videoWithFrameCallback =
          latestVideoEl as RemoteVideoElementWithFrameCallback;
        if (
          typeof videoWithFrameCallback.requestVideoFrameCallback === "function"
        ) {
          remoteRenderValidationFrameCallbackRef.current =
            videoWithFrameCallback.requestVideoFrameCallback((_now, metadata) =>
              finishValidated("request_video_frame_callback", metadata),
            );
          remoteRenderValidationTimeoutRef.current = setTimeout(
            () => finishTimedOut("request_video_frame_callback_timeout"),
            effectiveFrameTimeoutMs,
          );
          return;
        }

        remoteRenderValidationTimeoutRef.current = setTimeout(() => {
          const hasRenderableMedia =
            latestVideoEl.readyState >= 2 &&
            latestVideoEl.videoWidth > 0 &&
            latestVideoEl.videoHeight > 0;
          if (hasRenderableMedia) {
            finishValidated("ready_state_fallback");
            return;
          }
          finishTimedOut("ready_state_fallback_timeout");
        }, effectiveFrameTimeoutMs);
      }, REMOTE_RENDER_VALIDATION_DELAY_MS);
    },
    [
      clearRemoteRenderValidation,
      forceRemoteMediaReattach,
      markRemoteFirstFrameRendered,
      remoteRenderDiagnostics,
    ],
  );

  scheduleRemoteRenderValidationRef.current = scheduleRemoteRenderValidation;

  const readLocalCameraSnapshot = useCallback(
    (call: DailyCall): LocalCameraSnapshot => {
      let localParticipant = latestLocalParticipantRef.current;
      try {
        localParticipant = call.participants().local ?? localParticipant;
      } catch {
        /* Keep the most recent participant snapshot from Daily events. */
      }
      return getLocalCameraSnapshot(localParticipant);
    },
    [],
  );

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
        const trackChanged = Boolean(
          before.trackId &&
          snapshot.trackId &&
          snapshot.trackId !== before.trackId,
        );
        const deviceChanged = Boolean(
          before.deviceId &&
          snapshot.deviceId &&
          snapshot.deviceId !== before.deviceId,
        );
        const facingChanged = Boolean(
          before.facingMode &&
          snapshot.facingMode &&
          snapshot.facingMode !== before.facingMode,
        );
        const expectedDeviceMatched = Boolean(
          opts.expectedDeviceId &&
          opts.expectedDeviceId !== before.deviceId &&
          snapshot.deviceId === opts.expectedDeviceId,
        );
        const expectedFacingMatched = Boolean(
          opts.expectedFacing &&
          opts.expectedFacing !== before.facingMode &&
          snapshot.facingMode === opts.expectedFacing,
        );
        const live =
          snapshot.readyState === "live" && snapshot.enabled !== false;

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

      if (
        typeof navigator === "undefined" ||
        typeof navigator.mediaDevices?.getUserMedia !== "function"
      ) {
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
          videoOnlyCameraSwitchConstraints(
            captureProfileRef.current,
            desiredFacing,
            expectedDeviceId,
          ),
        );
        videoTrack = stream.getVideoTracks()[0] ?? null;
        if (!videoTrack) return null;
        await call.setInputDevicesAsync({ videoSource: false });
        dailyVideoInputCleared = true;
        await call.setInputDevicesAsync({ videoSource: videoTrack });
        dailyVideoTrackAdopted = true;
        call.setLocalVideo(true);
        const sourceCommit = await waitForLocalCameraSwitchCommit(
          call,
          before,
          "video_source",
          {
            expectedDeviceId: getTrackDeviceId(videoTrack),
            expectedFacing: getTrackFacingMode(videoTrack) ?? desiredFacing,
            publishRefreshApplied: true,
          },
        );
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
        const deviceCommit = await waitForLocalCameraSwitchCommit(
          call,
          before,
          "set_input_device",
          {
            expectedDeviceId: deviceId,
            expectedFacing: sourceFacing,
          },
        );
        if (deviceCommit && !opts.forceVideoSourceRefresh) return deviceCommit;
        const sourceCommit = await switchToWebCameraVideoSource(
          call,
          before,
          sourceFacing,
          deviceId,
        );
        if (sourceCommit) return sourceCommit;
        if (opts.forceVideoSourceRefresh) {
          const facingSourceCommit = await switchToWebCameraVideoSource(
            call,
            before,
            sourceFacing,
            null,
            deviceId,
          );
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
  const sendCommittedCameraSwitchHint = useCallback(
    async (call: DailyCall, commit: WebCameraSwitchCommit) => {
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
    },
    [],
  );

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
    async (
      sessionId: string,
      eventId: string | null | undefined,
      userId: string | null | undefined,
      promptIntent: VideoDateMediaPromptIntent = "auto",
    ) => {
      const permissionStartedAt = Date.now();
      lastMediaHandoffUsedRef.current = false;
      lastMediaHandoffMissReasonRef.current = null;
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
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        const permissionResult = mediaPermissionResultForStatus({
          status: "unsupported",
          kind: "camera_microphone",
          permissionState: "unsupported",
          rawErrorName: "media_devices_unavailable",
        });
        releaseAppAcquiredMedia("media_devices_unavailable");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          "Camera and microphone access are not available in this browser.",
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: "permission_check_unsupported",
          reason: "media_devices_unavailable",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: null,
        });
        return false;
      }

      const mediaHandoff = userId
        ? consumeWebVideoDateMediaHandoff({ sessionId, userId })
        : { ok: false as const, reason: "missing_user" };
      if (mediaHandoff.ok === true) {
        releaseAppAcquiredMedia("media_handoff_stream_reused");
        const mediaTracks = getLiveVideoDateMediaTracks(mediaHandoff.stream);
        if (mediaTracks) {
          const { videoTrack, audioTrack } = mediaTracks;
          const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
          lastMediaHandoffUsedRef.current = true;
          lastMediaHandoffMissReasonRef.current = null;
          captureProfileRef.current = mediaHandoff.captureProfile;
          setCaptureProfile(mediaHandoff.captureProfile);
          appAcquiredMediaRef.current = {
            stream: mediaHandoff.stream,
            captureProfile: mediaHandoff.captureProfile,
            acquiredAtMs: mediaHandoff.acquiredAtMs,
            consumedByDaily: false,
          };
          setHasPermission(true);
          setMediaPermissionResult(null);
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
              sourceAction: "media_handoff_stream",
              outcome: "success",
              durationMs,
            }),
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "media_handoff_stream",
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
            media_handoff_used: true,
            media_handoff_miss_reason: null,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId ?? null,
            source_surface: "video_date_daily",
            source_action: "media_handoff_stream",
            diagnostic_scope: "sender_capture",
            capture_profile: mediaHandoff.captureProfile,
            app_acquired_media: true,
            media_handoff_used: true,
            media_handoff_miss_reason: null,
            media_handoff_source: mediaHandoff.source,
            audio_track_present: Boolean(audioTrack),
            video_track_present: true,
            video_track_width: videoTrackSettings?.width ?? null,
            video_track_height: videoTrackSettings?.height ?? null,
            video_track_aspect_ratio: videoTrackSettings?.aspectRatio ?? null,
            video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
            video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
            ...summarizeWebRuntime(),
          });
          vdbg("daily_media_handoff_stream_used", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            captureProfile: mediaHandoff.captureProfile,
            handoffSource: mediaHandoff.source,
            videoTrack: videoTrackSettings,
          });
          return true;
        }
        lastMediaHandoffMissReasonRef.current =
          missingLiveVideoDateMediaTrackReason(mediaHandoff.stream);
        stopMediaStreamTracks(mediaHandoff.stream);
      } else {
        lastMediaHandoffMissReasonRef.current = mediaHandoff.reason;
      }
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "media_handoff_miss",
        diagnostic_scope: "sender_capture",
        app_acquired_media: false,
        media_handoff_used: false,
        media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        ...summarizeWebRuntime(),
      });

      let deferredMediaPermissionError: unknown = null;
      const permissionHandoff = userId
        ? getVideoDatePermissionHandoff(sessionId, userId)
        : null;
      const captureReadiness = await resolveWebVideoDateMediaCaptureReadiness(
        promptIntent,
        Boolean(permissionHandoff),
      );
      let mediaPermissionFailureSourceAction = captureReadiness.sourceAction;
      if (!captureReadiness.canAcquire) {
        releaseAppAcquiredMedia("media_permission_preflight_prompt_required");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        const permissionResult = mediaPermissionResultForStatus({
          status:
            captureReadiness.permissionState === "denied"
              ? "denied"
              : "promptable",
          kind: "camera_microphone",
          permissionState: captureReadiness.permissionState,
          rawErrorName: captureReadiness.reasonCode,
          rawErrorMessage:
            "Camera and microphone access needs a tap before this browser can ask.",
        });
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          "Camera and microphone access is needed before this date can start.",
        );
        vdbg("daily_media_permission_preflight_prompt_required", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          promptIntent,
          permissionState: captureReadiness.permissionState,
          sourceAction: captureReadiness.sourceAction,
          reasonCode: captureReadiness.reasonCode,
          mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
        });
        trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source: captureReadiness.sourceAction,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: captureReadiness.sourceAction,
          reason:
            captureReadiness.reasonCode ?? "media_permission_prompt_required",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        });
        return false;
      }
      if (permissionHandoff) {
        releaseAppAcquiredMedia("permission_handoff_media_restart");
        let handoffCaptureProfile: VideoDateWebMediaCaptureProfile =
          permissionHandoff.captureProfile ?? "ideal";
        let handoffStream: MediaStream | null = null;
        let handoffMediaAcquired = false;
        try {
          for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
            try {
              handoffStream = await navigator.mediaDevices.getUserMedia(
                videoDateWebMediaStreamConstraints(profile),
              );
              handoffCaptureProfile = profile;
              break;
            } catch (profileError) {
              if (
                !isVideoDateCameraConstraintError(profileError) ||
                profile === "fallback"
              ) {
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
          if (handoffStream) {
            const { videoTrack, audioTrack } = requireLiveVideoDateMediaTracks(
              handoffStream,
              "Video Date permission handoff media acquire",
            );
            const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
            appAcquiredMediaRef.current = {
              stream: handoffStream,
              captureProfile: handoffCaptureProfile,
              acquiredAtMs: Date.now(),
              consumedByDaily: false,
            };
            handoffMediaAcquired = true;
            handoffStream = null;
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC,
              {
                platform: "web",
                session_id: sessionId,
                event_id: eventId ?? null,
                source_surface: "video_date_daily",
                source_action: "permission_handoff_media_acquired",
                diagnostic_scope: "sender_capture",
                capture_profile: handoffCaptureProfile,
                app_acquired_media: true,
                media_handoff_used: false,
                media_handoff_miss_reason:
                  lastMediaHandoffMissReasonRef.current,
                audio_track_present: Boolean(audioTrack),
                video_track_present: true,
                video_track_width: videoTrackSettings?.width ?? null,
                video_track_height: videoTrackSettings?.height ?? null,
                video_track_aspect_ratio:
                  videoTrackSettings?.aspectRatio ?? null,
                video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
                video_track_facing_mode: videoTrackSettings?.facingMode ?? null,
                ...summarizeWebRuntime(),
              },
            );
          }
        } catch (error) {
          vdbg("daily_media_permission_handoff_media_acquire_failed", {
            sessionId,
            eventId: eventId ?? null,
            userId: userId ?? null,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          deferredMediaPermissionError = error;
          mediaPermissionFailureSourceAction =
            "permission_handoff_media_failed";
        } finally {
          stopMediaStreamTracks(handoffStream);
        }
        if (handoffMediaAcquired) {
          captureProfileRef.current = handoffCaptureProfile;
          setCaptureProfile(handoffCaptureProfile);
          setHasPermission(true);
          setMediaPermissionResult(null);
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
            media_handoff_used: false,
            media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          });
          vdbg("daily_media_permission_handoff_used", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            handoffSource: permissionHandoff.source,
            mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          });
          return true;
        }
        if (deferredMediaPermissionError) {
          vdbg(
            "daily_media_permission_handoff_failed_without_preflight_retry",
            {
              sessionId,
              eventId: eventId ?? null,
              userId,
              handoffSource: permissionHandoff.source,
              mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
            },
          );
        } else {
          vdbg("daily_media_permission_handoff_fallback_to_preflight", {
            sessionId,
            eventId: eventId ?? null,
            userId,
            handoffSource: permissionHandoff.source,
            mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          });
        }
      }

      try {
        if (deferredMediaPermissionError) {
          releaseAppAcquiredMedia("permission_handoff_media_failed");
          throw deferredMediaPermissionError;
        }
        releaseAppAcquiredMedia("media_permission_preflight_restart");
        let stream: MediaStream | null = null;
        let nextCaptureProfile: VideoDateWebMediaCaptureProfile = "ideal";
        let lastConstraintError: unknown = null;

        for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(
              videoDateWebMediaStreamConstraints(profile),
            );
            nextCaptureProfile = profile;
            break;
          } catch (profileError) {
            if (
              !isVideoDateCameraConstraintError(profileError) ||
              profile === "fallback"
            ) {
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
          throw (
            lastConstraintError ??
            new Error("Media permission preflight returned no stream")
          );
        }

        captureProfileRef.current = nextCaptureProfile;
        setCaptureProfile(nextCaptureProfile);
        let mediaTracks: LiveVideoDateMediaTracks;
        try {
          mediaTracks = requireLiveVideoDateMediaTracks(
            stream,
            "Video Date media permission preflight",
          );
        } catch (error) {
          stopMediaStreamTracks(stream);
          throw error;
        }
        const { videoTrack, audioTrack } = mediaTracks;
        const videoTrackSettings = summarizeVideoTrackSettings(videoTrack);
        appAcquiredMediaRef.current = {
          stream,
          captureProfile: nextCaptureProfile,
          acquiredAtMs: Date.now(),
          consumedByDaily: false,
        };
        setHasPermission(true);
        setMediaPermissionResult(null);
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
          media_handoff_used: false,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
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
          media_handoff_used: false,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
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
          promptIntent,
          captureReadinessSourceAction: captureReadiness.sourceAction,
          captureProfile: nextCaptureProfile,
          appAcquiredMedia: true,
          mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          audioTrackPresent: Boolean(audioTrack),
          videoTrack: videoTrackSettings,
        });
        if (mediaPermissionDeniedRef.current) {
          mediaPermissionDeniedRef.current = false;
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_RECOVERED,
            {
              platform: "web",
              session_id: sessionId,
              event_id: eventId ?? null,
            },
          );
        }
        return true;
      } catch (error) {
        releaseAppAcquiredMedia("media_permission_preflight_failed");
        mediaPermissionDeniedRef.current = true;
        setHasPermission(false);
        const permissionResult =
          await classifyMediaPermissionErrorWithBrowserState(
            error,
            "camera_microphone",
          );
        const description = describeMediaError(error);
        setMediaPermissionResult(permissionResult);
        setMediaPermissionError(
          description || "Camera or microphone permission was denied.",
        );
        vdbg("daily_media_permission_preflight_failed", {
          sessionId,
          eventId: eventId ?? null,
          userId: userId ?? null,
          sourceAction: mediaPermissionFailureSourceAction,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source: mediaPermissionFailureSourceAction,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId ?? null,
          source_surface: "video_date_daily",
          source_action: mediaPermissionFailureSourceAction,
          reason: permissionResult.rawErrorName ?? "media_permission_error",
          permission_status: permissionResult.status,
          permission_state: permissionResult.permissionState,
          recovery_action: permissionResult.recoveryAction,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
        });
        Sentry.captureMessage("video_date_media_permission_denied", {
          level: "warning",
          extra: {
            sessionId,
            eventId: eventId ?? null,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        });
        return false;
      }
    },
    [releaseAppAcquiredMedia],
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
    (caller: string, reason: string) => {
      const cleanupPromise = (async () => {
        const callObject = callObjectRef.current;
        const roomName = roomNameRef.current;
        const sessionId = optionsRef.current?.roomId ?? null;
        const eventId = optionsRef.current?.eventId ?? null;
        const userId = optionsRef.current?.userId ?? null;
        const meetingStateBeforeCleanup = safeMeetingState(callObject);
        const phaseBeforeCleanup =
          optionsRef.current?.videoSessionState ?? null;
        const sameSessionDailyContinuity =
          Boolean(optionsRef.current?.dailyCallSingletonEligible) ||
          hasSameSessionDailyContinuity(sessionId);
        const shouldParkLiveSingleton =
          sameSessionDailyContinuity &&
          Boolean(callObject) &&
          Boolean(userId) &&
          caller === "useVideoCall.unmount" &&
          reason === "component_unmount" &&
          phaseBeforeCleanup !== "ended" &&
          !isTerminalDailyMeetingState(meetingStateBeforeCleanup);
        let callLeftSuccessfully = false;
        let parkedSingleton = false;

        vdbg("daily_call_cleanup_start", {
          caller,
          reason,
          sessionId,
          eventId,
          roomName,
          hasCallObject: Boolean(callObject),
          dailyCallSingletonEligible: Boolean(
            optionsRef.current?.dailyCallSingletonEligible,
          ),
          sameSessionDailyContinuity,
          sameSessionDailyContinuityLatched:
            hasSameSessionDailyContinuity(sessionId),
          willParkSingleton: shouldParkLiveSingleton,
          singletonParkingMode: shouldParkLiveSingleton
            ? "live_same_session_remount"
            : null,
          meetingState: meetingStateBeforeCleanup,
        });
        void emitWebVideoDateClientStuckState({
          sessionId,
          eventName: "daily_call_cleanup",
          dedupe: false,
          payload: {
            source_surface: "video_date_daily",
            source_action: "daily_call_cleanup_start",
            reason_code: reason,
            cleanup_reason: reason,
            caller,
            room_name: roomName ?? undefined,
            meeting_state: meetingStateBeforeCleanup ?? undefined,
            phase: phaseBeforeCleanup ?? undefined,
            same_session_daily_continuity: sameSessionDailyContinuity,
            same_session_daily_continuity_latched:
              hasSameSessionDailyContinuity(sessionId),
            daily_call_singleton_eligible: Boolean(
              optionsRef.current?.dailyCallSingletonEligible,
            ),
            will_park_singleton: shouldParkLiveSingleton,
            leave_called: Boolean(callObject) && !shouldParkLiveSingleton,
            destroy_called: Boolean(callObject) && !shouldParkLiveSingleton,
            parked_singleton: shouldParkLiveSingleton,
            singleton_parking_mode: shouldParkLiveSingleton
              ? "live_same_session_remount"
              : undefined,
            idle_destroy_disabled:
              shouldParkLiveSingleton &&
              WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS == null,
            call_object_present: Boolean(callObject),
          },
        });

        if (callObject) {
          dailyListenerGenerationRef.current += 1;
          clearDailyTokenRefreshTimer();
          dailyTokenRecoveryInFlightRef.current = false;
          clearDailyEventListeners("daily_call_cleanup");
          if (shouldParkLiveSingleton && userId) {
            parkWebDailyCallSingleton({
              call: callObject,
              userId,
              captureProfile: captureProfileRef.current,
              appAcquiredMedia: appAcquiredMediaRef.current,
              previousSessionId: sessionId,
              previousRoomName: roomName,
              reason,
              stopHeartbeat: clearDailyAliveHeartbeatTimer,
            });
            parkedSingleton = true;
            vdbg(
              "daily_call_live_remount_leave_destroy_skipped_for_singleton",
              {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                meetingState: meetingStateBeforeCleanup,
              },
            );
            vdbg("daily_call_live_remount_detach_only", {
              caller,
              reason,
              sessionId,
              eventId,
              roomName,
              meetingState: meetingStateBeforeCleanup,
              heartbeat_transferred: true,
              call_ref_preserved: true,
            });
          } else {
            try {
              vdbg("daily_call_leave_before", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
              });
              await callObject.leave();
              callLeftSuccessfully = true;
              vdbg("daily_call_leave_after", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: true,
              });
            } catch (error) {
              vdbg("daily_call_leave_after", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: false,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
              });
            }

            try {
              await Promise.resolve(callObject.destroy());
              vdbg("daily_call_destroy", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: true,
              });
            } catch (error) {
              vdbg("daily_call_destroy", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: false,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
              });
            }
          }
        }
        if (!parkedSingleton) {
          activeDailyCallIdentityRef.current = null;
          clearDailyAliveHeartbeatTimer(`daily_call_cleanup:${reason}`);
        } else {
          vdbg("daily_call_live_remount_heartbeat_preserved", {
            caller,
            reason,
            sessionId,
            eventId,
            roomName,
            meetingState: meetingStateBeforeCleanup,
            activeIdentityPreserved: Boolean(
              activeDailyCallIdentityRef.current,
            ),
          });
        }
        if (!parkedSingleton) {
          activeCallSessionIdRef.current = null;
          clearSameSessionDailyContinuity(
            sessionId,
            `daily_call_cleanup:${reason}`,
          );
        }
        if (!parkedSingleton) {
          callObjectRef.current = null;
        }
        clearDailyTokenRefreshTimer();
        dailyTokenRecoveryInFlightRef.current = false;

        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (!parkedSingleton) {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          setLocalStream(null);
          setHasPermission(null);
          setIsConnected(false);
          setIsConnecting(false);
          setDailyMeetingState(null);
          setLocalInDailyRoom(false);
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
          activePreparedEntryCacheHitRef.current = null;
          dailyJoinStartedAtMsRef.current = null;
          lastMediaHandoffUsedRef.current = false;
          lastMediaHandoffMissReasonRef.current = null;
          lastDailyPrewarmConsumedRef.current = false;
          lastPrewarmedJoinInFlightRef.current = false;
          lastPrewarmedAlreadyJoinedRef.current = false;
          lastProviderVerifySkippedRef.current = null;
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
        }
        if (!parkedSingleton) {
          releaseAppAcquiredMedia("daily_call_cleanup");
        } else {
          appAcquiredMediaRef.current = null;
        }
        void emitWebVideoDateClientStuckState({
          sessionId,
          eventName: "daily_call_cleanup",
          dedupe: false,
          payload: {
            source_surface: "video_date_daily",
            source_action: "daily_call_cleanup_end",
            reason_code: reason,
            cleanup_reason: reason,
            caller,
            room_name: roomName ?? undefined,
            meeting_state: meetingStateBeforeCleanup ?? undefined,
            phase: phaseBeforeCleanup ?? undefined,
            same_session_daily_continuity: sameSessionDailyContinuity,
            same_session_daily_continuity_latched:
              hasSameSessionDailyContinuity(sessionId),
            daily_call_singleton_eligible: Boolean(
              optionsRef.current?.dailyCallSingletonEligible,
            ),
            will_park_singleton: shouldParkLiveSingleton,
            leave_called: callLeftSuccessfully,
            destroy_called: Boolean(callObject) && !parkedSingleton,
            parked_singleton: parkedSingleton,
            singleton_parking_mode:
              parkedSingleton && shouldParkLiveSingleton
                ? "live_same_session_remount"
                : undefined,
            idle_destroy_disabled:
              parkedSingleton && WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS == null,
            call_object_present: Boolean(callObject),
          },
        });
      })();

      return registerWebVideoDateDailyCleanup(cleanupPromise, {
        source: caller,
        reason,
        onDiagnostic: (eventName, payload) => {
          vdbg(eventName, {
            caller,
            reason,
            ...payload,
          });
        },
      });
    },
    [
      clearDailyEventListeners,
      clearDailyAliveHeartbeatTimer,
      clearDailyTokenRefreshTimer,
      clearSameSessionDailyContinuity,
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      clearRemoteRenderValidation,
      hasSameSessionDailyContinuity,
      releaseAppAcquiredMedia,
      resetRemoteRenderRecoveryAttempts,
    ],
  );

  const fetchVideoDateTruth = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from("video_sessions")
      .select(
        "id, event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, daily_room_name, daily_room_url, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at",
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
      truthRow: VideoDateTruthRow | null,
    ): Promise<
      | {
          ok: true;
          roomData: DailyRoomSuccessResponse;
          cacheEntry: PreparedVideoDateEntryCacheEntry;
          cached: boolean;
        }
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
            provider_room_recreated:
              handoff.cacheEntry.value.provider_room_recreated,
            provider_verify_skipped:
              handoff.cacheEntry.value.provider_verify_skipped,
          };
          const entryAttemptId =
            successfulRoomData.entry_attempt_id ??
            handoff.cacheEntry.entryAttemptId ??
            null;
          const videoDateTraceId =
            successfulRoomData.video_date_trace_id ?? entryAttemptId;
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

      for (
        let attempt = 0;
        attempt <= PREPARE_DATE_ENTRY_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
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
            VIDEO_DATE_PREJOIN_TIMEOUT_MS,
          );
        } catch (error) {
          lastFailure = {
            kind: "network",
            retryable: true,
            serverCode: isInvokeTimeoutError(error)
              ? "PREPARE_ENTRY_TIMEOUT"
              : undefined,
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
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
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
          const delayMs = PREPARE_DATE_ENTRY_RETRY_DELAYS_MS[attempt];
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
          const entryAttemptId =
            successfulRoomData.entry_attempt_id ??
            result.cacheEntry.entryAttemptId ??
            null;
          const videoDateTraceId =
            successfulRoomData.video_date_trace_id ?? entryAttemptId;
          vdbg("daily_room_after", {
            action: "prepare_date_entry",
            ok: true,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: successfulRoomData.room_name,
            hasToken: true,
            reusedRoom: successfulRoomData.reused_room ?? null,
            providerRoomRecreated:
              successfulRoomData.provider_room_recreated ?? null,
            providerVerifySkipped:
              successfulRoomData.provider_verify_skipped ?? null,
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
            provider_room_recreated:
              successfulRoomData.provider_room_recreated === true,
            provider_verify_skipped:
              successfulRoomData.provider_verify_skipped === true,
            cached: result.cached,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: result.cacheEntry
              ? Math.max(
                  0,
                  result.cacheEntry.prepareFinishedAtMs -
                    result.cacheEntry.prepareStartedAtMs,
                )
              : null,
            latency_bucket: bucketVideoDateLatencyMs(
              result.cacheEntry
                ? Math.max(
                    0,
                    result.cacheEntry.prepareFinishedAtMs -
                      result.cacheEntry.prepareStartedAtMs,
                  )
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

        const delayMs = PREPARE_DATE_ENTRY_RETRY_DELAYS_MS[attempt];
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
    [],
  );

  const waitForInFlightStartCall = useCallback(
    async (
      sessionId: string,
      eventId: string | null | undefined,
      userId: string | null | undefined,
    ): Promise<VideoCallStartResult> => {
      const startedAtMs = Date.now();
      while (
        startCallInFlightSessionRef.current === sessionId &&
        Date.now() - startedAtMs < START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS
      ) {
        await sleep(START_CALL_IN_FLIGHT_WAIT_POLL_MS);
      }

      const meetingState = safeMeetingState(callObjectRef.current);
      const reused =
        activeCallSessionIdRef.current === sessionId &&
        Boolean(callObjectRef.current) &&
        !isTerminalDailyMeetingState(meetingState);
      vdbg("daily_call_reuse_decision", {
        sessionId,
        eventId,
        userId,
        reusedCallObject: reused,
        reason: reused
          ? "start_call_in_flight_resolved_joined"
          : "start_call_in_flight_resolved_without_join",
        wait_ms: Date.now() - startedAtMs,
        roomName: roomNameRef.current,
        meetingState,
      });

      if (reused) {
        latchSameSessionDailyContinuity(
          sessionId,
          "start_call_in_flight_resolved_joined",
        );
        return { ok: true } as VideoCallStartResult;
      }
      return {
        ok: false,
        failure: { kind: "start_call_in_flight_failed", retryable: true },
      } as VideoCallStartResult;
    },
    [latchSameSessionDailyContinuity],
  );

  const startCall = useCallback(
    async (
      roomId?: string,
      opts?: VideoCallStartOptions,
    ): Promise<VideoCallStartResult> => {
      const sessionId = roomId || optionsRef.current?.roomId;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      const mediaPromptIntent = opts?.mediaPromptIntent ?? "auto";
      if (!sessionId) {
        toast.error("No session ID provided");
        return {
          ok: false,
          failure: { kind: "session_unavailable", retryable: false },
        } as VideoCallStartResult;
      }
      if (
        activeCallSessionIdRef.current === sessionId &&
        callObjectRef.current
      ) {
        const meetingState = safeMeetingState(callObjectRef.current);
        if (isTerminalDailyMeetingState(meetingState)) {
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: "existing_call_object_terminal_before_start",
            roomName: roomNameRef.current,
            meetingState,
          });
        } else {
          latchSameSessionDailyContinuity(
            sessionId,
            "start_call_existing_active_call",
          );
          setDailyMeetingState(meetingState);
          setLocalInDailyRoom(meetingState === "joined-meeting");
          void emitWebVideoDateClientStuckState({
            sessionId,
            eventName: "daily_call_reuse",
            dedupe: false,
            payload: {
              source_surface: "video_date_daily",
              source_action: "start_call_reuse_same_session",
              reason_code: "existing_call_object_already_started",
              room_name: roomNameRef.current ?? undefined,
              meeting_state: meetingState ?? undefined,
              reused: true,
            },
          });
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: true,
            reason: "existing_call_object_already_started",
            roomName: roomNameRef.current,
            meetingState,
          });
          return { ok: true } as VideoCallStartResult;
        }
      }
      if (!opts?.skipStartGate) {
        const activeGate = getWebVideoDateStartGateEntry(sessionId, userId);
        if (activeGate) {
          activeGate.observeCount += 1;
          vdbg("daily_call_start_gate_joined", {
            sessionId,
            eventId,
            userId,
            observeCount: activeGate.observeCount,
            waitMs: Date.now() - activeGate.startedAtMs,
          });
          const activeGateResult = await activeGate.promise;
          if (activeGateResult.ok !== true) {
            return activeGateResult;
          }
          const meetingState = safeMeetingState(callObjectRef.current);
          if (
            activeCallSessionIdRef.current === sessionId &&
            callObjectRef.current &&
            !isTerminalDailyMeetingState(meetingState)
          ) {
            return activeGateResult;
          }
          vdbg("daily_call_start_gate_adopt_current_owner", {
            sessionId,
            eventId,
            userId,
            observeCount: activeGate.observeCount,
            waitMs: Date.now() - activeGate.startedAtMs,
            localMeetingState: meetingState,
          });
          return startCall(sessionId, {
            ...opts,
            internalRetry: true,
            skipStartGate: true,
          });
        }

        const gatedPromise: Promise<VideoCallStartResult> = startCall(
          sessionId,
          {
            ...opts,
            skipStartGate: true,
          },
        );
        const registeredGate = registerWebVideoDateStartGateEntry(
          sessionId,
          userId,
          gatedPromise,
        );
        vdbg("daily_call_start_gate_registered", {
          sessionId,
          eventId,
          userId,
          observeCount: registeredGate.observeCount,
        });
        return gatedPromise;
      }
      if (
        !opts?.internalRetry &&
        startCallInFlightSessionRef.current === sessionId
      ) {
        vdbg("daily_call_reuse_decision", {
          sessionId,
          eventId,
          userId,
          reusedCallObject: true,
          reason: "start_call_already_in_flight",
          roomName: roomNameRef.current,
        });
        return waitForInFlightStartCall(sessionId, eventId, userId);
      }
      startCallInFlightSessionRef.current = sessionId;
      latchSameSessionDailyContinuity(sessionId, "start_call_requested");

      setIsConnecting(true);
      setIsConnected(false);
      setDailyMeetingState("joining-meeting");
      setLocalInDailyRoom(false);
      setHasPermission(null);
      setMediaPermissionResult(null);
      setMediaPermissionError(null);
      setRemotePlayback(createRemotePlaybackState());
      setPeerMissing({ terminal: false });
      firstRemoteObservedRef.current = false;
      remoteFirstFrameTrackedRef.current = false;
      playbackBlockedRef.current = false;
      activePreparedEntryCacheHitRef.current = null;
      lastMediaHandoffUsedRef.current = false;
      lastMediaHandoffMissReasonRef.current = null;
      lastDailyPrewarmConsumedRef.current = false;
      lastPrewarmedJoinInFlightRef.current = false;
      lastPrewarmedAlreadyJoinedRef.current = false;
      lastProviderVerifySkippedRef.current = null;
      clearDailyTokenRefreshTimer();
      dailyTokenRecoveryInFlightRef.current = false;
      clearFirstRemoteWatchdog();
      startAttemptNonceRef.current += 1;
      const startNonce = startAttemptNonceRef.current;
      let dailyPrewarmConsumedForJoin = false;
      if (!opts?.internalRetry) {
        peerMissingTruthRefreshCountRef.current = 0;
      }

      try {
        if (callObjectRef.current) {
          const meetingState = safeMeetingState(callObjectRef.current);
          const sameActiveSession =
            activeCallSessionIdRef.current === sessionId;
          if (sameActiveSession && !isTerminalDailyMeetingState(meetingState)) {
            latchSameSessionDailyContinuity(
              sessionId,
              "start_call_same_session_reuse",
            );
            setDailyMeetingState(meetingState);
            setLocalInDailyRoom(meetingState === "joined-meeting");
            void emitWebVideoDateClientStuckState({
              sessionId,
              eventName: "daily_call_reuse",
              dedupe: false,
              payload: {
                source_surface: "video_date_daily",
                source_action: "start_call_reuse_before_rebuild",
                reason_code: "same_session_call_still_active",
                room_name: roomNameRef.current ?? undefined,
                meeting_state: meetingState ?? undefined,
                reused: true,
              },
            });
            vdbg("daily_call_reuse_decision", {
              sessionId,
              eventId,
              userId,
              reusedCallObject: true,
              reason: "same_session_call_still_active",
              previousRoomName: roomNameRef.current,
              meetingState,
            });
            return { ok: true } as VideoCallStartResult;
          }
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: sameActiveSession
              ? "existing_same_session_terminal_rebuilt_before_start"
              : "existing_call_object_rebuilt_before_start",
            previousRoomName: roomNameRef.current,
            meetingState,
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

        const { truth: initialTruthRow, error: truthError } =
          await fetchVideoDateTruth(sessionId);
        const truthRow = initialTruthRow;
        vdbg("date_prejoin_truth_row", {
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          row: truthRow ?? null,
          error: truthError
            ? { code: truthError.code, message: truthError.message }
            : null,
        });

        if (truthError || !truthRow) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "session_unavailable", retryable: false },
          } as VideoCallStartResult;
        }

        if (truthRow.ended_at) {
          clearSameSessionDailyContinuity(
            sessionId,
            "truth_ended_before_start",
          );
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "SESSION_ENDED", retryable: false },
          } as VideoCallStartResult;
        }
        latchSameSessionDailyContinuity(sessionId, "date_entry_truth_active");

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

        const skipMediaPreflightForSingleton = userId
          ? hasReusableWebDailyCallSingleton({
              userId,
              nextSessionId: sessionId,
            })
          : false;
        const mediaAllowed = skipMediaPreflightForSingleton
          ? true
          : await preflightMediaPermission(
              sessionId,
              truthRow.event_id ?? eventId,
              userId,
              mediaPromptIntent,
            );
        if (skipMediaPreflightForSingleton) {
          setHasPermission(true);
          setMediaPermissionResult(null);
          setMediaPermissionError(null);
          vdbg("daily_media_permission_preflight_skipped_for_singleton", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
          });
        }
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
          truthRow,
        );
        if (roomResult.ok === false) {
          releaseAppAcquiredMedia("daily_room_failed_after_media_preflight");
          setIsConnecting(false);
          return {
            ok: false,
            failure: roomResult.failure,
          } as VideoCallStartResult;
        }
        let roomData = roomResult.roomData;
        activePreparedEntryCacheRef.current = roomResult.cacheEntry;
        activePreparedEntryCacheHitRef.current = roomResult.cached;
        lastProviderVerifySkippedRef.current =
          roomData.provider_verify_skipped ?? null;
        const entryAttemptId =
          roomData.entry_attempt_id ??
          roomResult.cacheEntry.entryAttemptId ??
          null;
        const videoDateTraceId = roomData.video_date_trace_id ?? entryAttemptId;
        type DailyTokenRefreshSourceAction =
          | "daily_token_refresh_before_join"
          | "daily_token_refresh_join_retry"
          | "daily_token_refresh_before_expiry"
          | "daily_token_refresh_after_ejection"
          | "daily_token_refresh_after_auth_error";
        type DailyTokenRefreshFailureState = {
          kind: "terminal" | "rate_limited" | "retryable";
          error: string;
          retryAfterMs: number | null;
          phase: string | null;
        };
        let lastDailyTokenRefreshFailure: DailyTokenRefreshFailureState | null =
          null;
        const getLastDailyTokenRefreshFailure =
          (): DailyTokenRefreshFailureState | null =>
            lastDailyTokenRefreshFailure;
        const refreshDailyTokenForJoin = async (
          sourceAction: DailyTokenRefreshSourceAction,
          cause?: unknown,
        ): Promise<boolean> => {
          lastDailyTokenRefreshFailure = null;
          const refreshStartedAtMs = Date.now();
          vdbg(sourceAction, {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            cause:
              cause instanceof Error
                ? cause.message
                : cause
                  ? String(cause)
                  : null,
          });
          const refresh = await refreshVideoDateToken(sessionId);
          let durationMs = Date.now() - refreshStartedAtMs;
          if (refresh.ok === false) {
            const refreshFailure: DailyTokenRefreshFailureState = {
              kind: isVideoDateTokenRefreshTerminal(refresh)
                ? "terminal"
                : isVideoDateTokenRefreshRateLimited(refresh)
                  ? "rate_limited"
                  : "retryable",
              error: refresh.error,
              retryAfterMs: videoDateTokenRefreshRetryAfterMs(refresh),
              phase: refresh.phase ?? null,
            };
            lastDailyTokenRefreshFailure = refreshFailure;
            if (refresh.error === "room_not_ready") {
              vdbg("daily_token_refresh_prepare_entry_recovery_started", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                sourceAction,
                roomName: roomData.room_name,
              });
              const prepared = await prepareVideoDateEntry(sessionId, {
                eventId: truthRow.event_id ?? eventId,
                userId,
                source: `${sourceAction}_room_recovery`,
                force: true,
              });
              durationMs = Date.now() - refreshStartedAtMs;
              if (
                prepared.ok === true &&
                prepared.data.room_name === roomData.room_name &&
                prepared.data.room_url === roomData.room_url
              ) {
                activePreparedEntryCacheRef.current = prepared.cacheEntry;
                activePreparedEntryCacheHitRef.current = prepared.cached;
                lastProviderVerifySkippedRef.current =
                  prepared.data.provider_verify_skipped ?? null;
                roomData = {
                  ...roomData,
                  token: prepared.data.token,
                  token_expires_at: prepared.data.token_expires_at ?? null,
                  entry_attempt_id:
                    prepared.data.entry_attempt_id ??
                    roomData.entry_attempt_id ??
                    null,
                  video_date_trace_id:
                    prepared.data.video_date_trace_id ??
                    prepared.data.entry_attempt_id ??
                    roomData.video_date_trace_id ??
                    null,
                  provider_room_recreated:
                    prepared.data.provider_room_recreated ??
                    roomData.provider_room_recreated,
                  provider_verify_skipped:
                    prepared.data.provider_verify_skipped ??
                    roomData.provider_verify_skipped,
                };
                vdbg("daily_token_refresh_prepare_entry_recovery_success", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  sourceAction,
                  roomName: roomData.room_name,
                  tokenExpiresAt: roomData.token_expires_at ?? null,
                  durationMs,
                });
                trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  source_surface: "video_date_daily",
                  source_action: sourceAction,
                  cached: prepared.cached,
                  handoff_used: false,
                  attempt: 2,
                  attempt_count: 2,
                  entry_attempt_id: prepared.data.entry_attempt_id ?? null,
                  video_date_trace_id:
                    prepared.data.video_date_trace_id ??
                    prepared.data.entry_attempt_id ??
                    null,
                  recovered_via_prepare_entry: true,
                  provider_verify_reason:
                    prepared.data.provider_verify_reason ?? null,
                  provider_verify_skipped:
                    prepared.data.provider_verify_skipped === true,
                  duration_ms: durationMs,
                  latency_bucket: bucketVideoDateLatencyMs(durationMs),
                });
                lastDailyTokenRefreshFailure = null;
                return true;
              }
              vdbg("daily_token_refresh_prepare_entry_recovery_failed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                sourceAction,
                reason: prepared.ok === true ? "room_mismatch" : prepared.code,
                previousRoomName: roomData.room_name,
                preparedRoomName:
                  prepared.ok === true ? prepared.data.room_name : null,
                previousRoomUrl: roomData.room_url,
                preparedRoomUrl:
                  prepared.ok === true ? prepared.data.room_url : null,
                durationMs,
              });
            }
            vdbg("daily_token_refresh_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              sourceAction,
              reason: refresh.error,
              retryable: refresh.retryable ?? null,
              retryAfterMs: refreshFailure.retryAfterMs,
              terminal: refreshFailure.kind === "terminal",
              durationMs,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: sourceAction,
              code: refresh.error,
              reason_code: refresh.error,
              failure_class: classifyDailyRoomTokenFailureClass("network"),
              retryable: refresh.retryable ?? true,
              duration_ms: durationMs,
              latency_bucket: bucketVideoDateLatencyMs(durationMs),
              attempt_count: 1,
            });
            return false;
          }

          if (
            refresh.roomName !== roomData.room_name ||
            refresh.roomUrl !== roomData.room_url
          ) {
            lastDailyTokenRefreshFailure = {
              kind: "terminal",
              error: "token_refresh_room_mismatch",
              retryAfterMs: null,
              phase: refresh.phase ?? null,
            };
            vdbg("daily_token_refresh_room_mismatch", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              previousRoomName: roomData.room_name,
              refreshedRoomName: refresh.roomName,
              previousRoomUrl: roomData.room_url,
              refreshedRoomUrl: refresh.roomUrl,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: sourceAction,
              code: "token_refresh_room_mismatch",
              reason_code: "token_refresh_room_mismatch",
              failure_class: classifyDailyRoomTokenFailureClass("network"),
              retryable: true,
              duration_ms: durationMs,
              latency_bucket: bucketVideoDateLatencyMs(durationMs),
              attempt_count: 1,
            });
            return false;
          }

          roomData = {
            ...roomData,
            token: refresh.token,
            token_expires_at: refresh.tokenExpiresAtIso,
          };
          vdbg("daily_token_refresh_success", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            sourceAction,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            durationMs,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: sourceAction,
            cached: false,
            handoff_used: false,
            attempt: 1,
            attempt_count: 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
          });
          return true;
        };

        if (
          adviseVideoDateTokenRecovery({
            trigger: "before_join",
            tokenExpiresAtIso: roomData.token_expires_at,
            platform: "web",
            surface: "video_date",
          }).action === "refresh_token"
        ) {
          const refreshedBeforeJoin = await refreshDailyTokenForJoin(
            "daily_token_refresh_before_join",
          );
          const refreshFailure = getLastDailyTokenRefreshFailure();
          if (!refreshedBeforeJoin && refreshFailure?.kind === "terminal") {
            releaseAppAcquiredMedia("daily_token_refresh_terminal_before_join");
            setIsConnecting(false);
            return {
              ok: false,
              failure: {
                kind: "SESSION_ENDED",
                retryable: false,
                serverCode: refreshFailure.error,
              },
            } as VideoCallStartResult;
          }
          if (!refreshedBeforeJoin && refreshFailure?.kind === "rate_limited") {
            releaseAppAcquiredMedia(
              "daily_token_refresh_rate_limited_before_join",
            );
            setIsConnecting(false);
            return {
              ok: false,
              failure: {
                kind: "DAILY_RATE_LIMIT",
                retryable: true,
                serverCode: refreshFailure.error,
              },
            } as VideoCallStartResult;
          }
        }

        roomNameRef.current = roomData.room_name;

        let captureProfileForCall = captureProfileRef.current;
        const singletonCall = userId
          ? consumeWebDailyCallSingleton({
              userId,
              nextSessionId: sessionId,
              nextRoomName: roomData.room_name,
            })
          : { ok: false as const, reason: "missing_user" };
        if (singletonCall.ok === true) {
          captureProfileForCall = singletonCall.entry.captureProfile;
          captureProfileRef.current = singletonCall.entry.captureProfile;
          setCaptureProfile(singletonCall.entry.captureProfile);
        }
        const singletonAlreadyJoined =
          singletonCall.ok === true &&
          singletonCall.meetingState === "joined-meeting";
        const singletonJoinInFlight =
          singletonCall.ok === true &&
          singletonCall.meetingState === "joining-meeting";
        let prewarmedCall = singletonCall.ok
          ? { ok: false as const, reason: "daily_call_singleton_reused" }
          : userId
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
            dailyCallSingletonReused: singletonCall.ok === true,
          });
        }
        if (
          singletonCall.ok === false &&
          prewarmedCall.ok === false &&
          !appAcquiredMediaRef.current &&
          typeof navigator !== "undefined" &&
          navigator.mediaDevices?.getUserMedia
        ) {
          let stream: MediaStream | null = null;
          let nextCaptureProfile: VideoDateWebMediaCaptureProfile =
            captureProfileForCall;
          try {
            for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
              try {
                stream = await navigator.mediaDevices.getUserMedia(
                  videoDateWebMediaStreamConstraints(profile),
                );
                nextCaptureProfile = profile;
                break;
              } catch (profileError) {
                if (
                  !isVideoDateCameraConstraintError(profileError) ||
                  profile === "fallback"
                ) {
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
                      ? {
                          name: profileError.name,
                          message: profileError.message,
                        }
                      : String(profileError),
                });
              }
            }
            if (stream) {
              let mediaTracks: LiveVideoDateMediaTracks;
              try {
                mediaTracks = requireLiveVideoDateMediaTracks(
                  stream,
                  "Video Date handoff capture",
                );
              } catch (error) {
                stopMediaStreamTracks(stream);
                stream = null;
                throw error;
              }
              const { videoTrack, audioTrack } = mediaTracks;
              const videoTrackSettings =
                summarizeVideoTrackSettings(videoTrack);
              captureProfileForCall = nextCaptureProfile;
              captureProfileRef.current = nextCaptureProfile;
              setCaptureProfile(nextCaptureProfile);
              appAcquiredMediaRef.current = {
                stream,
                captureProfile: nextCaptureProfile,
                acquiredAtMs: Date.now(),
                consumedByDaily: false,
              };
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  source_surface: "video_date_daily",
                  source_action: "daily_create_without_prewarm",
                  diagnostic_scope: "sender_capture",
                  capture_profile: nextCaptureProfile,
                  app_acquired_media: true,
                  media_handoff_miss_reason:
                    lastMediaHandoffMissReasonRef.current,
                  audio_track_present: Boolean(audioTrack),
                  video_track_present: Boolean(videoTrack),
                  video_track_width: videoTrackSettings?.width ?? null,
                  video_track_height: videoTrackSettings?.height ?? null,
                  video_track_aspect_ratio:
                    videoTrackSettings?.aspectRatio ?? null,
                  video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
                  video_track_facing_mode:
                    videoTrackSettings?.facingMode ?? null,
                  ...summarizeWebRuntime(),
                },
              );
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
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            });
          }
        }
        let prewarmAppAcquiredMedia =
          prewarmedCall.ok === true
            ? prewarmedCall.entry.appAcquiredMedia
            : null;
        const adoptPrewarmAppAcquiredMedia = () => {
          if (!prewarmAppAcquiredMedia) return;
          const existingMedia = appAcquiredMediaRef.current;
          if (
            existingMedia &&
            existingMedia.stream !== prewarmAppAcquiredMedia.stream
          ) {
            releaseAppAcquiredMedia(
              "prewarmed_app_acquired_media_replaced_route_media",
            );
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
        };
        adoptPrewarmAppAcquiredMedia();
        let prewarmedAlreadyJoined = false;
        let prewarmedJoinPromise: Promise<boolean> | null = null;
        const refreshPrewarmJoinState = () => {
          prewarmedAlreadyJoined =
            prewarmedCall.ok === true && prewarmedCall.entry.joined;
          prewarmedJoinPromise =
            prewarmedCall.ok === true ? prewarmedCall.entry.joinPromise : null;
          lastDailyPrewarmConsumedRef.current = prewarmedCall.ok === true;
          lastPrewarmedAlreadyJoinedRef.current =
            prewarmedAlreadyJoined || singletonAlreadyJoined;
          lastPrewarmedJoinInFlightRef.current =
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight;
        };
        refreshPrewarmJoinState();
        const acquiredMedia = appAcquiredMediaRef.current;
        const appAcquiredMediaForCall =
          acquiredMedia &&
          acquiredMedia.captureProfile === captureProfileForCall
            ? (getLiveVideoDateMediaTracks(acquiredMedia.stream) ?? undefined)
            : undefined;
        if (
          acquiredMedia &&
          acquiredMedia.captureProfile !== captureProfileForCall
        ) {
          releaseAppAcquiredMedia(
            "capture_profile_changed_before_daily_create",
          );
        } else if (acquiredMedia && !appAcquiredMediaForCall) {
          releaseAppAcquiredMedia("app_acquired_media_missing_required_track");
        }
        const hasAppAcquiredMediaTracks = Boolean(appAcquiredMediaForCall);
        let guardedCreateFailure:
          | "external_call_busy"
          | "cleanup_pending"
          | null = null;
        let guardedCreateMeetingState: string | null = null;
        const callObject =
          singletonCall.ok === true
            ? singletonCall.entry.call
            : prewarmedCall.ok === true
              ? prewarmedCall.entry.call
              : await (async () => {
                  const factoryOptions =
                    hasAppAcquiredMediaTracks && appAcquiredMediaForCall
                      ? dailyVideoDateCallObjectOptionsWithAppAcquiredMedia(
                          captureProfileForCall,
                          appAcquiredMediaForCall,
                        )
                      : dailyVideoDateCallObjectOptions(captureProfileForCall);
                  for (
                    let attempt = 1;
                    attempt <= WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS;
                    attempt += 1
                  ) {
                    const guarded = await createDailyCallObjectGuarded(
                      DailyIframe,
                      factoryOptions,
                      {
                        source: "video_date_start_call",
                        currentCallObject: callObjectRef.current,
                        waitForCleanup: true,
                        adoptMatchingExternalCall: true,
                        videoDateSessionId: sessionId,
                        videoDateRoomName: roomData.room_name,
                        onDiagnostic: (eventName, payload) => {
                          vdbg(eventName, {
                            sessionId,
                            eventId: truthRow.event_id ?? eventId,
                            userId,
                            roomName: roomData.room_name,
                            source: "video_date_start_call",
                            attempt,
                            ...payload,
                          });
                        },
                      },
                    );
                    if (guarded.ok === true) return guarded.call;
                    if (
                      guarded.reason === "external_call_busy" ||
                      guarded.reason === "cleanup_pending"
                    ) {
                      const recoveredPrewarm = userId
                        ? consumeWebVideoDateDailyPrewarm({
                            sessionId,
                            userId,
                            eventId: truthRow.event_id ?? eventId,
                            roomName: roomData.room_name,
                            roomUrl: roomData.room_url,
                            captureProfile: captureProfileForCall,
                          })
                        : { ok: false as const, reason: "missing_user" };
                      if (recoveredPrewarm.ok === true) {
                        prewarmedCall = recoveredPrewarm;
                        prewarmAppAcquiredMedia =
                          recoveredPrewarm.entry.appAcquiredMedia;
                        adoptPrewarmAppAcquiredMedia();
                        refreshPrewarmJoinState();
                        vdbg("daily_prewarm_reconsumed_after_guard_blocked", {
                          sessionId,
                          eventId: truthRow.event_id ?? eventId,
                          userId,
                          roomName: roomData.room_name,
                          guardReason: guarded.reason,
                          meetingState: guarded.meetingState ?? null,
                          attempt,
                          prewarmedAlreadyJoined,
                          prewarmedJoinInFlight: Boolean(
                            prewarmedJoinPromise && !prewarmedAlreadyJoined,
                          ),
                        });
                        return recoveredPrewarm.entry.call;
                      }
                      guardedCreateFailure = guarded.reason;
                      guardedCreateMeetingState = guarded.meetingState ?? null;
                      vdbg("daily_guard_create_blocked", {
                        sessionId,
                        eventId: truthRow.event_id ?? eventId,
                        userId,
                        roomName: roomData.room_name,
                        reason: guarded.reason,
                        meetingState: guarded.meetingState ?? null,
                        prewarmRecoveryReason: recoveredPrewarm.reason,
                        attempt,
                        maxAttempts:
                          WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
                      });
                      if (
                        attempt < WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS
                      ) {
                        void emitWebVideoDateClientStuckState({
                          sessionId,
                          eventName: "daily_call_busy_internal_retry",
                          dedupe: false,
                          payload: {
                            source_surface: "video_date_daily",
                            source_action: "daily_call_busy_internal_retry",
                            reason_code: guarded.reason,
                            room_name: roomData.room_name,
                            meeting_state: guarded.meetingState ?? undefined,
                            retryable: true,
                            attempt_count: attempt,
                          },
                        });
                        await sleep(
                          Math.min(
                            1_200,
                            WEB_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS *
                              attempt,
                          ),
                        );
                        continue;
                      }
                      return null;
                    }
                    throw guarded.error instanceof Error
                      ? guarded.error
                      : new Error("daily_create_failed");
                  }
                  return null;
                })();
        if (!callObject) {
          releaseAppAcquiredMedia("daily_guard_create_blocked");
          void emitWebVideoDateClientStuckState({
            sessionId,
            eventName: "daily_call_busy_exhausted",
            dedupe: false,
            payload: {
              source_surface: "video_date_daily",
              source_action: "daily_call_busy_exhausted",
              reason_code: guardedCreateFailure ?? "external_call_busy",
              room_name: roomData.room_name,
              meeting_state: guardedCreateMeetingState ?? undefined,
              retryable: true,
              attempt_count: WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
            },
          });
          setIsConnecting(false);
          setDailyMeetingState(null);
          setLocalInDailyRoom(false);
          return {
            ok: false,
            failure: {
              kind: "daily_call_busy",
              retryable: true,
              serverCode: guardedCreateFailure ?? "external_call_busy",
            },
          } as VideoCallStartResult;
        }
        if (singletonCall.ok === true) {
          const singletonAppAcquiredMedia =
            singletonCall.entry.appAcquiredMedia;
          if (
            appAcquiredMediaRef.current &&
            (!singletonAppAcquiredMedia ||
              appAcquiredMediaRef.current.stream !==
                singletonAppAcquiredMedia.stream)
          ) {
            releaseAppAcquiredMedia("singleton_call_reused");
          }
          if (singletonAppAcquiredMedia) {
            appAcquiredMediaRef.current = singletonAppAcquiredMedia;
          }
        } else if (
          prewarmedCall.ok === true &&
          appAcquiredMediaRef.current &&
          !prewarmAppAcquiredMedia
        ) {
          releaseAppAcquiredMedia("prewarmed_call_reused");
        } else if (hasAppAcquiredMediaTracks && appAcquiredMediaRef.current) {
          appAcquiredMediaRef.current.consumedByDaily = true;
          vdbg("daily_call_object_app_acquired_media_used", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            captureProfile: captureProfileForCall,
            audioTrackId: appAcquiredMediaForCall?.audioTrack?.id ?? null,
            videoTrackId: appAcquiredMediaForCall?.videoTrack?.id ?? null,
            videoTrack: summarizeVideoTrackSettings(
              appAcquiredMediaForCall?.videoTrack,
            ),
          });
        }
        dailyPrewarmConsumedForJoin = prewarmedCall.ok === true;
        callObjectRef.current = callObject;
        latchSameSessionDailyContinuity(
          sessionId,
          "daily_call_object_attached",
        );
        setDailyMeetingState(safeMeetingState(callObject) ?? "new");
        vdbg("daily_call_object_created", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          entryAttemptId,
          videoDateTraceId,
          reusedCallObject:
            singletonCall.ok === true || prewarmedCall.ok === true,
          dailyCallSingletonReused: singletonCall.ok === true,
          dailyCallSingletonPreviousSessionId:
            singletonCall.ok === true
              ? singletonCall.entry.previousSessionId
              : null,
          dailyCallSingletonParkingMode:
            singletonCall.ok === true ? singletonCall.entry.parkingMode : null,
          reusedJoinedCallObject:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          reusedJoinInFlight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          appAcquiredMediaUsed:
            singletonCall.ok === false &&
            hasAppAcquiredMediaTracks &&
            prewarmedCall.ok === false,
          prewarmFallbackReason:
            prewarmedCall.ok === false ? prewarmedCall.reason : null,
        });

        const getRemoteParticipantCount = () => {
          const activeCall = callObjectRef.current;
          if (!activeCall) return 0;
          try {
            return Object.values(activeCall.participants()).filter(
              (p) => !p.local,
            ).length;
          } catch {
            return 0;
          }
        };

        const getMeetingState = () => {
          const activeCall = callObjectRef.current as
            | (DailyCall & { meetingState?: () => unknown })
            | null;
          if (!activeCall || typeof activeCall.meetingState !== "function")
            return null;
          try {
            const state = activeCall.meetingState();
            return typeof state === "string" ? state : String(state);
          } catch {
            return null;
          }
        };

        const logTransportState = (
          message: string,
          extra?: Record<string, unknown>,
        ) => {
          vdbg(message, {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            localParticipantId:
              latestLocalParticipantRef.current?.session_id ?? null,
            entryAttemptId,
            videoDateTraceId,
            remoteParticipantCount: getRemoteParticipantCount(),
            dailyMeetingState: getMeetingState(),
            videoSessionState: optionsRef.current?.videoSessionState ?? null,
            localJoined: activeCallSessionIdRef.current === sessionId,
            localDecisionPersisted:
              optionsRef.current?.localDecisionPersisted ?? null,
            reconnectState: reconnectGraceActiveRef.current
              ? "interrupted"
              : "connected",
            ...extra,
          });
        };
        clearDailyEventListeners("before_bind_daily_listeners");
        const listenerGeneration = ++dailyListenerGenerationRef.current;
        const isCurrentDailyListener = () =>
          dailyListenerGenerationRef.current === listenerGeneration &&
          callObjectRef.current === callObject;
        const bindDailyEvent = <T extends DailyEvent>(
          eventName: T,
          handler: (event: DailyEventObject<T>) => void,
        ) => {
          callObject.on(eventName, handler);
          dailyEventListenerCleanupsRef.current.push(() => {
            callObject.off(eventName, handler);
          });
        };

        const syncReconnectOnce = async (reason: string) => {
          if (!isCurrentDailyListener()) return;
          if (reconnectSyncRequestedRef.current) return;
          reconnectSyncRequestedRef.current = true;
          const args = { p_session_id: sessionId, p_action: "sync_reconnect" };
          vdbg("video_date_transition_before", {
            action: "sync_reconnect",
            args,
            reason,
          });
          const { data, error } = await supabase.rpc(
            "video_date_transition",
            args,
          );
          const payload =
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : null;
          const failsoftRejected = payload?.success === false;
          const terminalSurvey =
            videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
          const terminalStop =
            terminalSurvey ||
            videoDateLifecycleRpcIndicatesTerminalStop(payload);
          vdbg("video_date_transition_after", {
            action: "sync_reconnect",
            ok: !error && !failsoftRejected,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
            reason,
          });
          if (terminalStop) {
            clearDailyAliveHeartbeatTimer("sync_reconnect_terminal_truth");
          }
          if (terminalSurvey) {
            optionsRef.current?.onTerminalSurveyTruth?.(
              "sync_reconnect_terminal_survey_truth",
            );
            return;
          }
          if (error || failsoftRejected) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_SYNC_RECONNECT_FAILED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
              code: error?.code ?? videoDateLifecycleRpcCode(payload),
              retryable: error
                ? true
                : videoDateLifecycleRpcRetryable(payload) === true,
            });
          }
        };

        const clearReconnectGrace = (reason: string, recovered: boolean) => {
          if (!isCurrentDailyListener()) return;
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
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_RECOVERED,
              {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                reason,
              },
            );
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
          if (!isCurrentDailyListener()) return;
          if (reconnectGraceActiveRef.current) {
            logTransportState("daily_transport_reconnecting", {
              reason,
              duplicate: true,
            });
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
          logTransportState("reconnect_grace_started", {
            reason,
            graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            reason,
          });
          optionsRef.current?.onPartnerTransientDisconnect?.();
          void syncReconnectOnce(reason);
          if (
            optionsRef.current?.dailyTokenRefreshV2 === true &&
            !reason.startsWith("daily_token") &&
            shouldRefreshDailyTokenBeforeReconnect(roomData.token_expires_at) &&
            !dailyTokenRecoveryInFlightRef.current
          ) {
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_before_expiry",
              new Error(`near_expiry_reconnect:${reason}`),
            );
          }

          reconnectGraceTickerRef.current = setInterval(() => {
            const next = remainingSeconds();
            setReconnectGraceTimeLeft(next);
            if (next <= 0) expireGrace();
          }, 1000);

          reconnectGraceTimeoutRef.current = setTimeout(
            expireGrace,
            DAILY_TRANSPORT_RECONNECT_GRACE_MS,
          );
        };

        const recoverTransport = (reason: string) => {
          if (!isCurrentDailyListener()) return;
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
            const returnArgs = {
              p_session_id: sessionId,
              p_action: "mark_reconnect_return",
            };
            vdbg("video_date_transition_before", {
              action: "mark_reconnect_return",
              args: returnArgs,
              reason,
            });
            void supabase
              .rpc("video_date_transition", returnArgs)
              .then(({ data, error }) => {
                const payload =
                  data && typeof data === "object" && !Array.isArray(data)
                    ? (data as Record<string, unknown>)
                    : null;
                const failsoftRejected = payload?.success === false;
                const terminalSurvey =
                  videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
                const terminalStop =
                  terminalSurvey ||
                  videoDateLifecycleRpcIndicatesTerminalStop(payload);
                vdbg("video_date_transition_after", {
                  action: "mark_reconnect_return",
                  ok: !error && !failsoftRejected,
                  payload: data ?? null,
                  error: error
                    ? { code: error.code, message: error.message }
                    : null,
                  reason,
                });
                if (terminalStop) {
                  clearDailyAliveHeartbeatTimer(
                    "mark_reconnect_return_terminal_truth",
                  );
                }
                if (terminalSurvey) {
                  optionsRef.current?.onTerminalSurveyTruth?.(
                    "mark_reconnect_return_terminal_survey_truth",
                  );
                }
              });
          }
          void syncReconnectOnce(`${reason}_recovered`);
        };

        const scheduleDailyTokenRefresh = (source: string) => {
          clearDailyTokenRefreshTimer();
          const tokenRecovery = adviseVideoDateTokenRecovery({
            trigger: "active_refresh_timer",
            tokenExpiresAtIso: roomData.token_expires_at,
            platform: "web",
            surface: "video_date",
          });
          const delayMs =
            tokenRecovery.action === "refresh_token"
              ? (tokenRecovery.retryAfterMs ?? 0)
              : null;
          if (delayMs == null) {
            vdbg("daily_token_refresh_schedule_skipped", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              source,
              reason: tokenRecovery.reason,
            });
            return;
          }
          vdbg("daily_token_refresh_scheduled", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            delayMs,
            source,
          });
          dailyTokenRefreshTimerRef.current = setTimeout(() => {
            dailyTokenRefreshTimerRef.current = null;
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_before_expiry",
            );
          }, delayMs);
        };

        const recoverDailyTokenAndRejoin = async (
          sourceAction: DailyTokenRefreshSourceAction,
          cause?: unknown,
        ): Promise<boolean> => {
          if (!isCurrentDailyListener()) return false;
          if (dailyTokenRecoveryInFlightRef.current) return false;
          const activeCall = callObjectRef.current;
          if (
            !activeCall ||
            activeCall !== callObject ||
            activeCallSessionIdRef.current !== sessionId
          ) {
            return false;
          }

          dailyTokenRecoveryInFlightRef.current = true;
          clearDailyTokenRefreshTimer();
          setIsConnecting(true);
          vdbg("daily_token_rejoin_start", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            sourceAction,
          });
          try {
            const refreshed = await refreshDailyTokenForJoin(
              sourceAction,
              cause,
            );
            if (!refreshed) {
              if (
                isCurrentDailyListener() &&
                callObjectRef.current === activeCall
              ) {
                setIsConnecting(false);
                const refreshFailure = getLastDailyTokenRefreshFailure();
                if (refreshFailure?.kind === "terminal") {
                  clearDailyTokenRefreshTimer();
                  setIsConnected(false);
                  setPeerMissing({ terminal: false });
                  logTransportState("daily_token_refresh_terminal_truth", {
                    sourceAction,
                    error: refreshFailure.error,
                    phase: refreshFailure.phase,
                  });
                  void cleanupCallObject(
                    "daily_token_refresh",
                    "daily_token_refresh_terminal",
                  );
                  void fetchVideoDateTruth(sessionId).then(({ truth }) => {
                    vdbg("daily_token_refresh_terminal_truth_refetched", {
                      sessionId,
                      eventId: truthRow.event_id ?? eventId,
                      userId,
                      sourceAction,
                      truth: truth ?? null,
                    });
                  });
                } else if (refreshFailure?.kind === "rate_limited") {
                  const retryAfterMs = refreshFailure.retryAfterMs ?? 30_000;
                  logTransportState("daily_token_refresh_rate_limited", {
                    sourceAction,
                    error: refreshFailure.error,
                    retryAfterMs,
                  });
                  dailyTokenRefreshTimerRef.current = setTimeout(() => {
                    dailyTokenRefreshTimerRef.current = null;
                    void recoverDailyTokenAndRejoin(sourceAction, cause);
                  }, retryAfterMs);
                  startReconnectGrace("daily_token_refresh_rate_limited");
                } else {
                  startReconnectGrace("daily_token_refresh_failed");
                }
              }
              return false;
            }
            if (
              !isCurrentDailyListener() ||
              callObjectRef.current !== activeCall
            ) {
              return false;
            }
            try {
              await activeCall.leave();
            } catch (leaveError) {
              vdbg("daily_token_rejoin_leave_failed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                sourceAction,
                error:
                  leaveError instanceof Error
                    ? { name: leaveError.name, message: leaveError.message }
                    : String(leaveError),
              });
            }
            setDailyMeetingState("joining-meeting");
            setLocalInDailyRoom(false);
            await activeCall.join({
              url: roomData.room_url,
              token: roomData.token,
            });
            activeCallSessionIdRef.current = sessionId;
            setDailyMeetingState(
              safeMeetingState(activeCall) ?? "joined-meeting",
            );
            setLocalInDailyRoom(true);
            setIsConnected(true);
            setIsConnecting(false);
            recoverTransport("daily_token_rejoin");
            scheduleDailyTokenRefresh("daily_token_rejoin_success");
            vdbg("daily_token_rejoin_success", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              sourceAction,
              tokenExpiresAt: roomData.token_expires_at ?? null,
            });
            return true;
          } catch (error) {
            vdbg("daily_token_rejoin_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              sourceAction,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: sourceAction,
              code: "daily_token_rejoin_failed",
              reason_code: "daily_token_rejoin_failed",
              failure_class: classifyDailyRoomTokenFailureClass("network"),
              retryable: true,
              attempt_count: 1,
            });
            if (isCurrentDailyListener()) {
              setIsConnecting(false);
              startReconnectGrace("daily_token_rejoin_failed");
            }
            return false;
          } finally {
            dailyTokenRecoveryInFlightRef.current = false;
          }
        };

        bindDailyEvent("participant-joined", (event) => {
          if (!isCurrentDailyListener()) return;
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
              trackEvent(
                LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                latencyPayload,
              );
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

        bindDailyEvent("participant-updated", (event) => {
          if (!isCurrentDailyListener()) return;
          if (!event?.participant) return;
          if (event.participant.local) {
            setDailyMeetingState(safeMeetingState(callObject));
            setLocalInDailyRoom(
              safeMeetingState(callObject) === "joined-meeting",
            );
            latestLocalParticipantRef.current = event.participant;
            const localKey = getTrackIdsKey(event.participant, false);
            const localKeyChanged = localKey !== lastLocalTrackIdsRef.current;
            if (localKeyChanged) {
              const newStream = buildStreamFromParticipant(event.participant, {
                includeAudio: false,
              });
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
            if (
              localVideoRef.current &&
              (localKeyChanged ||
                needsTrackReattach(
                  localVideoRef.current,
                  event.participant,
                  true,
                ))
            ) {
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
              trackEvent(
                LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                latencyPayload,
              );
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
            const remoteKeyChanged =
              remoteKey !== lastRemoteTrackIdsRef.current;
            let remoteRenderValidationSource = remoteKeyChanged
              ? "participant_updated_track_changed"
              : "participant_updated_same_track";
            const cameraSwitchRenderWatch =
              activeRemoteCameraSwitchRenderWatchRef.current;
            const cameraSwitchRenderWatchActive = Boolean(
              cameraSwitchRenderWatch &&
              cameraSwitchRenderWatch.expiresAtMs > Date.now(),
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
              needsTrackReattach(
                remoteVideoRef.current,
                event.participant,
                false,
              )
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
              !remoteKeyChanged &&
              remoteRenderValidationSource === "participant_updated_same_track";
            const useFreshFrameGuard =
              cameraSwitchRenderWatchActive || sameTrackCameraSwitchCandidate;
            const freshFrameGuardBaseline = useFreshFrameGuard
              ? readRemoteRenderFrameState(remoteVideoRef.current)
              : null;
            if (
              cameraSwitchRenderWatchActive &&
              !remoteKeyChanged &&
              remoteKey
            ) {
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
                cameraSwitchRenderWatchActive
                  ? "camera_switch_hint"
                  : remoteRenderValidationSource,
                useFreshFrameGuard
                  ? {
                      requireFreshFrame: true,
                      freshFrameBaseline: freshFrameGuardBaseline,
                      freshFrameTimeoutMs:
                        REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
                    }
                  : undefined,
              );
            }
          }
        });

        bindDailyEvent("participant-left", (event) => {
          if (!isCurrentDailyListener()) return;
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
            logTransportState(
              "daily_partner_left_deferred_until_transport_grace",
              {
                reason: "participant_left",
                graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS,
              },
            );
            if (reconnectGraceActiveRef.current) {
              logTransportState("daily_transport_reconnecting", {
                reason: "participant_left_during_grace",
              });
            }
          }
        });

        bindDailyEvent("error", (event) => {
          if (!isCurrentDailyListener()) return;
          setDailyMeetingState(safeMeetingState(callObject) ?? "error");
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
          if (isVideoDateDailyMeetingEnded(event)) {
            clearDailyTokenRefreshTimer();
            logTransportState("daily_meeting_ended_truth_refetch", {
              errorMsg: errorMsg ?? null,
            });
            void cleanupCallObject("daily_error", "daily_meeting_ended_event");
            void fetchVideoDateTruth(sessionId).then(({ truth, error }) => {
              vdbg("daily_meeting_ended_truth_refetched", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                truth: truth ?? null,
                error: error
                  ? { code: error.code, message: error.message }
                  : null,
              });
            });
            setIsConnecting(false);
            setIsConnected(false);
            return;
          }
          const sourceAction = (errorMsg ?? "").toLowerCase().includes("eject")
            ? "daily_token_refresh_after_ejection"
            : "daily_token_refresh_after_auth_error";
          if (
            adviseVideoDateTokenRecovery({
              trigger:
                sourceAction === "daily_token_refresh_after_ejection"
                  ? "ejection"
                  : "auth_error",
              error: event,
              platform: "web",
              surface: "video_date",
            }).action === "refresh_token"
          ) {
            void recoverDailyTokenAndRejoin(sourceAction, event);
            return;
          }
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

        bindDailyEvent("left-meeting", () => {
          if (!isCurrentDailyListener()) return;
          const ownerBeforeLeft = userId
            ? getVideoDateEntryOwner(sessionId, userId)
            : null;
          const providerSessionId = readDailyProviderSessionId(callObject);
          if (
            userId &&
            ownerBeforeLeft &&
            activeCallSessionIdRef.current === sessionId
          ) {
            updateVideoDateDailyOwnerState({
              sessionId,
              userId,
              ownerId: ownerBeforeLeft.ownerId,
              roomName: roomData.room_name,
              state: "lost",
              source: "daily_owner_provider_left_unexpected",
              entryAttemptId: ownerBeforeLeft.entryAttemptId ?? null,
              videoDateTraceId: ownerBeforeLeft.videoDateTraceId ?? null,
              providerSessionId,
            });
            void emitWebVideoDateClientStuckState({
              sessionId,
              eventName: "daily_owner_provider_left_unexpected",
              dedupe: false,
              payload: {
                source_surface: "video_date_daily",
                source_action: "daily_owner_provider_left_unexpected",
                room_name: roomData.room_name,
                owner_id: ownerBeforeLeft.ownerId,
                owner_state: ownerBeforeLeft.state,
                provider_session_id: providerSessionId ?? undefined,
              },
            });
          }
          setDailyMeetingState("left-meeting");
          setLocalInDailyRoom(false);
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

        bindDailyEvent(
          "network-connection",
          (event: { event?: string } | undefined) => {
            if (!isCurrentDailyListener()) return;
            if (event?.event === "interrupted") {
              logTransportState("daily_network_interrupted", {
                networkEvent: event.event,
              });
              startReconnectGrace("network_interrupted");
              return;
            }
            if (event?.event === "reconnecting") {
              startReconnectGrace("network_reconnecting");
              setDailyReconnectState("partner_reconnecting");
              logTransportState("daily_transport_reconnecting", {
                networkEvent: event.event,
              });
              return;
            }
            if (
              event?.event === "reconnected" ||
              event?.event === "connected"
            ) {
              recoverTransport(`network_${event.event}`);
            }
          },
        );

        bindDailyEvent("nonfatal-error", (event) => {
          if (!isCurrentDailyListener()) return;
          logTransportState("daily_nonfatal_error", {
            event:
              event && typeof event === "object"
                ? JSON.parse(JSON.stringify(event))
                : String(event),
          });
          if (
            adviseVideoDateTokenRecovery({
              trigger: "auth_error",
              error: event,
              platform: "web",
              surface: "video_date",
            }).action === "refresh_token"
          ) {
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_after_auth_error",
              event,
            );
          }
        });

        bindDailyEvent("app-message", (event) => {
          if (!isCurrentDailyListener()) return;
          const hint = parseVideoDateCameraSwitchRenderHint(
            event && typeof event === "object" && "data" in event
              ? (event as { data?: unknown }).data
              : undefined,
          );
          logTransportState("daily_app_message", {
            hasData: Boolean(
              event && typeof event === "object" && "data" in (event as object),
            ),
            isCameraSwitchRenderHint: Boolean(hint),
          });
          if (!hint) return;

          const fromId =
            event && typeof event === "object" && "fromId" in event
              ? String((event as { fromId?: unknown }).fromId ?? "")
              : "";
          const localSessionId =
            latestLocalParticipantRef.current?.session_id ??
            callObject.participants().local?.session_id ??
            "";
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
          const isNewCameraSwitchHint =
            lastRemoteCameraSwitchHintIdRef.current !== hint.switchId;
          const freshFrameBaseline = readRemoteRenderFrameState(
            remoteVideoRef.current,
          );
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
            },
          );
        });

        bindDailyEvent(
          "network-quality-change",
          (event: { threshold?: string; quality?: number }) => {
            if (!isCurrentDailyListener()) return;
            setNetworkTier(tierFromNetworkQualityEvent(event));
          },
        );

        bindDailyEvent("camera-error", (event) => {
          if (!isCurrentDailyListener()) return;
          const rawErrorMsg =
            event && typeof event === "object" && "errorMsg" in event
              ? (event as { errorMsg?: unknown }).errorMsg
              : undefined;
          const errorMsg =
            typeof rawErrorMsg === "string"
              ? rawErrorMsg
              : rawErrorMsg &&
                  typeof rawErrorMsg === "object" &&
                  "errorMsg" in rawErrorMsg
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
          void classifyMediaPermissionErrorWithBrowserState(
            rawError ??
              new Error(
                errorMsg ?? "Camera or microphone permission was denied.",
              ),
            "camera_microphone",
          ).then(setMediaPermissionResult);
          setMediaPermissionError(
            errorMsg ?? "Camera or microphone permission was denied.",
          );
          trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
          });
          Sentry.captureMessage("daily_camera_error", {
            level: "error",
            extra: {
              errorName:
                rawError && typeof rawError === "object" && "name" in rawError
                  ? String((rawError as { name?: unknown }).name ?? "")
                  : null,
              errorMessage: errorMsg ?? null,
              meetingState: safeMeetingState(callObject),
              sessionId,
              eventId: truthRow.event_id ?? eventId ?? null,
            },
          });
        });

        bindDailyEvent("track-stopped", (event) => {
          if (!isCurrentDailyListener()) return;
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
        latchSameSessionDailyContinuity(sessionId, "daily_join_started");
        const dailyCallInstanceId = `${entryAttemptId ?? sessionId}:${startAttemptNonceRef.current}`;
        const entryOwner = userId
          ? getVideoDateEntryOwner(sessionId, userId)
          : null;
        if (userId) {
          updateVideoDateEntryOwnerState({
            sessionId,
            userId,
            ownerId: entryOwner?.ownerId ?? null,
            state: "joining",
            source: "daily_join_started",
            roomName: roomData.room_name,
            entryAttemptId:
              entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
            videoDateTraceId:
              videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            callInstanceId: dailyCallInstanceId,
          });
          updateVideoDateDailyOwnerState({
            sessionId,
            userId,
            ownerId: entryOwner?.ownerId ?? null,
            roomName: roomData.room_name,
            state: "joining",
            source: "daily_join_started",
            entryAttemptId:
              entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
            videoDateTraceId:
              videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            callInstanceId: dailyCallInstanceId,
          });
        }
        const prepareToJoinStartMs = Math.max(
          0,
          dailyJoinStartedAtMs - roomResult.cacheEntry.prepareFinishedAtMs,
        );
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
            sourceAction: opts?.internalRetry
              ? "daily_join_retry_started"
              : "daily_join_started",
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
          source_action: opts?.internalRetry
            ? "daily_join_retry_started"
            : "daily_join_started",
          capture_profile: captureProfileForCall,
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          cached_prepare_entry: roomResult.cached,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          media_handoff_used: lastMediaHandoffUsedRef.current,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          daily_prewarm_consumed: prewarmedCall.ok === true,
          prewarmed_join_in_flight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          prewarmed_already_joined:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          daily_call_singleton_reused: singletonCall.ok === true,
          provider_verify_skipped: roomData.provider_verify_skipped ?? null,
        });
        if (singletonAlreadyJoined) {
          vdbg("daily_join_skipped_singleton_already_joined", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            parkingMode:
              singletonCall.ok === true
                ? singletonCall.entry.parkingMode
                : null,
          });
        } else if (singletonJoinInFlight) {
          const singletonJoinOk = await waitForDailyMeetingState(
            callObject,
            "joined-meeting",
            WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_MS,
          );
          if (!singletonJoinOk)
            throw new Error("daily_singleton_join_wait_failed");
          vdbg("daily_join_completed_by_singleton_inflight", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            parkingMode:
              singletonCall.ok === true
                ? singletonCall.entry.parkingMode
                : null,
          });
        } else if (prewarmedAlreadyJoined) {
          vdbg("daily_join_skipped_prewarmed_already_joined", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource:
              prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else if (prewarmedJoinPromise) {
          const prewarmedJoinOk = await prewarmedJoinPromise;
          if (!prewarmedJoinOk) throw new Error("daily_prewarm_join_failed");
          vdbg("daily_join_completed_by_prewarm_inflight", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource:
              prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else {
          setDailyMeetingState("joining-meeting");
          try {
            await callObject.join({
              url: roomData.room_url,
              token: roomData.token,
            });
          } catch (joinError) {
            if (
              adviseVideoDateTokenRecovery({
                trigger: "auth_error",
                error: joinError,
                platform: "web",
                surface: "video_date",
              }).action === "refresh_token"
            ) {
              const refreshed = await refreshDailyTokenForJoin(
                "daily_token_refresh_join_retry",
                joinError,
              );
              if (refreshed) {
                await callObject.join({
                  url: roomData.room_url,
                  token: roomData.token,
                });
              } else {
                throw joinError;
              }
            } else {
              throw joinError;
            }
          }
        }
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        setHasPermission(true);
        activeCallSessionIdRef.current = sessionId;
        activeDailyCallIdentityRef.current = userId
          ? {
              sessionId,
              userId,
              ownerId: entryOwner?.ownerId ?? null,
              callInstanceId: dailyCallInstanceId,
              entryAttemptId:
                entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
              videoDateTraceId:
                videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            }
          : null;
        latchSameSessionDailyContinuity(sessionId, "daily_join_success");
        setDailyMeetingState(safeMeetingState(callObject) ?? "joined-meeting");
        setLocalInDailyRoom(true);
        scheduleDailyTokenRefresh("daily_join_success");
        if (userId) {
          startDailyAliveHeartbeat({
            sessionId,
            userId,
            roomName: roomData.room_name,
            entryAttemptId,
            videoDateTraceId,
            callInstanceId: dailyCallInstanceId,
            source: "daily_join_success",
          });
        }
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          joinDurationMs,
          entryAttemptId,
          videoDateTraceId,
          callInstanceId: dailyCallInstanceId,
        });
        const joinSuccessLatencyContext =
          recordReadyGateToDateLatencyCheckpoint({
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
          durationMs:
            joinSuccessLatencyContext.readyGateOpenedAtMs == null
              ? joinDurationMs
              : undefined,
          attemptCount: opts?.internalRetry ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          joinSuccessPayload,
        );
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_COMPLETED,
          joinSuccessPayload,
        );
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
          media_handoff_used: lastMediaHandoffUsedRef.current,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          daily_prewarm_consumed: prewarmedCall.ok === true,
          prewarmed_join_in_flight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          prewarmed_already_joined:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          daily_call_singleton_reused: singletonCall.ok === true,
          provider_verify_skipped: roomData.provider_verify_skipped ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOINED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          capture_profile: captureProfileForCall,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          media_handoff_used: lastMediaHandoffUsedRef.current,
          daily_prewarm_consumed: prewarmedCall.ok === true,
        });

        const buildProviderBackedDailyJoinedArgs = () => {
          const providerSessionId = readDailyProviderSessionId(callObject);
          const meetingState = safeMeetingState(callObject);
          const providerBackedJoined =
            meetingState === "joined-meeting" && Boolean(providerSessionId);
          const entryOwner = userId
            ? getVideoDateEntryOwner(sessionId, userId)
            : null;
          const ownerState = providerBackedJoined
            ? "joined"
            : meetingState === "left-meeting" || meetingState === "error"
              ? "lost"
              : "joining";
          return {
            providerBackedJoined,
            providerSessionId,
            meetingState,
            ownerId: entryOwner?.ownerId ?? null,
            ownerState,
            args: {
              p_session_id: sessionId,
              p_owner_id: entryOwner?.ownerId ?? null,
              p_call_instance_id: dailyCallInstanceId,
              p_provider_session_id: providerSessionId,
              p_entry_attempt_id:
                entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
              p_owner_state: ownerState,
            },
          };
        };
        const initialJoinedProof = buildProviderBackedDailyJoinedArgs();
        vdbg("mark_video_date_daily_joined_before", {
          args: initialJoinedProof.args,
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          providerBackedJoined: initialJoinedProof.providerBackedJoined,
          providerSessionId: initialJoinedProof.providerSessionId,
          meetingState: initialJoinedProof.meetingState,
          ownerId: initialJoinedProof.ownerId,
          ownerState: initialJoinedProof.ownerState,
        });
        void markDailyJoinedWithBackoff({
          sleep,
          confirm: async (attempt) => {
            const joinedProof = buildProviderBackedDailyJoinedArgs();
            if (!joinedProof.providerBackedJoined) {
              const retryable = joinedProof.ownerState !== "lost";
              const payload = {
                ok: false,
                error: "provider_presence_missing",
                retryable,
                provider_presence_required: true,
                provider_backed_current: false,
                provider_session_id: joinedProof.providerSessionId,
                owner_id: joinedProof.ownerId,
                owner_state: joinedProof.ownerState,
                meeting_state: joinedProof.meetingState,
              };
              vdbg("mark_video_date_daily_joined_after", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                attempt,
                ok: false,
                payload,
                error: null,
              });
              return {
                ok: false,
                code: "provider_presence_missing",
                retryable,
                payload,
              };
            }
            const { data: joinedData, error: joinedError } = await supabase.rpc(
              "mark_video_date_daily_joined",
              joinedProof.args,
            );
            const payload =
              joinedData &&
              typeof joinedData === "object" &&
              !Array.isArray(joinedData)
                ? (joinedData as Record<string, unknown>)
                : null;
            const ok = !joinedError && payload?.ok === true;
            const code =
              joinedError?.code ?? videoDateLifecycleRpcCode(payload) ?? null;
            const terminalSurvey =
              videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
            const terminalStop =
              terminalSurvey ||
              videoDateLifecycleRpcIndicatesTerminalStop(payload);
            vdbg("mark_video_date_daily_joined_after", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              attempt,
              ok,
              payload: joinedData ?? null,
              error: joinedError
                ? { code: joinedError.code, message: joinedError.message }
                : null,
              providerBackedJoined: joinedProof.providerBackedJoined,
              providerSessionId: joinedProof.providerSessionId,
              meetingState: joinedProof.meetingState,
              ownerId: joinedProof.ownerId,
              ownerState: joinedProof.ownerState,
            });
            if (terminalStop) {
              clearDailyAliveHeartbeatTimer("daily_joined_terminal_truth");
            }
            if (terminalSurvey) {
              optionsRef.current?.onTerminalSurveyTruth?.(
                "daily_joined_terminal_survey_truth",
              );
            }
            return {
              ok,
              code,
              retryable: joinedError
                ? true
                : videoDateLifecycleRpcRetryable(payload),
              error: joinedError ?? undefined,
              payload: joinedData ?? null,
            };
          },
          onAttemptResult: ({ attempt, ok, code, retryable, willRetry }) => {
            if (!ok && attempt === 1) {
              trackEvent(
                LobbyPostDateEvents.MARK_VIDEO_DATE_DAILY_JOINED_FAILED,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  code,
                  retryable,
                  will_retry: willRetry,
                  entry_attempt_id: entryAttemptId,
                  video_date_trace_id: videoDateTraceId,
                },
              );
              toast.info("Keeping your date state in sync...", {
                duration: 3000,
              });
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
            const newStream = buildStreamFromParticipant(localParticipant, {
              includeAudio: false,
            });
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
        const remoteParticipants = Object.values(participants).filter(
          (p) => !p.local,
        );
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
            trackEvent(
              LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
              latencyPayload,
            );
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
            truthRefreshCount: peerMissingTruthRefreshCountRef.current,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_WAIT_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            timeout_ms: FIRST_REMOTE_TIMEOUT_MS,
            truth_refresh_count: peerMissingTruthRefreshCountRef.current,
          });
          firstRemoteWatchdogRef.current = setTimeout(() => {
            firstRemoteWatchdogRef.current = null;
            if (
              startAttemptNonceRef.current !== startNonce ||
              !callObjectRef.current ||
              firstRemoteObservedRef.current
            ) {
              return;
            }
            peerMissingTruthRefreshCountRef.current += 1;
            const truthRefreshAttempt = peerMissingTruthRefreshCountRef.current;
            vdbg("daily_no_remote_watchdog_timeout", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              truthRefreshAttempt,
            });
            void fetchVideoDateTruth(sessionId).then(({ truth, error }) => {
              if (
                startAttemptNonceRef.current !== startNonce ||
                !callObjectRef.current ||
                firstRemoteObservedRef.current
              ) {
                return;
              }
              vdbg("daily_no_remote_watchdog_truth_refetched", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                truth: truth ?? null,
                error: error
                  ? { code: error.code, message: error.message }
                  : null,
                truthRefreshAttempt,
              });
              const hasTerminalSurveyTruth =
                videoSessionHasPostDateSurveyTruth(truth);
              const hasHistoricalRemoteSeenTruth =
                videoSessionHasEncounterExposureTruth(truth);
              if (hasTerminalSurveyTruth) {
                setPeerMissing({ terminal: false });
                setIsConnected(false);
                setIsConnecting(false);
                vdbg("daily_no_remote_watchdog_terminal_suppressed", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  suppressedEventName: "peer_missing_suppressed_survey_truth",
                  hasTerminalSurveyTruth,
                  hasHistoricalRemoteSeenTruth,
                  truthRefreshAttempt,
                });
                void emitWebVideoDateClientStuckState({
                  sessionId,
                  eventName: "peer_missing_suppressed_survey_truth",
                  latencyMs: FIRST_REMOTE_TIMEOUT_MS,
                  payload: {
                    source_surface: "video_date_daily",
                    source_action: "first_remote_watchdog",
                    reason_code: "survey_required_truth",
                    watchdog_ms: FIRST_REMOTE_TIMEOUT_MS,
                    truth_refresh_attempt: truthRefreshAttempt,
                    historical_remote_seen_truth: hasHistoricalRemoteSeenTruth,
                  },
                });
                optionsRef.current?.onTerminalSurveyTruth?.(
                  "peer_missing_watchdog_survey_truth",
                );
                return;
              }
              if (hasHistoricalRemoteSeenTruth) {
                setPeerMissing({ terminal: false });
                setIsConnecting(false);
                vdbg("daily_no_remote_watchdog_historical_truth_suppressed", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  truthRefreshAttempt,
                });
                void emitWebVideoDateClientStuckState({
                  sessionId,
                  eventName: "peer_missing_suppressed_remote_seen",
                  latencyMs: FIRST_REMOTE_TIMEOUT_MS,
                  payload: {
                    source_surface: "video_date_daily",
                    source_action: "first_remote_watchdog",
                    reason_code: "historical_remote_seen_truth",
                    watchdog_ms: FIRST_REMOTE_TIMEOUT_MS,
                    truth_refresh_attempt: truthRefreshAttempt,
                    historical_remote_seen_truth: true,
                  },
                });
                toast.info("Keeping your date in sync...");
                return;
              }
              setIsConnecting(false);
              setIsConnected(false);
              setPeerMissing({ terminal: true });
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  truth_refresh_attempt: truthRefreshAttempt,
                },
              );
              void emitWebVideoDateClientStuckState({
                sessionId,
                eventName: "peer_missing_terminal",
                latencyMs: FIRST_REMOTE_TIMEOUT_MS,
                payload: {
                  source_surface: "video_date_daily",
                  source_action: "first_remote_watchdog",
                  reason_code: "peer_missing_timeout",
                  watchdog_ms: FIRST_REMOTE_TIMEOUT_MS,
                  truth_refresh_attempt: truthRefreshAttempt,
                  historical_remote_seen_truth: hasHistoricalRemoteSeenTruth,
                },
              });
              toast.info(
                "They're not in the room yet. We'll keep this gentle.",
              );
            });
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
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          entryAttemptId: preparedEntryAtFailure?.entryAttemptId ?? null,
          videoDateTraceId:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            preparedEntryAtFailure?.entryAttemptId ??
            null,
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
          video_date_trace_id:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            preparedEntryAtFailure?.entryAttemptId ??
            null,
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
          rejectPreparedVideoDateEntry(
            sessionId,
            userId,
            "daily_join_failed",
            eventId,
          );
          vdbg("daily_join_failure_prepare_retry", {
            sessionId,
            eventId,
            userId,
            roomName: preparedEntryAtFailure.value.room_name,
            reason: "prepared_token_rejected_before_retry",
          });
          return await startCall(sessionId, {
            internalRetry: true,
            mediaPromptIntent,
            skipStartGate: true,
          });
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
      clearSameSessionDailyContinuity,
      cleanupCallObject,
      clearDailyAliveHeartbeatTimer,
      clearDailyEventListeners,
      clearDailyTokenRefreshTimer,
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      fetchVideoDateTruth,
      latchSameSessionDailyContinuity,
      logTrackMounted,
      needsTrackReattach,
      preflightMediaPermission,
      releaseAppAcquiredMedia,
      resetRemoteRenderRecoveryAttempts,
      resetRemoteRenderRecoveryForParticipant,
      scheduleRemoteRenderValidation,
      startDailyAliveHeartbeat,
      clearRemoteRenderValidation,
      waitForInFlightStartCall,
    ],
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      const localParticipant = latestLocalParticipantRef.current;
      const remoteParticipant = latestRemoteParticipantRef.current;

      if (
        localVideoRef.current &&
        needsTrackReattach(localVideoRef.current, localParticipant, true)
      ) {
        attachTracks(localParticipant, localVideoRef.current, true);
        logTrackMounted("maintenance_reattach", {
          isLocal: true,
          participant: localParticipant,
          roomName: roomNameRef.current,
        });
      }

      if (
        remoteVideoRef.current &&
        needsTrackReattach(remoteVideoRef.current, remoteParticipant, false)
      ) {
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
    setMediaPermissionResult(null);
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
      activeDailyCallIdentityRef.current = null;

      optionsRef.current?.onCallEnded?.();
    },
    [cleanupCallObject],
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
      if (
        !co ||
        (typeof co.cycleCamera !== "function" &&
          typeof co.setInputDevicesAsync !== "function")
      ) {
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      try {
        const devices = await enumerateWebVideoDevices(co);
        if (!cancelled) setCanFlipCamera(!isVideoOff && devices.length > 1);
      } catch {
        if (!cancelled)
          setCanFlipCamera(!isVideoOff && typeof co.cycleCamera === "function");
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [isConnected, isVideoOff, localStream]);

  const flipCamera = useCallback(async () => {
    const co = callObjectRef.current;
    if (
      !co ||
      isFlippingCamera ||
      cameraSwitchInFlightRef.current ||
      isVideoOff
    )
      return;
    if (
      typeof co.cycleCamera !== "function" &&
      typeof co.setInputDevicesAsync !== "function"
    ) {
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
        commit = await switchToDeterministicWebCamera(
          co,
          before,
          desiredFacing,
          {
            forceVideoSourceRefresh,
          },
        );
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
        const result = await co.cycleCamera({
          preferDifferentFacingMode: true,
        });
        const resultDevice = result?.device as
          | WebCameraDevice
          | null
          | undefined;
        commit = await waitForLocalCameraSwitchCommit(
          co,
          before,
          "cycle_camera",
          {
            expectedDeviceId: getDeviceId(resultDevice),
            expectedFacing: getDeviceFacingMode(resultDevice) ?? desiredFacing,
          },
        );
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

  const cleanupCallObjectRef = useRef(cleanupCallObject);
  useEffect(() => {
    cleanupCallObjectRef.current = cleanupCallObject;
  }, [cleanupCallObject]);

  useEffect(() => {
    return () => {
      void cleanupCallObjectRef.current(
        "useVideoCall.unmount",
        "component_unmount",
      );
    };
  }, []);

  /** Stable getter for the canonical room name after startCall succeeds. */
  const getRoomName = useCallback(() => roomNameRef.current, []);

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    mediaPermissionError,
    mediaPermissionResult,
    networkTier,
    remotePlayback,
    peerMissing,
    dailyReconnectState,
    dailyMeetingState,
    localInDailyRoom,
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
