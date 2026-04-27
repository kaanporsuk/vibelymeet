import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import {
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import type { DailyRoomFailureKind } from "@clientShared/matching/dailyRoomFailure";
import type { PreparedVideoDateEntryCacheEntry } from "@clientShared/matching/videoDatePrepareEntry";

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

type DailyRoomSuccessResponse = {
  room_name: string;
  room_url: string;
  token: string;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_verify_skipped?: boolean;
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
  const activePreparedEntryCacheRef = useRef<PreparedVideoDateEntryCacheEntry | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const markRemoteFirstFrameRendered = useCallback((source: string) => {
    const nowMs = Date.now();
    const entry = activePreparedEntryCacheRef.current;
    const bothReadyToFirstRemoteFrameMs =
      entry?.bothReadyObservedAtMs == null ? null : Math.max(0, nowMs - entry.bothReadyObservedAtMs);
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
      bothReadyToFirstRemoteFrameMs,
    });
    if (optionsRef.current?.roomId) {
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId: optionsRef.current.roomId,
        platform: "web",
        eventId: optionsRef.current.eventId ?? null,
        sourceSurface: "video_date_daily",
        checkpoint: "first_remote_frame",
        nowMs,
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
    }
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME, {
      platform: "web",
      session_id: optionsRef.current?.roomId ?? null,
      event_id: optionsRef.current?.eventId ?? null,
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
      activePreparedEntryCacheRef.current = null;
      dailyJoinStartedAtMsRef.current = null;
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
      | { ok: true; roomData: DailyRoomSuccessResponse; cacheEntry: PreparedVideoDateEntryCacheEntry; cached: boolean }
      | {
          ok: false;
          failure: VideoCallStartFailure;
        }
    > => {
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
          };
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
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow?.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: "daily_token_failure",
          code: result.code,
          reason_code: result.code,
          retryable: result.retryable,
          attempt: attempt + 1,
          attempt_count: attempt + 1,
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
        activePreparedEntryCacheRef.current = roomResult.cacheEntry;

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
            if (!reconnectPartnerAwayTriggeredRef.current) {
              reconnectPartnerAwayTriggeredRef.current = true;
              optionsRef.current?.onPartnerLeft?.();
            }
          };
          setDailyReconnectState("interrupted");
          setReconnectGraceTimeLeft(remainingSeconds());
          logTransportState("daily_transport_disconnected", { reason });
          logTransportState("reconnect_grace_started", { reason, graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS });
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
          prepareToJoinStartMs,
          cachedPrepareEntry: roomResult.cached,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: opts?.internalRetry ? "daily_join_retry_started" : "daily_join_started",
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          cached_prepare_entry: roomResult.cached,
        });
        await callObject.join({ url: roomData.room_url, token: roomData.token });
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        setHasPermission(true);
        activeCallSessionIdRef.current = sessionId;
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          joinDurationMs,
        });
        const joinSuccessLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: truthRow.event_id ?? eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_success",
          nowMs: Date.now(),
          attemptCount: opts?.internalRetry ? 2 : 1,
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
          joinDurationMs,
          duration_ms: joinDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(joinDurationMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          bothReadyToDailyJoinMs: joinSuccessPayload.bothReadyToDailyJoinMs,
          prepareToJoinStartMs,
          cached_prepare_entry: roomResult.cached,
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
        const preparedEntryAtFailure = activePreparedEntryCacheRef.current;
        vdbg("daily_join_failure", {
          sessionId,
          eventId,
          userId,
          roomName: roomNameRef.current,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "video_date_daily",
          source_action: "daily_join_failure",
          reason: "daily_join_failed",
          reason_code: "daily_join_failed",
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
