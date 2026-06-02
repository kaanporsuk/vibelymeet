/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { dailyCallObjectOptions } from "@/lib/dailyCallObjectConfig";
import {
  MATCH_CALL_EDGE_CODES,
  messageForMatchCallEdgeCode,
  parseMatchCallEdgeCode,
} from "@clientShared/chat/matchCallEdgeCodes";
import { logMatchCallDiag } from "@clientShared/chat/matchCallDiag";
import { IncomingCallOverlay } from "@/components/chat/IncomingCallOverlay";
import { ActiveCallOverlay } from "@/components/chat/ActiveCallOverlay";
import { fetchUserProfile } from "@/services/fetchUserProfile";
import {
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionMessage,
  mediaPermissionResultForStatus,
  mediaPermissionTitle,
  type MediaPermissionResult,
} from "@clientShared/media/mediaPermissionResult";

type DailyIframeModule = typeof import("@daily-co/daily-js").default;

let dailyIframeLoader: Promise<DailyIframeModule> | null = null;

function loadDailyIframe(): Promise<DailyIframeModule> {
  dailyIframeLoader ??= import("@daily-co/daily-js").then((mod) => mod.default);
  return dailyIframeLoader;
}

type MatchCallStatus = "ringing" | "active" | "ended" | "missed" | "declined";
type MatchCallType = "voice" | "video";
type MatchCallPhase = "idle" | "ringing" | "in_call";
type MatchCallAction =
  | "answer"
  | "decline"
  | "end"
  | "mark_missed"
  | "heartbeat"
  | "joined"
  | "join_failed";

/**
 * Reasons recognized by the backend match_call_transition RPC for terminal transitions.
 * Mirrors the CHECK constraint on match_calls.ended_reason — keep these in sync with
 * supabase/migrations/20260511120000_match_call_end_reasons.sql.
 */
type MatchCallEndReason =
  | "declined"
  | "hangup"
  | "caller_cancelled"
  | "missed"
  | "timeout"
  | "join_failed"
  | "stale_active"
  | "provider_error"
  | "blocked_pair"
  | "unmatched_pair"
  | "busy"
  | "connection_lost"
  | "media_failure";

/** Daily participant track lifecycle. We use it to render rich button states. */
type MediaTrackStatus =
  | "off"
  | "blocked"
  | "loading"
  | "interrupted"
  | "playable"
  | "playing"
  | "sendable"
  | "receivable";

/** Caller-friendly description of why a call ended; used to render the terminal banner. */
export type LastCallOutcome = {
  callId: string;
  reason: MatchCallEndReason;
  endedByMe: boolean;
  endedByPartner: boolean;
  partnerName: string;
  callType: MatchCallType;
  /** Local user's role in the call. Lets us pick "Missed call" vs "Call canceled" copy. */
  role: "caller" | "callee";
};

const MATCH_CALL_HEARTBEAT_MS = 15_000;
const MATCH_CALL_REMOTE_RECONNECT_GRACE_MS = 30_000;
/** How long the terminal banner stays on screen after a call ends. */
const MATCH_CALL_OUTCOME_LINGER_MS = 5_000;
const MATCH_CALL_CAMERA_SWITCH_COMMIT_TIMEOUT_MS = 1_800;
const MATCH_CALL_CAMERA_SWITCH_COMMIT_POLL_MS = 80;

type MatchCallCleanupOptions = {
  deleteRoomName?: string | null;
  skipRoomDelete?: boolean;
  /** When true, `match_call_transition` was already applied (or DB row is already terminal). */
  skipServerTransition?: boolean;
  /** When true, only release the Daily SDK object and preserve the active call flow state. */
  preserveCallState?: boolean;
};

type WebCameraFacingMode = "user" | "environment";
type WebCameraDevice = MediaDeviceInfo & {
  facing?: unknown;
  facingMode?: unknown;
};
type LocalCameraSnapshot = {
  trackId: string | null;
  deviceId: string | null;
  facingMode: WebCameraFacingMode | null;
  readyState: string | null;
  enabled: boolean | null;
};
type WebCameraSwitchCommitMethod = "set_input_device" | "cycle_camera";
type WebCameraSwitchCommit = LocalCameraSnapshot & {
  method: WebCameraSwitchCommitMethod;
  latencyMs: number;
};

function resolveAbnormalTransitionForTeardown(
  callId: string,
  incoming: { callId: string } | null,
  phase: MatchCallPhase,
): MatchCallAction | null {
  if (incoming?.callId === callId) {
    return "mark_missed";
  }
  if (phase === "ringing" || phase === "in_call") {
    return "end";
  }
  return null;
}

function postMatchCallTransitionKeepalive(
  callId: string,
  action: MatchCallAction,
  accessToken: string,
) {
  void fetch(`${SUPABASE_URL}/rest/v1/rpc/match_call_transition`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ p_call_id: callId, p_action: action }),
    keepalive: true,
  }).catch(() => {});
}

interface UseMatchCallOptions {
  matchId: string | null;
  partnerUserId?: string | null;
  partnerName?: string | null;
  partnerAvatar?: string | null;
  onCallEnded?: () => void;
}

type MatchCallRow = {
  id: string;
  match_id: string;
  caller_id: string;
  callee_id: string;
  call_type: string;
  daily_room_name: string;
  daily_room_url: string;
  status: MatchCallStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  ended_reason?: MatchCallEndReason | null;
  ended_by_user_id?: string | null;
};

type MatchCallTransitionResult = {
  ok?: boolean;
  code?: string;
  status?: MatchCallStatus;
  started_at?: string;
  ended_at?: string;
  idempotent?: boolean;
};

type MatchCallRealtimeChannel = {
  on: (
    type: "postgres_changes",
    filter: {
      event: "INSERT" | "UPDATE";
      schema: "public";
      table: "match_calls";
      filter: string;
    },
    callback: (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => void,
  ) => MatchCallRealtimeChannel;
  subscribe: () => unknown;
};

type PartnerSummary = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
};

export interface IncomingCallData {
  callId: string;
  matchId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  callType: MatchCallType;
}

type StartCallParams = {
  matchId: string;
  type: MatchCallType;
  partnerUserId?: string | null;
  partnerName?: string | null;
  partnerAvatar?: string | null;
};

type MatchCallPermissionRecovery =
  | { kind: "start"; params: StartCallParams; result: MediaPermissionResult }
  | { kind: "answer"; callId: string; callType: MatchCallType; result: MediaPermissionResult }
  | { kind: "active_rejoin"; row: MatchCallRow; callType: MatchCallType; result: MediaPermissionResult };

type MatchCallContextValue = {
  isInCall: boolean;
  isRinging: boolean;
  isReconnecting: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  /** Daily participant audio.state — lets the UI distinguish muted vs blocked vs loading. */
  audioStatus: MediaTrackStatus;
  videoStatus: MediaTrackStatus;
  /** Set briefly after toggleMute / toggleVideo to disable buttons until Daily confirms. */
  isAudioTogglePending: boolean;
  isVideoTogglePending: boolean;
  callType: MatchCallType;
  callDuration: number;
  incomingCall: IncomingCallData | null;
  /** Most-recent terminal outcome; cleared after MATCH_CALL_OUTCOME_LINGER_MS so the banner can show *why* the call ended. */
  lastOutcome: LastCallOutcome | null;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  activeMatchId: string | null;
  /** True when ≥2 video input devices are detected and the call is a video call. */
  canFlipCamera: boolean;
  isFlippingCamera: boolean;
  startCall: (params: StartCallParams) => Promise<void>;
  answerCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  markIncomingCallMissed: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  flipCamera: () => Promise<void>;
};

const MatchCallContext = createContext<MatchCallContextValue | null>(null);

const DEFAULT_PARTNER: PartnerSummary = {
  userId: null,
  name: "Your match",
  avatarUrl: null,
};

function normalizeCallType(value: string | null | undefined): MatchCallType {
  return value === "voice" ? "voice" : "video";
}

function secondsSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const startedAtMs = new Date(iso).getTime();
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function sleepMatchCallCameraSwitch(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWebMatchCallMediaPermission(type: MatchCallType): Promise<MediaPermissionResult | null> {
  const kind = type === "video" ? "camera_microphone" : "microphone";
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return mediaPermissionResultForStatus({
      status: "unsupported",
      kind,
      permissionState: "unsupported",
      rawErrorName: "getUserMedia_missing",
      rawErrorMessage: "Browser media capture is unavailable.",
    });
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video" ? { facingMode: "user" } : false,
    });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    return classifyMediaPermissionErrorWithBrowserState(error, kind);
  }
}

function normalizeWebCameraFacingMode(value: unknown): WebCameraFacingMode | null {
  return value === "user" || value === "environment" ? value : null;
}

function oppositeWebCameraFacingMode(value: WebCameraFacingMode | null): WebCameraFacingMode | null {
  if (value === "user") return "environment";
  if (value === "environment") return "user";
  return null;
}

function inferWebCameraFacingModeFromLabel(label: unknown): WebCameraFacingMode | null {
  if (typeof label !== "string") return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return "user";
  if (/\b(back|rear|environment|world)\b/.test(normalized)) return "environment";
  return null;
}

function getWebDeviceId(device: WebCameraDevice | null | undefined): string | null {
  return typeof device?.deviceId === "string" && device.deviceId ? device.deviceId : null;
}

function getWebDeviceFacingMode(device: WebCameraDevice | null | undefined): WebCameraFacingMode | null {
  if (!device) return null;
  return (
    normalizeWebCameraFacingMode(device.facingMode) ??
    normalizeWebCameraFacingMode(device.facing) ??
    inferWebCameraFacingModeFromLabel(device.label)
  );
}

function getTrackDeviceId(track: MediaStreamTrack | null | undefined): string | null {
  const settings = track?.getSettings?.();
  return typeof settings?.deviceId === "string" && settings.deviceId ? settings.deviceId : null;
}

function getTrackFacingMode(track: MediaStreamTrack | null | undefined): WebCameraFacingMode | null {
  const settings = track?.getSettings?.();
  return normalizeWebCameraFacingMode(settings?.facingMode) ?? inferWebCameraFacingModeFromLabel(track?.label);
}

function getLocalVideoTrack(participant: DailyParticipant | undefined): MediaStreamTrack | null {
  const videoState = participant?.tracks?.video?.state;
  if (videoState === "off" || videoState === "blocked") return null;
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
  const callWithDevices = call as DailyCall & {
    enumerateDevices?: () => Promise<{ devices?: MediaDeviceInfo[] } | MediaDeviceInfo[]>;
  };
  try {
    if (typeof callWithDevices.enumerateDevices === "function") {
      const result = await callWithDevices.enumerateDevices();
      const devices = Array.isArray(result) ? result : result.devices ?? [];
      const videoDevices = devices.filter((device) => device.kind === "videoinput") as WebCameraDevice[];
      if (videoDevices.length > 0) return videoDevices;
    }
  } catch {
    // Fall back to the browser's media-device list below.
  }

  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return (devices ?? []).filter((device) => device.kind === "videoinput") as WebCameraDevice[];
  } catch {
    return [];
  }
}

function chooseWebVideoDevice(
  devices: WebCameraDevice[],
  before: LocalCameraSnapshot,
  desiredFacing: WebCameraFacingMode | null,
): WebCameraDevice | null {
  if (devices.length === 0) return null;
  const currentDeviceId = before.deviceId;
  const candidates = currentDeviceId
    ? devices.filter((device) => getWebDeviceId(device) !== currentDeviceId)
    : devices;
  if (currentDeviceId && candidates.length === 0) return null;
  if (desiredFacing) {
    const facingMatch = candidates.find((device) => getWebDeviceFacingMode(device) === desiredFacing);
    if (facingMatch) return facingMatch;
    if (!currentDeviceId) return null;
  }
  return currentDeviceId ? candidates[0] ?? null : null;
}

function describeWebCameraSwitchError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || "Error", message: error.message };
  return { name: "unknown", message: String(error) };
}

function readDailyMeetingState(callObject: Pick<DailyCall, "meetingState">): string | null {
  try {
    return callObject.meetingState();
  } catch {
    return "error";
  }
}

function isTerminalDailyMeetingState(state: string | null): boolean {
  return state === "left-meeting" || state === "error";
}

function isReusableDailyCallObject(callObject: DailyCall): boolean {
  try {
    if (callObject.isDestroyed()) return false;
  } catch {
    return false;
  }

  return readDailyMeetingState(callObject) === "joined-meeting";
}

function isBusyDailyMeetingState(state: string | null): boolean {
  return !isTerminalDailyMeetingState(state);
}

function dailyEventHasError(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const payload = event as Record<string, unknown>;
  return typeof payload.errorMsg === "string" || Boolean(payload.error);
}

function isDuplicateDailyCallObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /Duplicate\s+DailyIframe\s+instances/i,
    /multiple\s+call\s+instances/i,
    /call\s+object.*already/i,
    /already.*call\s+object/i,
    /only\s+one.*call/i,
    /single.*call\s+instance/i,
    /existing\s+call\s+instance/i,
  ].some((pattern) => pattern.test(message));
}

function MatchCallPermissionRecoveryDialog({
  recovery,
  onRetry,
  onDismiss,
}: {
  recovery: MatchCallPermissionRecovery;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const canRetry =
    recovery.result.recoveryAction === "retry" ||
    recovery.result.recoveryAction === "open_settings";
  const primaryLabel = recovery.result.recoveryAction === "open_settings" ? "I updated settings" : "Try again";

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="match-call-preflight-permission-recovery"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/84 px-4 backdrop-blur-md"
    >
      <div className="w-[min(100%,24rem)] rounded-2xl border border-border bg-card p-5 text-center shadow-2xl">
        <p className="text-base font-bold text-foreground">{mediaPermissionTitle(recovery.result)}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {mediaPermissionMessage(recovery.result)}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
            >
              {primaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-10 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-secondary"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function MatchCallProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const currentUserId = user?.id ?? null;

  const [callPhase, setCallPhase] = useState<MatchCallPhase>("idle");
  const [callType, setCallType] = useState<MatchCallType>("video");
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [audioStatus, setAudioStatus] = useState<MediaTrackStatus>("off");
  const [videoStatus, setVideoStatus] = useState<MediaTrackStatus>("off");
  const [isAudioTogglePending, setIsAudioTogglePending] = useState(false);
  const [isVideoTogglePending, setIsVideoTogglePending] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<LastCallOutcome | null>(null);
  const [activePartner, setActivePartner] = useState<PartnerSummary>(DEFAULT_PARTNER);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [permissionRecovery, setPermissionRecovery] = useState<MatchCallPermissionRecovery | null>(null);

  const callObjectRef = useRef<DailyCall | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const startCallAttemptRef = useRef(0);
  const startCallLockRef = useRef(false);
  const joiningCallIdRef = useRef<string | null>(null);
  const joinPromiseRef = useRef<Promise<void> | null>(null);
  const localCallCleanupPromiseRef = useRef<Promise<void> | null>(null);
  const preserveCallStateCleanupRef = useRef(false);
  const providerTeardownPromiseRef = useRef<Promise<void> | null>(null);
  const reconcileQueueRef = useRef(Promise.resolve());
  const reconcileSignatureByCallIdRef = useRef(new Map<string, string>());
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const accessTokenRef = useRef<string | null>(null);
  /** When true, `pagehide`/`beforeunload` already posted a keepalive RPC; skip duplicate in `cleanupLocalCall`. */
  const documentUnloadRpcIssuedRef = useRef(false);
  /** Held while a flipCamera() call is in flight so concurrent presses are coalesced. */
  const flipCameraRef = useRef(false);
  /** setTimeout id that clears the terminal banner after MATCH_CALL_OUTCOME_LINGER_MS. */
  const outcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Local user id captured once Daily joined-meeting fires; used for ended_by_user_id derivation. */
  const localUserIdRef = useRef<string | null>(null);
  /** Reason the local user attributes to the next terminal transition (set before transition fires). */
  const pendingEndReasonRef = useRef<MatchCallEndReason | null>(null);
  const latestLocalParticipantRef = useRef<DailyParticipant | undefined>(undefined);

  const callPhaseRef = useLatestRef(callPhase);
  const incomingCallRef = useLatestRef(incomingCall);
  const activePartnerRef = useLatestRef(activePartner);
  const isReconnectingRef = useLatestRef(isReconnecting);
  const callTypeRef = useLatestRef(callType);
  const isVideoOffRef = useLatestRef(isVideoOff);
  const reconcileCallRowRef = useRef<(row: MatchCallRow) => Promise<void>>(async () => {});

  const clearRingingTimeout = useCallback(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback((startedAt?: string | null) => {
    if (durationIntervalRef.current) return;
    setCallDuration(secondsSince(startedAt));
    durationIntervalRef.current = setInterval(() => {
      setCallDuration((previous) => previous + 1);
    }, 1000);
  }, []);

  const clearVideoElements = useCallback(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setLocalStream(null);
  }, []);

  /**
   * Render local participant media. The PIP component manages its own internal <video>
   * element via the `stream` prop — `localVideoRef` is optional and we MUST keep
   * `localStream` updated independently of whether any visible <video> is mounted,
   * otherwise the PIP receives null and stays black.
   *
   * We also use this as the canonical opportunity to sync mute / camera-off / track-status
   * UI state from Daily's actual participant tracks rather than from optimistic local
   * booleans — this is the source-of-truth fix for the unreliable mute button.
   */
  const renderLocalMedia = useCallback(
    (participant: DailyParticipant | undefined) => {
      if (!participant?.tracks) return;
      latestLocalParticipantRef.current = participant;

      const audioTrackState = (participant.tracks.audio?.state ?? "off") as MediaTrackStatus;
      const videoTrackState = (participant.tracks.video?.state ?? "off") as MediaTrackStatus;
      const videoTrack =
        videoTrackState === "playable" ? participant.tracks.video?.persistentTrack ?? null : null;

      // Always update the local-stream state so the PIP can render even before the
      // <video> element exists in the DOM (e.g., during ringing → in_call transition).
      setLocalStream((previous) => {
        const prevTrack = previous?.getVideoTracks?.()[0] ?? null;
        if (prevTrack === videoTrack) return previous;
        if (!videoTrack) return null;
        return new MediaStream([videoTrack]);
      });

      // Best-effort: if there's a hidden local <video> element, mirror the stream onto it
      // (used by some legacy code paths; safe to skip if absent).
      const videoEl = localVideoRef.current;
      if (videoEl) {
        const currentEl = videoEl.srcObject as MediaStream | null;
        const currentTrack = currentEl?.getVideoTracks?.()[0] ?? null;
        if (currentTrack !== videoTrack) {
          videoEl.srcObject = videoTrack ? new MediaStream([videoTrack]) : null;
        }
      }

      // Source-of-truth UI sync: mute and camera-off booleans now reflect Daily's
      // real participant track state, not React's optimistic local toggle.
      setIsMuted(audioTrackState === "off" || audioTrackState === "blocked");
      setIsVideoOff(videoTrackState === "off" || videoTrackState === "blocked");
      setAudioStatus(audioTrackState);
      setVideoStatus(videoTrackState);
    },
    [],
  );

  /**
   * Render remote participant media to remoteVideoRef + remoteAudioRef. Each track is
   * gated on `state === "playable"` because `persistentTrack` is undefined until the
   * track has actually started flowing. We MUST attach audio to a dedicated <audio>
   * element because Daily's createCallObject() (low-level) mode does not auto-render
   * audio — without this, voice calls have no sound and video calls have no audio.
   */
  const renderRemoteMedia = useCallback(
    (participant: DailyParticipant | undefined) => {
      const videoEl = remoteVideoRef.current;
      const audioEl = remoteAudioRef.current;
      if (!participant?.tracks) return;

      const audioTrackState = participant.tracks.audio?.state;
      const videoTrackState = participant.tracks.video?.state;
      const audioTrack =
        audioTrackState === "playable" ? participant.tracks.audio?.persistentTrack ?? null : null;
      const videoTrack =
        videoTrackState === "playable" ? participant.tracks.video?.persistentTrack ?? null : null;

      if (audioEl) {
        const current = audioEl.srcObject as MediaStream | null;
        const currentAudioTrack = current?.getAudioTracks?.()[0] ?? null;
        if (currentAudioTrack !== audioTrack) {
          if (audioTrack) {
            audioEl.srcObject = new MediaStream([audioTrack]);
            audioEl.play().catch((err) => {
              logMatchCallDiag("remote_audio_autoplay_blocked", {
                message: err instanceof Error ? err.message : String(err),
              });
            });
          } else {
            audioEl.srcObject = null;
          }
        }
      }

      if (videoEl) {
        const current = videoEl.srcObject as MediaStream | null;
        const currentVideoTrack = current?.getVideoTracks?.()[0] ?? null;
        if (currentVideoTrack !== videoTrack) {
          videoEl.srcObject = videoTrack ? new MediaStream([videoTrack]) : null;
        }
      }
    },
    [],
  );

  /**
   * Re-render media for all known participants. Called from track-state events to make
   * sure both local preview and remote playback reflect the latest playable tracks.
   */
  const refreshAllParticipantMedia = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const participants = callObject.participants();
    for (const key of Object.keys(participants)) {
      const participant = participants[key as keyof typeof participants];
      if (!participant) continue;
      if (participant.local) {
        renderLocalMedia(participant);
      } else {
        renderRemoteMedia(participant);
      }
    }
  }, [renderLocalMedia, renderRemoteMedia]);


  const fetchPartnerSummary = useCallback(async (profileId: string, fallbackName = "Your match") => {
    const data = await fetchUserProfile(profileId);

    return {
      userId: profileId,
      name: data?.name || fallbackName,
      avatarUrl: data?.avatar_url || null,
    } satisfies PartnerSummary;
  }, []);

  const deleteRoom = useCallback(async (roomName?: string | null) => {
    if (!roomName) return;
    try {
      await supabase.functions.invoke("daily-room", {
        body: { action: "delete_room", roomName },
      });
    } catch {
      // Best-effort cleanup only.
    }
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token ?? null;
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const fireDocumentUnloadKeepalive = () => {
      if (documentUnloadRpcIssuedRef.current) return;
      const token = accessTokenRef.current;
      const callId = trackedCallIdRef.current;
      if (!token || !callId) return;
      const action = resolveAbnormalTransitionForTeardown(
        callId,
        incomingCallRef.current,
        callPhaseRef.current,
      );
      if (!action) return;
      documentUnloadRpcIssuedRef.current = true;
      logMatchCallDiag("unload_keepalive_rpc", { call_id: callId, action });
      postMatchCallTransitionKeepalive(callId, action, token);
    };

    window.addEventListener("pagehide", fireDocumentUnloadKeepalive);
    window.addEventListener("beforeunload", fireDocumentUnloadKeepalive);
    return () => {
      window.removeEventListener("pagehide", fireDocumentUnloadKeepalive);
      window.removeEventListener("beforeunload", fireDocumentUnloadKeepalive);
    };
  }, [callPhaseRef, incomingCallRef]);

  const transitionCall = useCallback(
    async (callId: string, action: MatchCallAction, reason?: MatchCallEndReason | null) => {
      const { data, error } = await supabase.rpc("match_call_transition", {
        p_call_id: callId,
        p_action: action,
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) {
        throw error;
      }
      const result = (data ?? null) as MatchCallTransitionResult | null;
      if (result?.ok === false) {
        throw new Error(`match_call_transition rejected: ${result.code ?? "unknown"}`);
      }
      return result;
    },
    [],
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) return;

    const beat = () => {
      const callId = trackedCallIdRef.current;
      if (!callId) return;
      void transitionCall(callId, "heartbeat").catch((err) => {
        logMatchCallDiag("heartbeat_failed", {
          call_id: callId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    };

    beat();
    heartbeatIntervalRef.current = setInterval(beat, MATCH_CALL_HEARTBEAT_MS);
  }, [transitionCall]);

  const clearRemoteReconnectGrace = useCallback(() => {
    if (remoteReconnectTimeoutRef.current) {
      clearTimeout(remoteReconnectTimeoutRef.current);
      remoteReconnectTimeoutRef.current = null;
    }
  }, []);

  const cleanupLocalCall = useCallback(
    async (options: MatchCallCleanupOptions = {}) => {
      if (localCallCleanupPromiseRef.current) {
        await localCallCleanupPromiseRef.current;
      }

      const cleanupPromise = Promise.resolve().then(async () => {
        const {
          deleteRoomName,
          skipRoomDelete = false,
          skipServerTransition = false,
          preserveCallState = false,
        } = options;
        const shouldAttemptAbnormalRpc =
          !preserveCallState &&
          !skipServerTransition &&
          !documentUnloadRpcIssuedRef.current &&
          trackedCallIdRef.current;

        if (shouldAttemptAbnormalRpc) {
          const callId = trackedCallIdRef.current!;
          const action = resolveAbnormalTransitionForTeardown(
            callId,
            incomingCallRef.current,
            callPhaseRef.current,
          );
          if (action) {
            try {
              await transitionCall(callId, action);
              logMatchCallDiag("abnormal_teardown_rpc_ok", {
                call_id: callId,
                action,
                phase: callPhaseRef.current,
              });
            } catch (err) {
              logMatchCallDiag("abnormal_teardown_rpc_failed", {
                call_id: callId,
                action,
                phase: callPhaseRef.current,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        if (!preserveCallState) {
          documentUnloadRpcIssuedRef.current = false;
          clearRingingTimeout();
          stopDurationTimer();
        }

        clearRemoteReconnectGrace();
        stopHeartbeat();

        const callObject = callObjectRef.current;
        // Null the ref before awaiting leave/destroy, but keep a cleanup promise so
        // retries do not create a new Daily singleton until the old one is released.
        callObjectRef.current = null;
        if (preserveCallState) {
          preserveCallStateCleanupRef.current = true;
        }
        if (callObject) {
          try {
            try {
              await callObject.leave();
            } catch {
              // ignore
            }
            try {
              await callObject.destroy();
            } catch {
              // ignore
            }
          } finally {
            if (preserveCallState) {
              preserveCallStateCleanupRef.current = false;
            }
          }
        } else if (preserveCallState) {
          preserveCallStateCleanupRef.current = false;
        }

        clearVideoElements();

        const roomName = deleteRoomName ?? roomNameRef.current;
        if (!preserveCallState) {
          trackedCallIdRef.current = null;
          roomNameRef.current = null;
          startCallLockRef.current = false;
          joiningCallIdRef.current = null;
          joinPromiseRef.current = null;
          reconcileSignatureByCallIdRef.current.clear();
          setCallPhase("idle");
          setIncomingCall(null);
          setActiveMatchId(null);
          setActivePartner(DEFAULT_PARTNER);
          setCallDuration(0);
          setIsMuted(false);
          setIsVideoOff(false);
          setCanFlipCamera(false);
          setIsFlippingCamera(false);
          flipCameraRef.current = false;
          latestLocalParticipantRef.current = undefined;
        }

        if (roomName && !skipRoomDelete) {
          await deleteRoom(roomName);
        }
      });

      localCallCleanupPromiseRef.current = cleanupPromise;
      try {
        await cleanupPromise;
      } finally {
        if (localCallCleanupPromiseRef.current === cleanupPromise) {
          localCallCleanupPromiseRef.current = null;
        }
      }
    },
    [
      callPhaseRef,
      clearRemoteReconnectGrace,
      clearRingingTimeout,
      clearVideoElements,
      deleteRoom,
      incomingCallRef,
      stopHeartbeat,
      stopDurationTimer,
      transitionCall,
    ],
  );

  const runSingleJoinFlow = useCallback(
    async (callId: string, run: () => Promise<void>) => {
      if (
        callObjectRef.current &&
        trackedCallIdRef.current === callId &&
        isReusableDailyCallObject(callObjectRef.current)
      ) {
        return;
      }
      if (joinPromiseRef.current) {
        if (joiningCallIdRef.current === callId) {
          await joinPromiseRef.current;
        }
        return;
      }

      joiningCallIdRef.current = callId;
      const joinPromise = (async () => {
        try {
          await run();
        } finally {
          if (joiningCallIdRef.current === callId) {
            joiningCallIdRef.current = null;
            joinPromiseRef.current = null;
          }
        }
      })();
      joinPromiseRef.current = joinPromise;
      await joinPromise;
    },
    [],
  );

  /**
   * End the active call, optionally tagging it with a specific reason. Defaults to
   * `hangup` (user-initiated). Pass `connection_lost` for grace-expiry, `provider_error`
   * for Daily errors, `media_failure` for permission/device failures.
   */
  const endCall = useCallback(
    async (reason?: MatchCallEndReason) => {
      const callId = trackedCallIdRef.current;
      const roomName = roomNameRef.current;
      const effectiveReason = reason ?? pendingEndReasonRef.current ?? null;
      pendingEndReasonRef.current = null;

      if (callId) {
        try {
          await transitionCall(callId, "end", effectiveReason);
        } catch {
          // Backend reconciliation will still arrive over realtime when available.
        }
      }

      await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
    },
    [cleanupLocalCall, transitionCall],
  );

  const teardownForProviderError = useCallback(
    (source: string, event?: unknown) => {
      if (providerTeardownPromiseRef.current) {
        logMatchCallDiag("provider_teardown_deduped", { source });
        return;
      }

      logMatchCallDiag("provider_teardown_started", {
        source,
        message:
          event && typeof event === "object" && "errorMsg" in event
            ? String((event as { errorMsg?: unknown }).errorMsg ?? "")
            : null,
      });
      toast.error("Call connection error");
      const teardownPromise = Promise.resolve()
        .then(() => endCall("provider_error"))
        .finally(() => {
          providerTeardownPromiseRef.current = null;
        });
      providerTeardownPromiseRef.current = teardownPromise;
      void teardownPromise;
    },
    [endCall],
  );

  const waitForProviderTeardown = useCallback(async (source: string): Promise<boolean> => {
    const teardownPromise = providerTeardownPromiseRef.current;
    if (!teardownPromise) return false;

    logMatchCallDiag("provider_teardown_awaited_by_flow", { source });
    try {
      await teardownPromise;
    } catch {
      // The provider teardown path owns final local cleanup; callers should not
      // duplicate the same failure UX or transition if that cleanup itself fails.
    }
    return true;
  }, []);

  const hasBusyExternalDailyCall = useCallback(async (source: string): Promise<boolean> => {
    try {
      const DailyIframe = await loadDailyIframe();
      const sdkCallObject = DailyIframe.getCallInstance();
      if (!sdkCallObject || sdkCallObject === callObjectRef.current) return false;

      const meetingState = readDailyMeetingState(sdkCallObject);
      if (!isBusyDailyMeetingState(meetingState)) return false;

      logMatchCallDiag("external_daily_call_busy", {
        source,
        meeting_state: meetingState,
      });
      return true;
    } catch (err) {
      logMatchCallDiag("external_daily_call_busy_check_failed", {
        source,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, []);

  const cleanupStaleCallObjectForFreshCreate = useCallback(
    async (callId: string, source: string): Promise<boolean> => {
      if (localCallCleanupPromiseRef.current) {
        logMatchCallDiag("fresh_create_waited_for_cleanup", { call_id: callId, source });
        await localCallCleanupPromiseRef.current;
      }

      const existingCallObject = callObjectRef.current;
      if (!existingCallObject) return false;

      const meetingState = readDailyMeetingState(existingCallObject);
      const sameCall = trackedCallIdRef.current === callId;
      if (sameCall && isReusableDailyCallObject(existingCallObject)) {
        logMatchCallDiag("fresh_create_reused_existing_call_object", {
          call_id: callId,
          source,
          meeting_state: meetingState,
        });
        return true;
      }

      logMatchCallDiag("fresh_create_cleaned_stale_call_object", {
        call_id: callId,
        source,
        tracked_call_id: trackedCallIdRef.current,
        meeting_state: meetingState,
      });
      await cleanupLocalCall({
        skipRoomDelete: true,
        skipServerTransition: true,
        preserveCallState: true,
      });
      return false;
    },
    [cleanupLocalCall],
  );

  const createFreshMatchCallObject = useCallback(
    async (
      DailyIframe: DailyIframeModule,
      callId: string,
      currentCallType: MatchCallType,
      source: string,
    ): Promise<DailyCall | null> => {
      const shouldReuseExisting = await cleanupStaleCallObjectForFreshCreate(callId, source);
      if (shouldReuseExisting) return null;

      const options = dailyCallObjectOptions({
        audioSource: true,
        videoSource: currentCallType === "video",
      });

      try {
        return DailyIframe.createCallObject(options);
      } catch (error) {
        if (!isDuplicateDailyCallObjectError(error)) throw error;

        logMatchCallDiag("fresh_create_recovered_duplicate_daily_instance", {
          call_id: callId,
          source,
          message: error instanceof Error ? error.message : String(error),
        });
        const sdkCallObject = DailyIframe.getCallInstance();
        if (sdkCallObject) {
          const sdkMeetingState = readDailyMeetingState(sdkCallObject);
          if (isBusyDailyMeetingState(sdkMeetingState)) {
            logMatchCallDiag("fresh_create_duplicate_daily_instance_busy", {
              call_id: callId,
              source,
              meeting_state: sdkMeetingState,
            });
            throw error;
          }
          callObjectRef.current = sdkCallObject;
          await cleanupLocalCall({
            skipRoomDelete: true,
            skipServerTransition: true,
            preserveCallState: true,
          });
        } else if (localCallCleanupPromiseRef.current) {
          await localCallCleanupPromiseRef.current;
        } else {
          throw error;
        }
        return DailyIframe.createCallObject(options);
      }
    },
    [cleanupLocalCall, cleanupStaleCallObjectForFreshCreate],
  );

  const readLocalCameraSnapshot = useCallback((callObject: DailyCall): LocalCameraSnapshot => {
    let local = latestLocalParticipantRef.current;
    try {
      const callLocal = callObject.participants().local;
      if (callLocal) {
        local = callLocal;
        latestLocalParticipantRef.current = callLocal;
      }
    } catch {
      // Keep the most recent participant snapshot from Daily events.
    }
    return getLocalCameraSnapshot(local);
  }, []);

  const waitForWebCameraSwitchCommit = useCallback(
    async (
      callObject: DailyCall,
      before: LocalCameraSnapshot,
      method: WebCameraSwitchCommitMethod,
      opts: { expectedDeviceId?: string | null; expectedFacing?: WebCameraFacingMode | null } = {},
    ): Promise<WebCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs <= MATCH_CALL_CAMERA_SWITCH_COMMIT_TIMEOUT_MS) {
        const snapshot = readLocalCameraSnapshot(callObject);
        const trackChanged = Boolean(before.trackId && snapshot.trackId && snapshot.trackId !== before.trackId);
        const deviceChanged = Boolean(before.deviceId && snapshot.deviceId && snapshot.deviceId !== before.deviceId);
        const facingChanged = Boolean(before.facingMode && snapshot.facingMode && snapshot.facingMode !== before.facingMode);
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
        const live = snapshot.readyState === "live" && snapshot.enabled !== false;

        if (live && (trackChanged || deviceChanged || facingChanged || expectedDeviceMatched || expectedFacingMatched)) {
          return {
            ...snapshot,
            method,
            latencyMs: Date.now() - startedAtMs,
          };
        }

        await sleepMatchCallCameraSwitch(MATCH_CALL_CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readLocalCameraSnapshot],
  );

  const refreshCameraFlipCapability = useCallback(
    async (
      callObject: DailyCall | null = callObjectRef.current,
      currentCallType: MatchCallType = callTypeRef.current,
    ) => {
      const hasSwitchApi =
        !!callObject &&
        (typeof callObject.setInputDevicesAsync === "function" || typeof callObject.cycleCamera === "function");
      const localCamera = callObject ? readLocalCameraSnapshot(callObject) : null;

      if (
        currentCallType !== "video" ||
        isVideoOffRef.current ||
        !callObject ||
        !hasSwitchApi ||
        !localCamera ||
        localCamera.readyState !== "live" ||
        localCamera.enabled === false
      ) {
        setCanFlipCamera(false);
        return;
      }

      const videoInputs = await enumerateWebVideoDevices(callObject);
      const deterministicTarget =
        typeof callObject.setInputDevicesAsync === "function"
          ? chooseWebVideoDevice(
              videoInputs,
              localCamera,
              oppositeWebCameraFacingMode(localCamera.facingMode),
            )
          : null;
      if (
        callObjectRef.current !== callObject ||
        callPhaseRef.current !== "in_call" ||
        callTypeRef.current !== currentCallType ||
        isVideoOffRef.current
      ) {
        setCanFlipCamera(false);
        return;
      }

      const canFlip =
        videoInputs.length >= 2 &&
        (typeof callObject.cycleCamera === "function" || Boolean(getWebDeviceId(deterministicTarget)));
      setCanFlipCamera(canFlip);
      logMatchCallDiag("camera_flip_capability", {
        platform: "web",
        video_input_count: videoInputs.length,
        can_flip: canFlip,
        has_cycle_camera: typeof callObject.cycleCamera === "function",
        has_set_input_devices: typeof callObject.setInputDevicesAsync === "function",
      });
    },
    [callPhaseRef, callTypeRef, isVideoOffRef, readLocalCameraSnapshot],
  );

  const setupCallEvents = useCallback(
    (callObject: DailyCall, currentCallType: MatchCallType) => {
      callObject.on("joined-meeting", () => {
        logMatchCallDiag("joined_meeting", { call_type: currentCallType });
        refreshAllParticipantMedia();
        void refreshCameraFlipCapability(callObject, currentCallType);
      });

      callObject.on("participant-joined", (event) => {
        if (!event?.participant || event.participant.local) return;
        clearRingingTimeout();
        clearRemoteReconnectGrace();
        // Resuming from reconnect grace? Don't show another "connected" toast — just clear
        // the reconnecting banner. Otherwise this is a fresh connection.
        const wasReconnecting = isReconnectingRef.current;
        setIsReconnecting(false);
        setCallPhase("in_call");
        startDurationTimer();
        startHeartbeat();
        renderRemoteMedia(event.participant);
        if (!wasReconnecting) {
          toast.success(currentCallType === "voice" ? "Voice call connected" : "Video call connected");
        }
      });

      callObject.on("participant-updated", (event) => {
        if (!event?.participant) return;
        if (event.participant.local) {
          renderLocalMedia(event.participant);
        } else {
          renderRemoteMedia(event.participant);
        }
      });

      callObject.on("track-started", (event) => {
        if (!event?.participant) return;
        logMatchCallDiag("track_started", {
          local: event.participant.local,
          track_kind: event.track?.kind ?? null,
        });
        if (event.participant.local) {
          renderLocalMedia(event.participant);
        } else {
          renderRemoteMedia(event.participant);
        }
      });

      callObject.on("track-stopped", (event) => {
        if (!event?.participant) return;
        if (event.participant.local) {
          renderLocalMedia(event.participant);
        } else {
          renderRemoteMedia(event.participant);
        }
      });

      callObject.on("participant-left", (event) => {
        if (!event?.participant || event.participant.local) return;
        clearRemoteReconnectGrace();
        // Render a reconnecting banner inside the call overlay rather than dropping
        // back to chat immediately. If the partner returns within the grace window,
        // we resume seamlessly; if not, we transition with reason `connection_lost`.
        setIsReconnecting(true);
        remoteReconnectTimeoutRef.current = setTimeout(() => {
          remoteReconnectTimeoutRef.current = null;
          if (callPhaseRef.current !== "in_call" || !trackedCallIdRef.current) return;
          setIsReconnecting(false);
          void endCall("connection_lost");
        }, MATCH_CALL_REMOTE_RECONNECT_GRACE_MS);
      });

      callObject.on("error", (event) => {
        console.error("[MatchCall] Daily error:", event);
        logMatchCallDiag("daily_error", {
          message: event && typeof event === "object" && "errorMsg" in event ? String((event as { errorMsg?: unknown }).errorMsg ?? "") : null,
        });
        teardownForProviderError("daily_error", event);
      });

      callObject.on("left-meeting", (event) => {
        if (preserveCallStateCleanupRef.current) return;
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase("idle");
        if (dailyEventHasError(event)) {
          teardownForProviderError("left_meeting_error", event);
        }
      });
    },
    [
      callPhaseRef,
      clearRemoteReconnectGrace,
      clearRingingTimeout,
      endCall,
      isReconnectingRef,
      refreshCameraFlipCapability,
      refreshAllParticipantMedia,
      renderLocalMedia,
      renderRemoteMedia,
      startHeartbeat,
      startDurationTimer,
      stopDurationTimer,
      teardownForProviderError,
    ],
  );

  const markIncomingCallMissed = useCallback(async () => {
    const callId = incomingCallRef.current?.callId ?? trackedCallIdRef.current;
    const roomName = roomNameRef.current;
    if (!callId) return;

    try {
      await transitionCall(callId, "mark_missed");
    } catch {
      // Realtime terminal update will still reconcile if the write already landed elsewhere.
    }

    await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
  }, [cleanupLocalCall, incomingCallRef, transitionCall]);

  const declineCall = useCallback(async () => {
    const callId = incomingCallRef.current?.callId ?? trackedCallIdRef.current;
    const roomName = roomNameRef.current;
    if (!callId) return;

    try {
      await transitionCall(callId, "decline");
    } catch {
      // Ignore and fall through to local cleanup.
    }

    await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
  }, [cleanupLocalCall, incomingCallRef, transitionCall]);

  const answerCall = useCallback(async () => {
    const pendingIncoming = incomingCallRef.current;
    if (!pendingIncoming) return;

    if (await hasBusyExternalDailyCall("answer_call_preflight")) {
      toast.error("Finish your current call before answering");
      return;
    }

    const mediaPermission = await requestWebMatchCallMediaPermission(pendingIncoming.callType);
    if (mediaPermission) {
      logMatchCallDiag("answer_call_media_preflight_blocked", {
        call_id: pendingIncoming.callId,
        call_type: pendingIncoming.callType,
        permission_status: mediaPermission.status,
        recovery_action: mediaPermission.recoveryAction,
      });
      setPermissionRecovery({
        kind: "answer",
        callId: pendingIncoming.callId,
        callType: pendingIncoming.callType,
        result: mediaPermission,
      });
      return;
    }
    setPermissionRecovery(null);

    let answeredRoomName: string | null = roomNameRef.current;
    let receivedJoinToken = false;
    try {
      const { data, error } = await supabase.functions.invoke("daily-room", {
        body: { action: "answer_match_call", callId: pendingIncoming.callId },
      });

      const answerEdgeCode = parseMatchCallEdgeCode(data);
      if (error || !data?.token) {
        toast.error(
          messageForMatchCallEdgeCode(answerEdgeCode) ??
            (answerEdgeCode === MATCH_CALL_EDGE_CODES.TOKEN_ISSUE_FAILED
              ? "Could not connect — please try again in a moment."
              : "Couldn't connect call"),
        );
        await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
        return;
      }

      receivedJoinToken = true;
      answeredRoomName = data.room_name ?? roomNameRef.current;
      roomNameRef.current = answeredRoomName;
      trackedCallIdRef.current = pendingIncoming.callId;
      setCallType(pendingIncoming.callType);
      setCallPhase("in_call");
      setIncomingCall(null);
      startDurationTimer();

      await runSingleJoinFlow(pendingIncoming.callId, async () => {
        const DailyIframe = await loadDailyIframe();
        const callObject = await createFreshMatchCallObject(
          DailyIframe,
          pendingIncoming.callId,
          pendingIncoming.callType,
          "answer_call",
        );
        if (!callObject) return;
        callObjectRef.current = callObject;
        setupCallEvents(callObject, pendingIncoming.callType);

        await callObject.join({ url: data.room_url, token: data.token });

        try {
          await callObject.setLocalAudio(true);
        } catch (err) {
          logMatchCallDiag("set_local_audio_failed", {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          await callObject.setLocalVideo(pendingIncoming.callType === "video");
        } catch (err) {
          logMatchCallDiag("set_local_video_failed", {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        }

        const localParticipant = callObject.participants().local;
        if (localParticipant) {
          renderLocalMedia(localParticipant);
          const audioState = localParticipant.tracks?.audio?.state;
          const videoState = localParticipant.tracks?.video?.state;
          setIsMuted(audioState === "off" || audioState === "blocked");
          setIsVideoOff(
            pendingIncoming.callType !== "video" ||
              videoState === "off" ||
              videoState === "blocked",
          );
        }
        await transitionCall(pendingIncoming.callId, "joined").catch((err) => {
          logMatchCallDiag("answer_joined_transition_failed", {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
        startHeartbeat();
      });
    } catch (error) {
      if (await waitForProviderTeardown("answer_call_catch")) return;

      console.error("[MatchCall] Answer error:", error);
      toast.error("Couldn't connect call");

      const callId = pendingIncoming.callId;
      if (receivedJoinToken) {
        try {
          await transitionCall(callId, "join_failed");
        } catch {
          // ignore
        }
      }

      await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
    }
  }, [
    cleanupLocalCall,
    createFreshMatchCallObject,
    hasBusyExternalDailyCall,
    incomingCallRef,
    renderLocalMedia,
    runSingleJoinFlow,
    setupCallEvents,
    startDurationTimer,
    startHeartbeat,
    transitionCall,
    waitForProviderTeardown,
  ]);

  const startCall = useCallback(
    async ({ matchId, type, partnerUserId, partnerName, partnerAvatar }: StartCallParams) => {
      if (!matchId) {
        toast.error("No active match for calling");
        return;
      }

      if (startCallLockRef.current) {
        toast.error("Please wait for the current call request");
        return;
      }
      if (trackedCallIdRef.current || incomingCallRef.current || callPhaseRef.current !== "idle") {
        toast.error("Finish the current call before starting another one");
        return;
      }
      startCallLockRef.current = true;
      if (await hasBusyExternalDailyCall("start_call_preflight")) {
        toast.error("Finish the current call before starting another one");
        startCallLockRef.current = false;
        return;
      }

      const mediaPermission = await requestWebMatchCallMediaPermission(type);
      if (mediaPermission) {
        logMatchCallDiag("start_call_media_preflight_blocked", {
          match_id: matchId,
          call_type: type,
          permission_status: mediaPermission.status,
          recovery_action: mediaPermission.recoveryAction,
        });
        setPermissionRecovery({
          kind: "start",
          params: { matchId, type, partnerUserId, partnerName, partnerAvatar },
          result: mediaPermission,
        });
        startCallLockRef.current = false;
        return;
      }
      setPermissionRecovery(null);

      logMatchCallDiag("start_call_invoked", { match_id: matchId, call_type: type });
      const startCallAttemptId = startCallAttemptRef.current + 1;
      startCallAttemptRef.current = startCallAttemptId;
      const isCurrentStartCallAttempt = () => startCallAttemptRef.current === startCallAttemptId;
      const invalidateStartCallAttempt = () => {
        if (startCallAttemptRef.current === startCallAttemptId) {
          startCallAttemptRef.current += 1;
        }
      };

      setCallType(type);
      setCallPhase("ringing");
      setActiveMatchId(matchId);
      setActivePartner({
        userId: partnerUserId ?? null,
        name: partnerName?.trim() || DEFAULT_PARTNER.name,
        avatarUrl: partnerAvatar ?? null,
      });

      let createdCallId: string | null = null;
      let createdRoomName: string | null = null;

      const startWatchdogId = setTimeout(() => {
        if (
          callPhaseRef.current === "ringing" &&
          !trackedCallIdRef.current &&
          isCurrentStartCallAttempt()
        ) {
          invalidateStartCallAttempt();
          logMatchCallDiag("start_call_watchdog_fired", { match_id: matchId, call_type: type });
          toast.error("Call didn't start — please try again");
          void cleanupLocalCall({ skipServerTransition: true });
        }
      }, 15_000);

      try {
        const { data, error } = await supabase.functions.invoke("daily-room", {
          body: { action: "create_match_call", matchId, callType: type },
        });

        const createEdgeCode = parseMatchCallEdgeCode(data);
        logMatchCallDiag("start_call_edge_response", {
          match_id: matchId,
          ok: !error && Boolean(data?.token),
          code: createEdgeCode ?? null,
          has_token: Boolean(data?.token),
          reused: Boolean(data?.reused),
          existing_call_type: (data?.existing_call_type as string | undefined) ?? null,
          call_type_mismatch: Boolean(data?.call_type_mismatch),
          status: (data?.status as string | undefined) ?? null,
        });

        // Backend redirected: there is an open incoming call from the partner. Bail
        // out of the create flow and let the existing IncomingCallOverlay drive the
        // answer. (Realtime should already have surfaced the overlay; this is the
        // fallback for the case where the user clicked the Phone/Video button before
        // realtime delivered.)
        if (data?.code === "INCOMING_CALL_AVAILABLE") {
          clearTimeout(startWatchdogId);
          if (!isCurrentStartCallAttempt()) return;
          const incomingCallId = typeof data.call_id === "string" ? data.call_id : null;
          if (!incomingCallId) {
            toast.error("Incoming call is available, but couldn't load it.");
            await cleanupLocalCall({ skipServerTransition: true });
            return;
          }

          invalidateStartCallAttempt();
          const incomingType: MatchCallType =
            data.existing_call_type === "voice" || data.existing_call_type === "video"
              ? data.existing_call_type
              : type;
          const incomingMatchId = typeof data.match_id === "string" ? data.match_id : matchId;
          const callerName = partnerName?.trim() || DEFAULT_PARTNER.name;
          const callerAvatar = partnerAvatar ?? null;

          trackedCallIdRef.current = incomingCallId;
          roomNameRef.current = null;
          setCallType(incomingType);
          setActiveMatchId(incomingMatchId);
          setActivePartner({
            userId: partnerUserId ?? null,
            name: callerName,
            avatarUrl: callerAvatar,
          });
          setIncomingCall({
            callId: incomingCallId,
            matchId: incomingMatchId,
            callerId: partnerUserId ?? "",
            callerName,
            callerAvatar,
            callType: incomingType,
          });
          setCallPhase("idle");
          setCallDuration(0);
          clearRingingTimeout();
          stopDurationTimer();
          toast.info(`${callerName} is calling — answer or decline.`);
          return;
        }

        if (error || !data?.token) {
          clearTimeout(startWatchdogId);
          if (!isCurrentStartCallAttempt()) {
            return;
          }
          toast.error(
            messageForMatchCallEdgeCode(createEdgeCode) ?? "Couldn't start call",
          );
          await cleanupLocalCall();
          return;
        }

        // Honour the existing call's modality when the backend reused an open row of a
        // different type. The UI mode-switches so the user sees the actual call.
        const effectiveType: MatchCallType =
          data?.call_type_mismatch && (data?.existing_call_type === "voice" || data?.existing_call_type === "video")
            ? (data.existing_call_type as MatchCallType)
            : type;
        if (effectiveType !== type) {
          setCallType(effectiveType);
          if (data?.call_type_mismatch) {
            toast.info(
              effectiveType === "voice"
                ? "Joining the existing voice call instead."
                : "Joining the existing video call instead.",
            );
          }
        }

        // If the backend reused an existing call that is already active, jump straight
        // past the ringing UI — the partner has already answered.
        if (data?.reused && data?.status === "active") {
          setCallPhase("in_call");
        }

        const callId = data.call_id as string;
        const roomName = data.room_name as string | null;
        if (!isCurrentStartCallAttempt()) {
          logMatchCallDiag("start_call_stale_success_ignored", {
            call_id: callId,
            match_id: matchId,
          });
          clearTimeout(startWatchdogId);
          try {
            await transitionCall(callId, "join_failed");
          } catch {
            // ignore
          }
          if (roomName) {
            await deleteRoom(roomName).catch(() => {});
          }
          return;
        }
        createdCallId = callId;
        createdRoomName = roomName;
        trackedCallIdRef.current = callId;
        roomNameRef.current = createdRoomName;
        clearTimeout(startWatchdogId);

        await runSingleJoinFlow(callId, async () => {
          const DailyIframe = await loadDailyIframe();
          const callObject = await createFreshMatchCallObject(
            DailyIframe,
            callId,
            effectiveType,
            "start_call",
          );
          if (!callObject) return;
          callObjectRef.current = callObject;
          setupCallEvents(callObject, effectiveType);

          await callObject.join({ url: data.room_url, token: data.token });

          // Force-publish local media. Daily's createCallObject() does not always start
          // tracks deterministically — calling these explicitly guarantees the mic and
          // (for video calls) camera are producing tracks the remote participant can
          // subscribe to. Without this, the call can look "connected" with no audio.
          try {
            await callObject.setLocalAudio(true);
          } catch (err) {
            logMatchCallDiag("set_local_audio_failed", {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            await callObject.setLocalVideo(effectiveType === "video");
          } catch (err) {
            logMatchCallDiag("set_local_video_failed", {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          }

          const localParticipant = callObject.participants().local;
          if (localParticipant) {
            renderLocalMedia(localParticipant);
            // Initialize UI mute/camera-off state from actual track state rather than
            // hardcoded booleans, so the toggle buttons reflect reality.
            const audioState = localParticipant.tracks?.audio?.state;
            const videoState = localParticipant.tracks?.video?.state;
            setIsMuted(audioState === "off" || audioState === "blocked");
            setIsVideoOff(
              effectiveType !== "video" ||
                videoState === "off" ||
                videoState === "blocked",
            );
          }
          await transitionCall(callId, "joined").catch((err) => {
            logMatchCallDiag("start_joined_transition_failed", {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          });
          startHeartbeat();
        });

        clearRingingTimeout();
        ringingTimeoutRef.current = setTimeout(() => {
          const currentTrackedCallId = trackedCallIdRef.current;
          if (!currentTrackedCallId || callPhaseRef.current !== "ringing") return;
          toast.info("No answer yet");
          void (async () => {
            try {
              await transitionCall(currentTrackedCallId, "mark_missed");
            } catch {
              // ignore
            }
            await cleanupLocalCall({ deleteRoomName: roomNameRef.current, skipServerTransition: true });
          })();
        }, 30000);
      } catch (error) {
        clearTimeout(startWatchdogId);
        if (!isCurrentStartCallAttempt()) {
          return;
        }
        if (await waitForProviderTeardown("start_call_catch")) {
          return;
        }
        console.error("[MatchCall] Start error:", error);
        logMatchCallDiag("start_call_threw", {
          match_id: matchId,
          message: error instanceof Error ? error.message : String(error),
        });
        toast.error("Couldn't start call");

        if (createdCallId) {
          try {
            await transitionCall(createdCallId, "join_failed");
          } catch {
            // ignore
          }
        }

        await cleanupLocalCall({ deleteRoomName: createdRoomName, skipServerTransition: true });
      } finally {
        startCallLockRef.current = false;
      }
    },
    [
      callPhaseRef,
      cleanupLocalCall,
      clearRingingTimeout,
      createFreshMatchCallObject,
      deleteRoom,
      hasBusyExternalDailyCall,
      incomingCallRef,
      renderLocalMedia,
      setupCallEvents,
      runSingleJoinFlow,
      startHeartbeat,
      stopDurationTimer,
      transitionCall,
      waitForProviderTeardown,
    ],
  );

  /**
   * Toggle local audio. Source-of-truth: reads the current track state from Daily,
   * sets a pending flag, calls Daily's setLocalAudio, then waits for the
   * `participant-updated` event to update isMuted via renderLocalMedia. If the
   * track is blocked, the control itself is the persistent retry surface after
   * the user updates browser settings; toast copy is supplementary if retry fails.
   */
  const toggleMute = useCallback(async () => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const local = callObject.participants().local;
    const audioState = (local?.tracks?.audio?.state ?? "off") as MediaTrackStatus;
    if (audioState === "blocked") {
      setIsAudioTogglePending(true);
      try {
        await callObject.setLocalAudio(true);
        renderLocalMedia(callObject.participants().local);
      } catch (err) {
        logMatchCallDiag("toggle_mute_settings_retry_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        toast.error("Microphone access needed", {
          description: "Allow microphone access in your browser settings, then try again.",
        });
      } finally {
        setTimeout(() => setIsAudioTogglePending(false), 250);
      }
      return;
    }
    // After the blocked early-return, audioState can only be "off"/"loading"/"playable"/etc.
    const wantOn = audioState === "off";
    setIsAudioTogglePending(true);
    try {
      await callObject.setLocalAudio(wantOn);
    } catch (err) {
      logMatchCallDiag("toggle_mute_failed", {
        message: err instanceof Error ? err.message : String(err),
        want_on: wantOn,
      });
      toast.error(wantOn ? "Couldn't unmute microphone." : "Couldn't mute microphone.");
    } finally {
      // Brief debounce; the participant-updated event will follow within ~100ms and
      // renderLocalMedia will sync isMuted to truth. Releasing pending here keeps the
      // button responsive even if no event arrives (e.g., already in target state).
      setTimeout(() => setIsAudioTogglePending(false), 250);
    }
  }, [renderLocalMedia]);

  const toggleVideo = useCallback(async () => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const local = callObject.participants().local;
    const videoState = (local?.tracks?.video?.state ?? "off") as MediaTrackStatus;
    if (videoState === "blocked") {
      setIsVideoTogglePending(true);
      try {
        await callObject.setLocalVideo(true);
        renderLocalMedia(callObject.participants().local);
      } catch (err) {
        logMatchCallDiag("toggle_video_settings_retry_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        toast.error("Camera access needed", {
          description: "Allow camera access in your browser settings, then try again.",
        });
      } finally {
        setTimeout(() => setIsVideoTogglePending(false), 250);
      }
      return;
    }
    const wantOn = videoState === "off";
    setIsVideoTogglePending(true);
    try {
      await callObject.setLocalVideo(wantOn);
    } catch (err) {
      logMatchCallDiag("toggle_video_failed", {
        message: err instanceof Error ? err.message : String(err),
        want_on: wantOn,
      });
      toast.error(wantOn ? "Couldn't turn camera on." : "Couldn't turn camera off.");
    } finally {
      setTimeout(() => setIsVideoTogglePending(false), 250);
    }
  }, [renderLocalMedia]);

  useEffect(() => {
    if (callPhase !== "in_call" || callType !== "video" || isVideoOff) {
      setCanFlipCamera(false);
      return;
    }
    void refreshCameraFlipCapability();
  }, [callPhase, callType, isVideoOff, localStream, refreshCameraFlipCapability]);

  /**
   * Flip between front/back cameras without leaving the Daily room. Prefer a concrete
   * alternate device, then fall back to Daily's cycleCamera, and only report success
   * once the local track/device/facing snapshot confirms a live committed switch.
   */
  const flipCamera = useCallback(async () => {
    const callObject = callObjectRef.current;
    if (!callObject || callPhase !== "in_call" || callType !== "video" || isVideoOff) return;
    if (flipCameraRef.current) return;
    if (typeof callObject.setInputDevicesAsync !== "function" && typeof callObject.cycleCamera !== "function") {
      setCanFlipCamera(false);
      toast.info("Camera switching is not available on this device.");
      return;
    }

    flipCameraRef.current = true;
    setIsFlippingCamera(true);
    try {
      const before = readLocalCameraSnapshot(callObject);
      if (before.readyState !== "live" || before.enabled === false || !before.trackId) {
        setCanFlipCamera(false);
        toast.info("Turn your camera on before switching cameras.");
        return;
      }

      const desiredFacing = oppositeWebCameraFacingMode(before.facingMode);
      let commit: WebCameraSwitchCommit | null = null;
      let availableVideoDeviceCount: number | null = null;

      if (typeof callObject.setInputDevicesAsync === "function") {
        try {
          const devices = await enumerateWebVideoDevices(callObject);
          availableVideoDeviceCount = devices.length;
          const target = chooseWebVideoDevice(devices, before, desiredFacing);
          const targetDeviceId = getWebDeviceId(target);
          if (targetDeviceId) {
            await callObject.setInputDevicesAsync({ videoDeviceId: targetDeviceId });
            commit = await waitForWebCameraSwitchCommit(callObject, before, "set_input_device", {
              expectedDeviceId: targetDeviceId,
              expectedFacing: getWebDeviceFacingMode(target) ?? desiredFacing,
            });
          } else {
            logMatchCallDiag("flip_camera_setinput_no_target", {
              platform: "web",
              desired_facing_mode: desiredFacing,
              video_input_count: devices.length,
              before_device_id: before.deviceId,
              before_facing_mode: before.facingMode,
            });
          }
        } catch (err) {
          logMatchCallDiag("flip_camera_setinput_failed_fallback", {
            platform: "web",
            desired_facing_mode: desiredFacing,
            error: describeWebCameraSwitchError(err),
          });
        }
      }

      if (!commit && typeof callObject.cycleCamera === "function") {
        try {
          const result = await callObject.cycleCamera({ preferDifferentFacingMode: true });
          const resultDevice = result?.device as WebCameraDevice | null | undefined;
          commit = await waitForWebCameraSwitchCommit(callObject, before, "cycle_camera", {
            expectedDeviceId: getWebDeviceId(resultDevice),
            expectedFacing: getWebDeviceFacingMode(resultDevice) ?? desiredFacing,
          });
        } catch (err) {
          logMatchCallDiag("flip_camera_cycle_failed", {
            platform: "web",
            desired_facing_mode: desiredFacing,
            error: describeWebCameraSwitchError(err),
          });
        }
      }

      if (!commit) {
        const after = readLocalCameraSnapshot(callObject);
        if (availableVideoDeviceCount != null && availableVideoDeviceCount < 2) {
          setCanFlipCamera(false);
        }
        logMatchCallDiag("flip_camera_commit_failed", {
          platform: "web",
          desired_facing_mode: desiredFacing,
          video_input_count: availableVideoDeviceCount,
          before,
          after,
        });
        toast.info("No additional camera available to switch to.");
        return;
      }

      setCanFlipCamera(true);
      logMatchCallDiag("flip_camera_committed", {
        platform: "web",
        method: commit.method,
        facing_mode: commit.facingMode,
        local_video_track_id: commit.trackId,
        local_video_device_id: commit.deviceId,
        commit_latency_ms: commit.latencyMs,
      });
    } catch (err) {
      logMatchCallDiag("flip_camera_failed", {
        platform: "web",
        error: describeWebCameraSwitchError(err),
      });
      toast.error("Couldn't switch camera.");
    } finally {
      setIsFlippingCamera(false);
      flipCameraRef.current = false;
    }
  }, [
    callPhase,
    callType,
    isVideoOff,
    readLocalCameraSnapshot,
    waitForWebCameraSwitchCommit,
  ]);

  const adoptIncomingCall = useCallback(
    async (row: MatchCallRow) => {
      const existingIncoming = incomingCallRef.current;
      if (existingIncoming?.callId === row.id) {
        roomNameRef.current = row.daily_room_name ?? roomNameRef.current;
        trackedCallIdRef.current = row.id;
        return;
      }

      const trackedCallId = trackedCallIdRef.current;
      if (trackedCallId && trackedCallId !== row.id) {
        try {
          await transitionCall(row.id, "decline");
        } catch {
          // Busy-line handling is best-effort.
        }
        return;
      }

      const partner = await fetchPartnerSummary(row.caller_id);
      const nextIncoming = {
        callId: row.id,
        matchId: row.match_id,
        callerId: row.caller_id,
        callerName: partner.name,
        callerAvatar: partner.avatarUrl,
        callType: normalizeCallType(row.call_type),
      } satisfies IncomingCallData;

      trackedCallIdRef.current = row.id;
      roomNameRef.current = row.daily_room_name ?? null;
      setCallType(nextIncoming.callType);
      setActiveMatchId(row.match_id);
      setActivePartner(partner);
      setIncomingCall(nextIncoming);
      setCallPhase("idle");
      setCallDuration(0);
      clearRingingTimeout();
      stopDurationTimer();
    },
    [clearRingingTimeout, fetchPartnerSummary, incomingCallRef, stopDurationTimer, transitionCall],
  );

  const joinActiveCall = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      if (!callObjectRef.current && await hasBusyExternalDailyCall("active_rejoin_preflight")) {
        toast.error("Finish your current call before joining");
        return;
      }

      const nextCallType = normalizeCallType(row.call_type);
      if (!callObjectRef.current) {
        const mediaPermission = await requestWebMatchCallMediaPermission(nextCallType);
        if (mediaPermission) {
          logMatchCallDiag("active_rejoin_media_preflight_blocked", {
            call_id: row.id,
            call_type: nextCallType,
            permission_status: mediaPermission.status,
            recovery_action: mediaPermission.recoveryAction,
          });
          setPermissionRecovery({
            kind: "active_rejoin",
            row,
            callType: nextCallType,
            result: mediaPermission,
          });
          return;
        }
      }

      trackedCallIdRef.current = row.id;
      roomNameRef.current = row.daily_room_name ?? null;
      setCallType(nextCallType);
      setActiveMatchId(row.match_id);
      setIncomingCall(null);
      clearRingingTimeout();

      const partnerId = row.caller_id === currentUserId ? row.callee_id : row.caller_id;
      if (!activePartnerRef.current.userId) {
        const partner = await fetchPartnerSummary(partnerId);
        setActivePartner(partner);
      }

      if (callObjectRef.current) {
        setCallPhase("in_call");
        startDurationTimer(row.started_at);
        startHeartbeat();
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("daily-room", {
          body: { action: "join_match_call", callId: row.id },
        });
        const joinEdgeCode = parseMatchCallEdgeCode(data);
        if (error || !data?.token) {
          toast.error(messageForMatchCallEdgeCode(joinEdgeCode) ?? "Couldn't rejoin call");
          await cleanupLocalCall({
            deleteRoomName: row.daily_room_name ?? roomNameRef.current,
            skipRoomDelete: true,
            skipServerTransition: true,
          });
          return;
        }

        await runSingleJoinFlow(row.id, async () => {
          const DailyIframe = await loadDailyIframe();
          const callObject = await createFreshMatchCallObject(
            DailyIframe,
            row.id,
            nextCallType,
            "rejoin_call",
          );
          if (!callObject) return;
          callObjectRef.current = callObject;
          setupCallEvents(callObject, nextCallType);
          setCallPhase("in_call");
          startDurationTimer(row.started_at);

          await callObject.join({ url: data.room_url, token: data.token });

          try {
            await callObject.setLocalAudio(true);
          } catch (err) {
            logMatchCallDiag("set_local_audio_failed", {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            await callObject.setLocalVideo(nextCallType === "video");
          } catch (err) {
            logMatchCallDiag("set_local_video_failed", {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }

          const localParticipant = callObject.participants().local;
          if (localParticipant) {
            renderLocalMedia(localParticipant);
            const audioState = localParticipant.tracks?.audio?.state;
            const videoState = localParticipant.tracks?.video?.state;
            setIsMuted(audioState === "off" || audioState === "blocked");
            setIsVideoOff(
              nextCallType !== "video" ||
                videoState === "off" ||
                videoState === "blocked",
            );
          }
          await transitionCall(row.id, "joined").catch((err) => {
            logMatchCallDiag("active_rejoin_joined_transition_failed", {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          });
          startHeartbeat();
        });
      } catch (err) {
        if (await waitForProviderTeardown("active_rejoin_catch")) return;

        logMatchCallDiag("active_rejoin_failed", {
          call_id: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
        try {
          await transitionCall(row.id, "join_failed");
        } catch {
          // ignore
        }
        await cleanupLocalCall({
          deleteRoomName: row.daily_room_name ?? roomNameRef.current,
          skipServerTransition: true,
        });
      }
    },
    [
      activePartnerRef,
      cleanupLocalCall,
      clearRingingTimeout,
      createFreshMatchCallObject,
      currentUserId,
      fetchPartnerSummary,
      hasBusyExternalDailyCall,
      renderLocalMedia,
      runSingleJoinFlow,
      setupCallEvents,
      startDurationTimer,
      startHeartbeat,
      transitionCall,
      waitForProviderTeardown,
    ],
  );

  const retryPermissionRecovery = useCallback(() => {
    const recovery = permissionRecovery;
    if (!recovery) return;
    setPermissionRecovery(null);
    if (recovery.kind === "answer") {
      if (incomingCallRef.current?.callId !== recovery.callId) {
        toast.error("That call is no longer available");
        return;
      }
      void answerCall();
      return;
    }
    if (recovery.kind === "active_rejoin") {
      void joinActiveCall(recovery.row);
      return;
    }
    void startCall(recovery.params);
  }, [answerCall, incomingCallRef, joinActiveCall, permissionRecovery, startCall]);

  const reconcileCallRow = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      const trackedCallId = trackedCallIdRef.current;
      const isTrackedRow = trackedCallId === row.id || incomingCallRef.current?.callId === row.id;

      if (
        row.status === "active" &&
        !isTrackedRow &&
        (row.caller_id === currentUserId || row.callee_id === currentUserId)
      ) {
        await joinActiveCall(row);
        return;
      }

      if (row.status === "ringing" && row.callee_id === currentUserId) {
        await adoptIncomingCall(row);
        return;
      }

      if (row.status === "ringing" && row.caller_id === currentUserId) {
        trackedCallIdRef.current = row.id;
        roomNameRef.current = row.daily_room_name ?? null;
        setCallType(normalizeCallType(row.call_type));
        setActiveMatchId(row.match_id);
        setCallPhase("ringing");
        if (!activePartnerRef.current.userId) {
          const partner = await fetchPartnerSummary(row.callee_id);
          setActivePartner(partner);
        }
        logMatchCallDiag("reconcile_outbound_ring_restore", {
          call_id: row.id,
          match_id: row.match_id,
        });
        return;
      }

      if (!isTrackedRow) return;

      roomNameRef.current = row.daily_room_name ?? roomNameRef.current;
      setCallType(normalizeCallType(row.call_type));

      if (!activePartnerRef.current.userId) {
        const partnerId = row.caller_id === currentUserId ? row.callee_id : row.caller_id;
        const partner = await fetchPartnerSummary(partnerId);
        setActivePartner(partner);
      }

      switch (row.status) {
        case "ringing":
          if (row.caller_id === currentUserId) {
            setCallPhase("ringing");
            setActiveMatchId(row.match_id);
          }
          break;
        case "active":
          if (
            !callObjectRef.current &&
            !(joiningCallIdRef.current === row.id && joinPromiseRef.current)
          ) {
            await joinActiveCall(row);
          } else {
            clearRingingTimeout();
            setIncomingCall(null);
            setActiveMatchId(row.match_id);
            setCallPhase("in_call");
            startDurationTimer(row.started_at);
            startHeartbeat();
          }
          break;
        case "declined":
        case "missed":
        case "ended": {
          // Capture the rich terminal outcome so the overlay can render a specific
          // banner ("You ended the call." / "Direk declined." / "Connection lost.")
          // before tearing down. The banner state lives for MATCH_CALL_OUTCOME_LINGER_MS.
          const reason = (row.ended_reason ?? null) as MatchCallEndReason | null;
          if (reason) {
            const isCaller = row.caller_id === currentUserId;
            const endedByMe = !!row.ended_by_user_id && row.ended_by_user_id === currentUserId;
            const endedByPartner =
              !!row.ended_by_user_id && row.ended_by_user_id !== currentUserId;
            const partnerName = activePartnerRef.current.name || "Your match";
            const outcome: LastCallOutcome = {
              callId: row.id,
              reason,
              endedByMe,
              endedByPartner,
              partnerName,
              callType: normalizeCallType(row.call_type),
              role: isCaller ? "caller" : "callee",
            };
            setLastOutcome(outcome);
            if (outcomeTimeoutRef.current) clearTimeout(outcomeTimeoutRef.current);
            outcomeTimeoutRef.current = setTimeout(() => {
              setLastOutcome((prev) => (prev?.callId === outcome.callId ? null : prev));
              outcomeTimeoutRef.current = null;
            }, MATCH_CALL_OUTCOME_LINGER_MS);
            logMatchCallDiag("call_terminal_outcome", {
              call_id: row.id,
              reason,
              ended_by_me: endedByMe,
              ended_by_partner: endedByPartner,
              role: outcome.role,
            });
          }
          await cleanupLocalCall({
            deleteRoomName: row.daily_room_name ?? roomNameRef.current,
            skipServerTransition: true,
          });
          break;
        }
      }
    },
    [
      activePartnerRef,
      adoptIncomingCall,
      cleanupLocalCall,
      clearRingingTimeout,
      currentUserId,
      fetchPartnerSummary,
      incomingCallRef,
      joinActiveCall,
      startDurationTimer,
      startHeartbeat,
    ],
  );

  useEffect(() => {
    reconcileCallRowRef.current = reconcileCallRow;
  }, [reconcileCallRow]);

  const queueReconcileCallRow = useCallback((row: MatchCallRow) => {
    // Include ended_reason in the signature so a row that becomes terminal with a
    // populated reason (after a follow-up update) still triggers the outcome banner.
    const signature = `${row.status}:${row.started_at ?? ""}:${row.ended_at ?? ""}:${row.daily_room_name ?? ""}:${row.ended_reason ?? ""}:${row.ended_by_user_id ?? ""}`;
    if (reconcileSignatureByCallIdRef.current.get(row.id) === signature) {
      return;
    }
    reconcileSignatureByCallIdRef.current.set(row.id, signature);
    reconcileQueueRef.current = reconcileQueueRef.current
      .then(async () => {
        await reconcileCallRowRef.current(row);
      })
      .catch((err) => {
        logMatchCallDiag("reconcile_queue_failed", {
          call_id: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      void cleanupLocalCall();
      return;
    }

    let cancelled = false;

    const handlePayload = (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => {
      const row = payload.new ?? payload.old;
      if (!row || cancelled) return;
      queueReconcileCallRow(row);
    };

    const channel = supabase.channel(`match-calls-global-${currentUserId}`);
    const realtimeChannel = channel as unknown as MatchCallRealtimeChannel;

    realtimeChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_calls",
          filter: `callee_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_calls",
          filter: `callee_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_calls",
          filter: `caller_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_calls",
          filter: `caller_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .subscribe();

    void (async () => {
      const sel =
        "id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, started_at, ended_at, duration_seconds, created_at, ended_reason, ended_by_user_id";

      const { data: calleeOpen } = await supabase
        .from("match_calls")
        .select(sel)
        .eq("callee_id", currentUserId)
        .in("status", ["ringing", "active"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      let row = calleeOpen?.[0] as MatchCallRow | undefined;

      if (!row) {
        const { data: callerOpen } = await supabase
          .from("match_calls")
          .select(sel)
          .eq("caller_id", currentUserId)
          .in("status", ["ringing", "active"])
          .order("created_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        row = callerOpen?.[0] as MatchCallRow | undefined;
      }

      if (row) {
        queueReconcileCallRow(row);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [cleanupLocalCall, currentUserId, queueReconcileCallRow]);

  useEffect(() => {
    return () => {
      void cleanupLocalCall();
    };
  }, [cleanupLocalCall]);

  const contextValue = useMemo<MatchCallContextValue>(
    () => ({
      isInCall: callPhase === "in_call",
      isRinging: callPhase === "ringing",
      isReconnecting,
      isMuted,
      isVideoOff,
      audioStatus,
      videoStatus,
      isAudioTogglePending,
      isVideoTogglePending,
      callType,
      callDuration,
      incomingCall,
      lastOutcome,
      localVideoRef,
      remoteVideoRef,
      remoteAudioRef,
      activeMatchId,
      canFlipCamera,
      isFlippingCamera,
      startCall,
      answerCall,
      declineCall,
      markIncomingCallMissed,
      endCall,
      toggleMute,
      toggleVideo,
      flipCamera,
    }),
    [
      activeMatchId,
      answerCall,
      audioStatus,
      callDuration,
      callPhase,
      callType,
      canFlipCamera,
      declineCall,
      endCall,
      flipCamera,
      incomingCall,
      isAudioTogglePending,
      isFlippingCamera,
      isMuted,
      isReconnecting,
      isVideoOff,
      isVideoTogglePending,
      lastOutcome,
      markIncomingCallMissed,
      startCall,
      toggleMute,
      toggleVideo,
      videoStatus,
    ],
  );

  return (
    <MatchCallContext.Provider value={contextValue}>
      {children}

      {permissionRecovery ? (
        <MatchCallPermissionRecoveryDialog
          recovery={permissionRecovery}
          onRetry={retryPermissionRecovery}
          onDismiss={() => setPermissionRecovery(null)}
        />
      ) : null}

      {incomingCall && (
        <IncomingCallOverlay
          incomingCall={incomingCall}
          onAnswer={() => {
            void answerCall();
          }}
          onDecline={() => {
            void declineCall();
          }}
          onTimeout={markIncomingCallMissed}
        />
      )}

      {((callPhase === "ringing" || callPhase === "in_call") && !incomingCall) ||
      lastOutcome ? (
        <ActiveCallOverlay
          isRinging={callPhase === "ringing"}
          isInCall={callPhase === "in_call"}
          isReconnecting={isReconnecting}
          callType={callType}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          audioStatus={audioStatus}
          videoStatus={videoStatus}
          isAudioTogglePending={isAudioTogglePending}
          isVideoTogglePending={isVideoTogglePending}
          callDuration={callDuration}
          partnerName={activePartner.name}
          partnerAvatar={activePartner.avatarUrl ?? undefined}
          localVideoRef={localVideoRef}
          remoteVideoRef={remoteVideoRef}
          remoteAudioRef={remoteAudioRef}
          localStream={localStream}
          canFlipCamera={canFlipCamera}
          isFlippingCamera={isFlippingCamera}
          lastOutcome={lastOutcome}
          onToggleMute={() => {
            void toggleMute();
          }}
          onToggleVideo={() => {
            void toggleVideo();
          }}
          onFlipCamera={() => {
            void flipCamera();
          }}
          onEndCall={() => {
            void endCall();
          }}
        />
      ) : null}
    </MatchCallContext.Provider>
  );
}

export const useMatchCall = ({ matchId, partnerUserId, partnerName, partnerAvatar, onCallEnded }: UseMatchCallOptions) => {
  const context = useContext(MatchCallContext);
  if (!context) {
    throw new Error("useMatchCall must be used within a MatchCallProvider");
  }

  const wasBoundToThreadRef = useRef(false);

  const boundToThisThread = Boolean(
    matchId
      && (context.activeMatchId === matchId || context.incomingCall?.matchId === matchId),
  );

  useEffect(() => {
    if (wasBoundToThreadRef.current && !boundToThisThread) {
      onCallEnded?.();
    }
    wasBoundToThreadRef.current = boundToThisThread;
  }, [boundToThisThread, onCallEnded]);

  const startCall = useCallback(
    async (type: MatchCallType) => {
      if (!matchId) {
        toast.error("No active match for calling");
        return;
      }

      await context.startCall({
        matchId,
        type,
        partnerUserId,
        partnerName,
        partnerAvatar,
      });
    },
    [context, matchId, partnerAvatar, partnerName, partnerUserId],
  );

  return {
    ...context,
    startCall,
  };
};
