import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
  type DailyRoomFailureClassification,
  type DailyRoomFailureKind,
} from "@clientShared/matching/dailyRoomFailure";

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

const VIDEO_DATE_PREJOIN_TIMEOUT_MS = 12_000;
const FIRST_REMOTE_TIMEOUT_MS = 25_000;
const CREATE_DATE_ROOM_RETRY_DELAYS_MS = [700, 1_600] as const;
const DAILY_TRANSPORT_RECONNECT_GRACE_MS = 12_000;

type VideoDateTruthRow = {
  id: string;
  event_id: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
  handshake_started_at: string | null;
  daily_room_name: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
};

type DailyRoomResponse = {
  room_name?: string;
  room_url?: string;
  token?: string;
  code?: string;
  error?: string;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
};

type DailyRoomSuccessResponse = DailyRoomResponse & {
  room_name: string;
  room_url: string;
  token: string;
};

export type VideoCallStartFailure = {
  kind: DailyRoomFailureKind | "daily_join_failed" | "session_unavailable";
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

function isInvokeTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out after/i.test(error.message);
}

function failureFromTransitionCode(code?: string): VideoCallStartFailure {
  if (code === "READY_GATE_NOT_READY") return { kind: "READY_GATE_NOT_READY", retryable: false, serverCode: code };
  if (code === "BLOCKED_PAIR" || code === "blocked_pair") return { kind: "BLOCKED_PAIR", retryable: false, serverCode: code };
  if (code === "ACCESS_DENIED") return { kind: "ACCESS_DENIED", retryable: false, serverCode: code };
  if (code === "SESSION_ENDED") return { kind: "SESSION_ENDED", retryable: false, serverCode: code };
  if (code === "SESSION_NOT_FOUND") return { kind: "SESSION_NOT_FOUND", retryable: false, serverCode: code };
  return { kind: "session_unavailable", retryable: false, serverCode: code };
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
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [networkTier, setNetworkTier] = useState<VideoCallNetworkTier>("good");
  const [remotePlayback, setRemotePlayback] = useState<RemotePlaybackState>(() => createRemotePlaybackState());
  const [dailyReconnectState, setDailyReconnectState] = useState<DailyReconnectState>("connected");
  const [reconnectGraceTimeLeft, setReconnectGraceTimeLeft] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  const firstRemoteObservedRef = useRef(false);
  const lastLocalTrackIdsRef = useRef<string>("");
  const lastLocalStreamRef = useRef<MediaStream | null>(null);
  const lastRemoteTrackIdsRef = useRef<string>("");
  const lastRemoteStreamRef = useRef<MediaStream | null>(null);
  const lastLocalMountedTrackKeyRef = useRef<string>("");
  const lastRemoteMountedTrackKeyRef = useRef<string>("");
  const firstRemoteWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noRemoteAutoRecoveryUsedRef = useRef(false);
  const startAttemptNonceRef = useRef(0);
  const startCallInFlightSessionRef = useRef<string | null>(null);
  const activeCallSessionIdRef = useRef<string | null>(null);
  const latestLocalParticipantRef = useRef<DailyParticipant | undefined>(undefined);
  const latestRemoteParticipantRef = useRef<DailyParticipant | undefined>(undefined);
  const reconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectGraceTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectGraceActiveRef = useRef(false);
  const reconnectPartnerAwayTriggeredRef = useRef(false);
  const reconnectSyncRequestedRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

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
    vdbg("daily_remote_first_frame_rendered", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      source,
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
                setRemotePlayback((prev) => ({
                  ...prev,
                  playSucceeded: true,
                  playRejected: false,
                  error: undefined,
                }));
              })
              .catch((error: unknown) => {
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
      const videoTrackId = opts.participant?.tracks?.video?.persistentTrack?.id ?? "";
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
        videoTrackId: videoTrackId || null,
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

  const clearReconnectGraceTimers = useCallback(() => {
    if (reconnectGraceTimeoutRef.current) {
      clearTimeout(reconnectGraceTimeoutRef.current);
      reconnectGraceTimeoutRef.current = null;
    }
    if (reconnectGraceTickerRef.current) {
      clearInterval(reconnectGraceTickerRef.current);
      reconnectGraceTickerRef.current = null;
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
      clearReconnectGraceTimers();
      reconnectGraceActiveRef.current = false;
      reconnectPartnerAwayTriggeredRef.current = false;
      reconnectSyncRequestedRef.current = false;
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
    },
    [clearFirstRemoteWatchdog, clearReconnectGraceTimers]
  );

  const fetchVideoDateTruth = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from("video_sessions")
      .select(
        "id, event_id, ended_at, state, phase, handshake_started_at, daily_room_name, ready_gate_status, ready_gate_expires_at",
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
      | { ok: true; roomData: DailyRoomSuccessResponse }
      | {
          ok: false;
          failure: VideoCallStartFailure;
        }
    > => {
      let lastFailure: (VideoCallStartFailure & DailyRoomFailureClassification) | null = null;

      for (let attempt = 0; attempt <= CREATE_DATE_ROOM_RETRY_DELAYS_MS.length; attempt += 1) {
        const createRoomArgs = { action: "create_date_room", sessionId };
        try {
          vdbg("daily_room_before", {
            action: "create_date_room",
            args: createRoomArgs,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            timeoutMs: VIDEO_DATE_PREJOIN_TIMEOUT_MS,
            attempt: attempt + 1,
          });
          const { data: roomData, error: roomError, response } = await withTimeout(
            "daily_room",
            supabase.functions.invoke<DailyRoomResponse>("daily-room", { body: createRoomArgs }),
            VIDEO_DATE_PREJOIN_TIMEOUT_MS
          );

          if (!roomError && roomData?.token && roomData.room_name && roomData.room_url) {
            const successfulRoomData: DailyRoomSuccessResponse = {
              ...roomData,
              token: roomData.token,
              room_name: roomData.room_name,
              room_url: roomData.room_url,
            };
            vdbg("daily_room_after", {
              action: "create_date_room",
              ok: true,
              sessionId,
              eventId: truthRow?.event_id ?? eventId,
              userId,
              roomName: successfulRoomData.room_name,
              hasToken: true,
              reusedRoom: successfulRoomData.reused_room ?? null,
              providerRoomRecreated: successfulRoomData.provider_room_recreated ?? null,
              attempt: attempt + 1,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow?.event_id ?? eventId,
              reused_room: successfulRoomData.reused_room === true,
              provider_room_recreated: successfulRoomData.provider_room_recreated === true,
              attempt: attempt + 1,
            });
            return { ok: true, roomData: successfulRoomData };
          }

          const failure = await classifyDailyRoomInvokeFailure({
            action: DAILY_ROOM_ACTIONS.CREATE,
            data: roomData,
            invokeError: roomError,
            response,
          });
          lastFailure = {
            ...failure,
            kind: failure.kind,
            retryable: failure.retryable,
          };
          vdbg("daily_room_after", {
            action: "create_date_room",
            ok: false,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: roomData?.room_name ?? null,
            hasToken: Boolean(roomData?.token),
            reusedRoom: roomData?.reused_room ?? null,
            providerRoomRecreated: roomData?.provider_room_recreated ?? null,
            httpStatus: failure.httpStatus ?? null,
            serverCode: failure.serverCode ?? roomData?.code ?? null,
            classifiedCode: failure.kind,
            retryable: failure.retryable,
            attempt: attempt + 1,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            code: failure.kind,
            retryable: failure.retryable,
            attempt: attempt + 1,
          });
        } catch (error) {
          const failure = await classifyDailyRoomInvokeFailure({
            action: DAILY_ROOM_ACTIONS.CREATE,
            timedOut: isInvokeTimeoutError(error),
            invokeError: error,
          });
          lastFailure = {
            ...failure,
            kind: failure.kind,
            retryable: failure.retryable,
          };
          vdbg("daily_room_after", {
            action: "create_date_room",
            ok: false,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            httpStatus: failure.httpStatus ?? null,
            serverCode: failure.serverCode ?? null,
            classifiedCode: failure.kind,
            retryable: failure.retryable,
            attempt: attempt + 1,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            code: failure.kind,
            retryable: failure.retryable,
            attempt: attempt + 1,
          });
        }

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
          action: "create_date_room",
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
      setRemotePlayback(createRemotePlaybackState());
      firstRemoteObservedRef.current = false;
      clearFirstRemoteWatchdog();
      startAttemptNonceRef.current += 1;
      const startNonce = startAttemptNonceRef.current;
      if (!opts?.internalRetry) {
        noRemoteAutoRecoveryUsedRef.current = false;
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
        let truthRow = initialTruthRow;
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

        const syncArgs = { p_session_id: sessionId, p_action: "sync_reconnect" };
        vdbg("video_date_transition_before", { action: "sync_reconnect", args: syncArgs });
        const { data: syncData, error: syncError } = await supabase.rpc("video_date_transition", syncArgs);
        vdbg("video_date_transition_after", {
          action: "sync_reconnect",
          ok: !syncError,
          payload: syncData ?? null,
          error: syncError ? { code: syncError.code, message: syncError.message } : null,
        });
        if (syncError || (syncData as { ended?: boolean } | null)?.ended === true) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: {
              kind: (syncData as { ended?: boolean } | null)?.ended === true ? "SESSION_ENDED" : "session_unavailable",
              retryable: false,
            },
          } as VideoCallStartResult;
        }

        if (!videoSessionRowIndicatesHandshakeOrDate(truthRow)) {
          const enterHandshakeArgs = { p_session_id: sessionId, p_action: "enter_handshake" };
          vdbg("video_date_transition_before", { action: "enter_handshake", args: enterHandshakeArgs });
          const { data: enterData, error: enterError } = await withTimeout(
            "enter_handshake",
            (async () => supabase.rpc("video_date_transition", enterHandshakeArgs))(),
            VIDEO_DATE_PREJOIN_TIMEOUT_MS
          );
          vdbg("video_date_transition_after", {
            action: "enter_handshake",
            ok: !enterError && (enterData as { success?: boolean } | null)?.success !== false,
            payload: enterData ?? null,
            error: enterError ? { code: enterError.code, message: enterError.message } : null,
          });
          trackEvent(
            !enterError && (enterData as { success?: boolean } | null)?.success !== false
              ? LobbyPostDateEvents.VIDEO_DATE_ENTER_HANDSHAKE_SUCCESS
              : LobbyPostDateEvents.VIDEO_DATE_ENTER_HANDSHAKE_FAILURE,
            {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              code: (enterData as { code?: string } | null)?.code ?? null,
            },
          );
          if (enterError || (enterData as { success?: boolean } | null)?.success === false) {
            setIsConnecting(false);
            return {
              ok: false,
              failure: failureFromTransitionCode(
                (enterData as { code?: string } | null)?.code ?? (enterError ? "RPC_ERROR" : undefined)
              ),
            } as VideoCallStartResult;
          }
        } else {
          vdbg("video_date_transition_skipped", {
            action: "enter_handshake",
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            reason: "handshake_or_date_already_authoritative",
            state: truthRow.state,
            phase: truthRow.phase,
            handshakeStarted: Boolean(truthRow.handshake_started_at),
          });
        }

        const { truth: fencedTruthRow, error: fencedTruthError } = await fetchVideoDateTruth(sessionId);
        truthRow = fencedTruthRow ?? truthRow;
        vdbg("date_prejoin_truth_fence", {
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          row: truthRow ?? null,
          error: fencedTruthError ? { code: fencedTruthError.code, message: fencedTruthError.message } : null,
        });

        if (fencedTruthError || !truthRow) {
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

        if (!canAttemptDailyRoomFromVideoSessionTruth(truthRow)) {
          vdbg("daily_room_before_skipped", {
            action: "create_date_room",
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            reason: "client_daily_gate_not_startable",
            state: truthRow.state,
            phase: truthRow.phase,
            handshakeStartedAt: truthRow.handshake_started_at,
            readyGateStatus: truthRow.ready_gate_status ?? null,
            readyGateExpiresAt: truthRow.ready_gate_expires_at ?? null,
          });
          setIsConnecting(false);
          return {
            ok: false,
            failure: failureFromTransitionCode("READY_GATE_NOT_READY"),
          } as VideoCallStartResult;
        }

        const roomResult = await acquireDateRoom(
          sessionId,
          truthRow.event_id ?? eventId,
          userId,
          truthRow
        );
        if (roomResult.ok === false) {
          setIsConnecting(false);
          return { ok: false, failure: roomResult.failure } as VideoCallStartResult;
        }
        const roomData = roomResult.roomData;

        roomNameRef.current = roomData.room_name;

        const callObject = DailyIframe.createCallObject({
          audioSource: true,
          videoSource: true,
        });
        callObjectRef.current = callObject;
        vdbg("daily_call_object_created", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          reusedCallObject: false,
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
            optionsRef.current?.onPartnerTransientRecover?.();
            setTimeout(() => {
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
          setDailyReconnectState("interrupted");
          setReconnectGraceTimeLeft(Math.ceil(DAILY_TRANSPORT_RECONNECT_GRACE_MS / 1000));
          logTransportState("daily_transport_disconnected", { reason });
          logTransportState("reconnect_grace_started", { reason, graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS });
          optionsRef.current?.onPartnerTransientDisconnect?.();
          void syncReconnectOnce(reason);

          reconnectGraceTickerRef.current = setInterval(() => {
            setReconnectGraceTimeLeft((prev) => Math.max(0, prev - 1));
          }, 1000);

          reconnectGraceTimeoutRef.current = setTimeout(() => {
            clearReconnectGraceTimers();
            reconnectGraceActiveRef.current = false;
            reconnectSyncRequestedRef.current = false;
            setReconnectGraceTimeLeft(0);
            setDailyReconnectState("failed_after_grace");
            logTransportState("reconnect_grace_expired", { reason });
            if (!reconnectPartnerAwayTriggeredRef.current) {
              reconnectPartnerAwayTriggeredRef.current = true;
              optionsRef.current?.onPartnerLeft?.();
            }
          }, DAILY_TRANSPORT_RECONNECT_GRACE_MS);
        };

        const recoverTransport = (reason: string) => {
          if (!reconnectGraceActiveRef.current) return;
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
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source: "participant_joined",
              });
            }
            setIsConnected(true);
            setIsConnecting(false);
            toast.success("Connected! Your video date is live 🎉");
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
            }
            const remoteKey = getTrackIdsKey(event.participant, true);
            const remoteKeyChanged = remoteKey !== lastRemoteTrackIdsRef.current;
            if (remoteKeyChanged) {
              lastRemoteTrackIdsRef.current = remoteKey;
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
              attachTracks(event.participant, remoteVideoRef.current, false);
              logTrackMounted("participant_updated_reattach", {
                isLocal: false,
                participant: event.participant,
                roomName: roomData.room_name ?? null,
              });
            }
          }
        });

        callObject.on("participant-left", (event) => {
          if (event && !event.participant?.local) {
            setIsConnected(false);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            setRemotePlayback(createRemotePlaybackState());
            if (reconnectGraceActiveRef.current) {
              logTransportState("daily_transport_reconnecting", {
                reason: "participant_left_during_grace",
              });
            } else {
              optionsRef.current?.onPartnerLeft?.();
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
          logTransportState("daily_app_message", {
            hasData: Boolean(event && typeof event === "object" && "data" in (event as object)),
          });
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

        vdbg("daily_join_start", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          hasToken: Boolean(roomData.token),
        });
        await callObject.join({ url: roomData.room_url, token: roomData.token });
        setHasPermission(true);
        activeCallSessionIdRef.current = sessionId;
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOINED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
        });

        const joinedArgs = { p_session_id: sessionId };
        vdbg("mark_video_date_daily_joined_before", {
          args: joinedArgs,
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
        });
        const { data: joinedData, error: joinedError } = await supabase.rpc(
          "mark_video_date_daily_joined",
          joinedArgs
        );
        vdbg("mark_video_date_daily_joined_after", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          ok: !joinedError && (joinedData as { ok?: boolean } | null)?.ok === true,
          payload: joinedData ?? null,
          error: joinedError ? { code: joinedError.code, message: joinedError.message } : null,
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
        }

        const participants = callObject.participants();
        const remoteParticipants = Object.values(participants).filter((p) => !p.local);
        if (remoteParticipants.length > 0) {
          latestRemoteParticipantRef.current = remoteParticipants[0];
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
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source: "post_join_snapshot",
            });
          }
          setIsConnected(true);
          setIsConnecting(false);
          toast.success("Connected! Your video date is live 🎉");
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
            autoRecoveryUsed: noRemoteAutoRecoveryUsedRef.current,
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
              autoRecoveryUsed: noRemoteAutoRecoveryUsedRef.current,
            });
            if (!noRemoteAutoRecoveryUsedRef.current) {
              noRemoteAutoRecoveryUsedRef.current = true;
              void (async () => {
                await cleanupCallObject("startCall", "no_remote_auto_recovery");
                vdbg("daily_no_remote_watchdog_recovery", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  result: "rejoin_scheduled",
                });
                void startCall(sessionId, { internalRetry: true });
              })();
              return;
            }
            setIsConnecting(false);
            setIsConnected(false);
            toast.error("Your match has not joined this video room yet.");
          }, FIRST_REMOTE_TIMEOUT_MS);
        }

        return { ok: true } as VideoCallStartResult;
      } catch (error) {
        console.error("[Daily] Failed to start call:", error);
        vdbg("daily_join_failure", {
          sessionId,
          eventId,
          userId,
          roomName: roomNameRef.current,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
        await cleanupCallObject("startCall", "start_failure");
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
      needsTrackReattach,
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
    networkTier,
    remotePlayback,
    dailyReconnectState,
    reconnectGraceTimeLeft,
    localVideoRef,
    remoteVideoRef,
    localStream,
    startCall,
    endCall,
    retryRemotePlayback,
    toggleMute,
    toggleVideo,
    getRoomName,
  };
};
