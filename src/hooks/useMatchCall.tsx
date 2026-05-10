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

const MATCH_CALL_HEARTBEAT_MS = 15_000;
const MATCH_CALL_REMOTE_RECONNECT_GRACE_MS = 30_000;

type MatchCallCleanupOptions = {
  deleteRoomName?: string | null;
  skipRoomDelete?: boolean;
  /** When true, `match_call_transition` was already applied (or DB row is already terminal). */
  skipServerTransition?: boolean;
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

type MatchCallContextValue = {
  isInCall: boolean;
  isRinging: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  callType: MatchCallType;
  callDuration: number;
  incomingCall: IncomingCallData | null;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  activeMatchId: string | null;
  startCall: (params: StartCallParams) => Promise<void>;
  answerCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  markIncomingCallMissed: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
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

export function MatchCallProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const currentUserId = user?.id ?? null;

  const [callPhase, setCallPhase] = useState<MatchCallPhase>("idle");
  const [callType, setCallType] = useState<MatchCallType>("video");
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [activePartner, setActivePartner] = useState<PartnerSummary>(DEFAULT_PARTNER);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const callObjectRef = useRef<DailyCall | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const startCallAttemptRef = useRef(0);
  const startCallLockRef = useRef(false);
  const joiningCallIdRef = useRef<string | null>(null);
  const joinPromiseRef = useRef<Promise<void> | null>(null);
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

  const callPhaseRef = useLatestRef(callPhase);
  const incomingCallRef = useLatestRef(incomingCall);
  const activePartnerRef = useLatestRef(activePartner);
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
   * Render local participant media to localVideoRef. Local audio is intentionally NOT
   * piped through any audio element (would cause echo); Daily publishes the local mic
   * to the remote, that's it.
   */
  const renderLocalMedia = useCallback(
    (participant: DailyParticipant | undefined) => {
      const videoEl = localVideoRef.current;
      if (!videoEl || !participant?.tracks) return;

      const videoTrackState = participant.tracks.video?.state;
      const videoTrack =
        videoTrackState === "playable" ? participant.tracks.video?.persistentTrack ?? null : null;

      if (videoTrack) {
        const current = videoEl.srcObject as MediaStream | null;
        const currentVideoTrack = current?.getVideoTracks?.()[0] ?? null;
        if (currentVideoTrack !== videoTrack) {
          const stream = new MediaStream([videoTrack]);
          videoEl.srcObject = stream;
          setLocalStream(stream);
        }
      } else if (videoEl.srcObject) {
        videoEl.srcObject = null;
        setLocalStream(null);
      }
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
    const { data } = await supabase
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", profileId)
      .maybeSingle();

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

  const transitionCall = useCallback(async (callId: string, action: MatchCallAction) => {
    const { data, error } = await supabase.rpc("match_call_transition", {
      p_call_id: callId,
      p_action: action,
    });
    if (error) {
      throw error;
    }
    const result = (data ?? null) as MatchCallTransitionResult | null;
    if (result?.ok === false) {
      throw new Error(`match_call_transition rejected: ${result.code ?? "unknown"}`);
    }
    return result;
  }, []);

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
    async ({ deleteRoomName, skipRoomDelete = false, skipServerTransition = false }: MatchCallCleanupOptions = {}) => {
      const shouldAttemptAbnormalRpc =
        !skipServerTransition && !documentUnloadRpcIssuedRef.current && trackedCallIdRef.current;

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
      documentUnloadRpcIssuedRef.current = false;

      clearRingingTimeout();
      clearRemoteReconnectGrace();
      stopHeartbeat();
      stopDurationTimer();

      const callObject = callObjectRef.current;
      // Null the ref BEFORE awaiting leave/destroy so any re-entrant call sees a clean
      // slate and skips its own create. Without this, leave()/destroy() race a new
      // createCallObject and Daily prints "multiple call instances" warnings.
      callObjectRef.current = null;
      if (callObject) {
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
      }

      clearVideoElements();

      const roomName = deleteRoomName ?? roomNameRef.current;
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

      if (roomName && !skipRoomDelete) {
        await deleteRoom(roomName);
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
      if (callObjectRef.current && trackedCallIdRef.current === callId) {
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

  const endCall = useCallback(async () => {
    const callId = trackedCallIdRef.current;
    const roomName = roomNameRef.current;

    if (callId) {
      try {
        await transitionCall(callId, "end");
      } catch {
        // Backend reconciliation will still arrive over realtime when available.
      }
    }

    await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
  }, [cleanupLocalCall, transitionCall]);

  const setupCallEvents = useCallback(
    (callObject: DailyCall, currentCallType: MatchCallType) => {
      callObject.on("joined-meeting", () => {
        logMatchCallDiag("joined_meeting", { call_type: currentCallType });
        refreshAllParticipantMedia();
      });

      callObject.on("participant-joined", (event) => {
        if (!event?.participant || event.participant.local) return;
        clearRingingTimeout();
        clearRemoteReconnectGrace();
        setCallPhase("in_call");
        startDurationTimer();
        startHeartbeat();
        renderRemoteMedia(event.participant);
        toast.success(currentCallType === "voice" ? "Voice call connected" : "Video call connected");
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
        toast.info("Connection interrupted. Waiting for them to reconnect...");
        remoteReconnectTimeoutRef.current = setTimeout(() => {
          remoteReconnectTimeoutRef.current = null;
          if (callPhaseRef.current !== "in_call" || !trackedCallIdRef.current) return;
          void endCall();
        }, MATCH_CALL_REMOTE_RECONNECT_GRACE_MS);
      });

      callObject.on("error", (event) => {
        console.error("[MatchCall] Daily error:", event);
        logMatchCallDiag("daily_error", {
          message: event && typeof event === "object" && "errorMsg" in event ? String((event as { errorMsg?: unknown }).errorMsg ?? "") : null,
        });
        toast.error("Call connection error");
        void endCall();
      });

      callObject.on("left-meeting", () => {
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase("idle");
        // Null the ref under the same atomic block as the cleanup so that any subsequent
        // start/answer/join sees a clean slate rather than racing the leftover ref.
        callObjectRef.current = null;
      });
    },
    [
      callPhaseRef,
      clearRemoteReconnectGrace,
      clearRingingTimeout,
      endCall,
      refreshAllParticipantMedia,
      renderLocalMedia,
      renderRemoteMedia,
      startHeartbeat,
      startDurationTimer,
      stopDurationTimer,
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
        if (callObjectRef.current) {
          logMatchCallDiag("answer_call_skipped_duplicate_join", {
            call_id: pendingIncoming.callId,
          });
          return;
        }
        const DailyIframe = await loadDailyIframe();
        const callObject = DailyIframe.createCallObject(
          dailyCallObjectOptions({
            audioSource: true,
            videoSource: pendingIncoming.callType === "video",
          })
        );
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
    incomingCallRef,
    renderLocalMedia,
    runSingleJoinFlow,
    setupCallEvents,
    startDurationTimer,
    startHeartbeat,
    transitionCall,
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
          await cleanupLocalCall({ skipServerTransition: true });
          toast.info(`${(partnerName ?? "Your match").trim() || "Your match"} is calling — answer or decline.`);
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
          if (callObjectRef.current) {
            logMatchCallDiag("start_call_skipped_duplicate_join", {
              call_id: callId,
              match_id: matchId,
            });
            return;
          }
          const DailyIframe = await loadDailyIframe();
          const callObject = DailyIframe.createCallObject(
            dailyCallObjectOptions({
              audioSource: true,
              videoSource: effectiveType === "video",
            })
          );
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
      deleteRoom,
      incomingCallRef,
      renderLocalMedia,
      setupCallEvents,
      runSingleJoinFlow,
      startHeartbeat,
      transitionCall,
    ],
  );

  const toggleMute = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const nextMuted = !isMuted;
    callObject.setLocalAudio(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const nextVideoOff = !isVideoOff;
    callObject.setLocalVideo(!nextVideoOff);
    setIsVideoOff(nextVideoOff);
  }, [isVideoOff]);

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

      trackedCallIdRef.current = row.id;
      roomNameRef.current = row.daily_room_name ?? null;
      const nextCallType = normalizeCallType(row.call_type);
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
          if (callObjectRef.current) {
            logMatchCallDiag("rejoin_skipped_duplicate_join", {
              call_id: row.id,
            });
            return;
          }
          const DailyIframe = await loadDailyIframe();
          const callObject = DailyIframe.createCallObject(
            dailyCallObjectOptions({
              audioSource: true,
              videoSource: nextCallType === "video",
            })
          );
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
      currentUserId,
      fetchPartnerSummary,
      renderLocalMedia,
      runSingleJoinFlow,
      setupCallEvents,
      startDurationTimer,
      startHeartbeat,
      transitionCall,
    ],
  );

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
        case "ended":
          await cleanupLocalCall({
            deleteRoomName: row.daily_room_name ?? roomNameRef.current,
            skipServerTransition: true,
          });
          break;
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
    const signature = `${row.status}:${row.started_at ?? ""}:${row.ended_at ?? ""}:${row.daily_room_name ?? ""}`;
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
        "id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, started_at, ended_at, duration_seconds, created_at";

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
      isMuted,
      isVideoOff,
      callType,
      callDuration,
      incomingCall,
      localVideoRef,
      remoteVideoRef,
      remoteAudioRef,
      activeMatchId,
      startCall,
      answerCall,
      declineCall,
      markIncomingCallMissed,
      endCall,
      toggleMute,
      toggleVideo,
    }),
    [
      activeMatchId,
      answerCall,
      callDuration,
      callPhase,
      callType,
      declineCall,
      endCall,
      incomingCall,
      isMuted,
      isVideoOff,
      markIncomingCallMissed,
      startCall,
      toggleMute,
      toggleVideo,
    ],
  );

  return (
    <MatchCallContext.Provider value={contextValue}>
      {children}

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

      {(callPhase === "ringing" || callPhase === "in_call") && !incomingCall && (
        <ActiveCallOverlay
          isRinging={callPhase === "ringing"}
          isInCall={callPhase === "in_call"}
          callType={callType}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          callDuration={callDuration}
          partnerName={activePartner.name}
          partnerAvatar={activePartner.avatarUrl ?? undefined}
          localVideoRef={localVideoRef}
          remoteVideoRef={remoteVideoRef}
          remoteAudioRef={remoteAudioRef}
          localStream={localStream}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onEndCall={() => {
            void endCall();
          }}
        />
      )}
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
