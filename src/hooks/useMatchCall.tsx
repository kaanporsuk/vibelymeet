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
import DailyIframe, { type DailyCall, type DailyParticipant } from "@daily-co/daily-js";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { IncomingCallOverlay } from "@/components/chat/IncomingCallOverlay";
import { ActiveCallOverlay } from "@/components/chat/ActiveCallOverlay";

type MatchCallStatus = "ringing" | "active" | "ended" | "missed" | "declined";
type MatchCallType = "voice" | "video";
type MatchCallPhase = "idle" | "ringing" | "in_call";
type MatchCallAction = "answer" | "decline" | "end" | "mark_missed";

type MatchCallCleanupOptions = {
  deleteRoomName?: string | null;
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

  const callObjectRef = useRef<DailyCall | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const accessTokenRef = useRef<string | null>(null);
  /** When true, `pagehide`/`beforeunload` already posted a keepalive RPC; skip duplicate in `cleanupLocalCall`. */
  const documentUnloadRpcIssuedRef = useRef(false);

  const callPhaseRef = useLatestRef(callPhase);
  const incomingCallRef = useLatestRef(incomingCall);
  const activePartnerRef = useLatestRef(activePartner);

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
  }, []);

  const attachTracks = useCallback(
    (participant: DailyParticipant | undefined, videoEl: HTMLVideoElement | null, isLocal: boolean) => {
      if (!videoEl || !participant?.tracks) return;
      const stream = new MediaStream();
      const videoTrack = participant.tracks.video?.persistentTrack;
      const audioTrack = participant.tracks.audio?.persistentTrack;
      if (videoTrack) stream.addTrack(videoTrack);
      if (audioTrack && !isLocal) stream.addTrack(audioTrack);
      videoEl.srcObject = stream;
    },
    [],
  );

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
    return (data ?? null) as MatchCallTransitionResult | null;
  }, []);

  const cleanupLocalCall = useCallback(
    async ({ deleteRoomName, skipServerTransition = false }: MatchCallCleanupOptions = {}) => {
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
          } catch {
            // Best-effort; cron / peer may still reconcile.
          }
        }
      }
      documentUnloadRpcIssuedRef.current = false;

      clearRingingTimeout();
      stopDurationTimer();

      const callObject = callObjectRef.current;
      if (callObject) {
        try {
          await callObject.leave();
        } catch {
          // ignore
        }
        try {
          callObject.destroy();
        } catch {
          // ignore
        }
        callObjectRef.current = null;
      }

      clearVideoElements();

      const roomName = deleteRoomName ?? roomNameRef.current;
      trackedCallIdRef.current = null;
      roomNameRef.current = null;
      setCallPhase("idle");
      setIncomingCall(null);
      setActiveMatchId(null);
      setActivePartner(DEFAULT_PARTNER);
      setCallDuration(0);
      setIsMuted(false);
      setIsVideoOff(false);

      if (roomName) {
        await deleteRoom(roomName);
      }
    },
    [
      callPhaseRef,
      clearRingingTimeout,
      clearVideoElements,
      deleteRoom,
      incomingCallRef,
      stopDurationTimer,
      transitionCall,
    ],
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
      callObject.on("participant-joined", (event) => {
        if (!event?.participant || event.participant.local) return;
        clearRingingTimeout();
        setCallPhase("in_call");
        startDurationTimer();
        attachTracks(event.participant, remoteVideoRef.current, false);
        toast.success(currentCallType === "voice" ? "Voice call connected" : "Video call connected");
      });

      callObject.on("participant-updated", (event) => {
        if (!event?.participant) return;
        if (event.participant.local) {
          attachTracks(event.participant, localVideoRef.current, true);
        } else {
          attachTracks(event.participant, remoteVideoRef.current, false);
        }
      });

      callObject.on("participant-left", (event) => {
        if (!event?.participant || event.participant.local) return;
        void endCall();
      });

      callObject.on("error", (event) => {
        console.error("[MatchCall] Daily error:", event);
        toast.error("Call connection error");
        void endCall();
      });

      callObject.on("left-meeting", () => {
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase("idle");
      });
    },
    [attachTracks, clearRingingTimeout, endCall, startDurationTimer, stopDurationTimer],
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
    try {
      const { data, error } = await supabase.functions.invoke("daily-room", {
        body: { action: "answer_match_call", callId: pendingIncoming.callId },
      });

      if (error || !data?.token) {
        toast.error("Couldn't connect call");
        const failedId = pendingIncoming.callId;
        try {
          await transitionCall(failedId, "mark_missed");
        } catch {
          // ignore
        }
        await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
        return;
      }

      answeredRoomName = data.room_name ?? roomNameRef.current;
      roomNameRef.current = answeredRoomName;
      trackedCallIdRef.current = pendingIncoming.callId;
      setCallType(pendingIncoming.callType);
      setCallPhase("in_call");
      setIncomingCall(null);
      startDurationTimer();

      const callObject = DailyIframe.createCallObject({
        audioSource: true,
        videoSource: pendingIncoming.callType === "video",
      });
      callObjectRef.current = callObject;
      setupCallEvents(callObject, pendingIncoming.callType);

      await callObject.join({ url: data.room_url, token: data.token });
      const localParticipant = callObject.participants().local;
      if (localParticipant) {
        attachTracks(localParticipant, localVideoRef.current, true);
      }
    } catch (error) {
      console.error("[MatchCall] Answer error:", error);
      toast.error("Couldn't connect call");

      const callId = pendingIncoming.callId;
      try {
        await transitionCall(callId, "mark_missed");
      } catch {
        // ignore
      }

      await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
    }
  }, [attachTracks, cleanupLocalCall, incomingCallRef, setupCallEvents, startDurationTimer, transitionCall]);

  const startCall = useCallback(
    async ({ matchId, type, partnerUserId, partnerName, partnerAvatar }: StartCallParams) => {
      if (!matchId) {
        toast.error("No active match for calling");
        return;
      }

      if (trackedCallIdRef.current || incomingCallRef.current || callPhaseRef.current !== "idle") {
        toast.error("Finish the current call before starting another one");
        return;
      }

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

      try {
        const { data, error } = await supabase.functions.invoke("daily-room", {
          body: { action: "create_match_call", matchId, callType: type },
        });

        if (error || !data?.token) {
          toast.error("Couldn't start call");
          await cleanupLocalCall();
          return;
        }

        createdCallId = data.call_id;
        createdRoomName = data.room_name;
        trackedCallIdRef.current = createdCallId;
        roomNameRef.current = createdRoomName;

        const callObject = DailyIframe.createCallObject({
          audioSource: true,
          videoSource: type === "video",
        });
        callObjectRef.current = callObject;
        setupCallEvents(callObject, type);

        await callObject.join({ url: data.room_url, token: data.token });
        const localParticipant = callObject.participants().local;
        if (localParticipant) {
          attachTracks(localParticipant, localVideoRef.current, true);
        }

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
        console.error("[MatchCall] Start error:", error);
        toast.error("Couldn't start call");

        if (createdCallId) {
          try {
            await transitionCall(createdCallId, "end");
          } catch {
            // ignore
          }
        }

        await cleanupLocalCall({ deleteRoomName: createdRoomName, skipServerTransition: true });
      }
    },
    [
      attachTracks,
      callPhaseRef,
      cleanupLocalCall,
      clearRingingTimeout,
      incomingCallRef,
      setupCallEvents,
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

  const reconcileCallRow = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      const trackedCallId = trackedCallIdRef.current;
      const isTrackedRow = trackedCallId === row.id || incomingCallRef.current?.callId === row.id;

      if (row.status === "ringing" && row.callee_id === currentUserId) {
        await adoptIncomingCall(row);
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
          clearRingingTimeout();
          setIncomingCall(null);
          setActiveMatchId(row.match_id);
          setCallPhase("in_call");
          startDurationTimer(row.started_at);
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
      startDurationTimer,
    ],
  );

  useEffect(() => {
    if (!currentUserId) {
      void cleanupLocalCall();
      return;
    }

    let cancelled = false;

    const handlePayload = (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => {
      const row = payload.new ?? payload.old;
      if (!row || cancelled) return;
      void reconcileCallRow(row);
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
      const { data } = await supabase
        .from("match_calls")
        .select(
          "id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, started_at, ended_at, duration_seconds, created_at",
        )
        .eq("callee_id", currentUserId)
        .eq("status", "ringing")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      const row = data?.[0] as MatchCallRow | undefined;
      if (row) {
        await reconcileCallRow(row);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [cleanupLocalCall, currentUserId, reconcileCallRow]);

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

      <AnimatePresence>
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
      </AnimatePresence>

      <AnimatePresence>
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
            onToggleMute={toggleMute}
            onToggleVideo={toggleVideo}
            onEndCall={() => {
              void endCall();
            }}
          />
        )}
      </AnimatePresence>
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
