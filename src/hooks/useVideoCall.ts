import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";

interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  eventId?: string;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
}

/** Daily `network-quality-change` — surfaced as lightweight HUD, not toasts. */
export type VideoCallNetworkTier = "good" | "fair" | "poor";

const VIDEO_DATE_PREJOIN_TIMEOUT_MS = 12_000;

type VideoDateTruthRow = {
  id: string;
  event_id: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
  handshake_started_at: string | null;
  daily_room_name: string | null;
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

function tierFromNetworkQualityEvent(event: { threshold?: string; quality?: number } | undefined): VideoCallNetworkTier {
  const q = typeof event?.quality === "number" ? event.quality : 100;
  const th = event?.threshold;
  if (th === "low" || q < 30) return "poor";
  if (q < 70) return "fair";
  return "good";
}

function sessionIndicatesHandshakeOrDate(
  row: { state?: string | null; phase?: string | null; handshake_started_at?: string | null } | null
): boolean {
  return Boolean(
    row &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.phase === "handshake" ||
        row.phase === "date" ||
        row.handshake_started_at)
  );
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

function vdbg(message: string, data?: Record<string, unknown>) {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: "vdbg",
    message,
    level: "info",
    data: payload,
  });
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

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [networkTier, setNetworkTier] = useState<VideoCallNetworkTier>("good");

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

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

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
    []
  );

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

      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setLocalStream(null);
      setHasPermission(null);
      setIsConnected(false);
      setIsConnecting(false);
      setNetworkTier("good");
      firstRemoteObservedRef.current = false;
      lastLocalTrackIdsRef.current = "";
      lastLocalStreamRef.current = null;
      lastRemoteTrackIdsRef.current = "";
      lastRemoteStreamRef.current = null;
    },
    []
  );

  const startCall = useCallback(
    async (roomId?: string) => {
      const sessionId = roomId || optionsRef.current?.roomId;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      if (!sessionId) {
        toast.error("No session ID provided");
        return false;
      }

      setIsConnecting(true);
      setIsConnected(false);
      setHasPermission(null);
      firstRemoteObservedRef.current = false;

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

        const { data: truth, error: truthError } = await supabase
          .from("video_sessions")
          .select("id, event_id, ended_at, state, phase, handshake_started_at, daily_room_name")
          .eq("id", sessionId)
          .maybeSingle();
        const truthRow = truth as VideoDateTruthRow | null;
        vdbg("date_prejoin_truth_row", {
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          row: truthRow ?? null,
          error: truthError ? { code: truthError.code, message: truthError.message } : null,
        });

        if (truthError || !truthRow || truthRow.ended_at) {
          setIsConnecting(false);
          return false;
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
          return false;
        }

        if (!sessionIndicatesHandshakeOrDate(truthRow)) {
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
          if (enterError || (enterData as { success?: boolean } | null)?.success === false) {
            setIsConnecting(false);
            return false;
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

        const createRoomArgs = { action: "create_date_room", sessionId };
        vdbg("daily_room_before", {
          action: "create_date_room",
          args: createRoomArgs,
          eventId: truthRow.event_id ?? eventId,
          userId,
          timeoutMs: VIDEO_DATE_PREJOIN_TIMEOUT_MS,
        });
        const { data: roomData, error: roomError } = await withTimeout(
          "daily_room",
          supabase.functions.invoke<DailyRoomResponse>("daily-room", { body: createRoomArgs }),
          VIDEO_DATE_PREJOIN_TIMEOUT_MS
        );
        vdbg("daily_room_after", {
          action: "create_date_room",
          ok: !roomError && Boolean(roomData?.token),
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData?.room_name ?? null,
          hasToken: Boolean(roomData?.token),
          reusedRoom: roomData?.reused_room ?? null,
          providerRoomRecreated: roomData?.provider_room_recreated ?? null,
          error: roomError ? { name: roomError.name, message: roomError.message } : null,
          serverCode: roomData?.code ?? null,
        });

        if (roomError || !roomData?.token || !roomData.room_name || !roomData.room_url) {
          console.error("[Daily] Room creation failed:", roomError);
          toast.error("Video is temporarily unavailable. Please try again in a moment.");
          setIsConnecting(false);
          return false;
        }

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

        callObject.on("participant-joined", (event) => {
          if (event && !event.participant?.local) {
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
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
            const localKey = getTrackIdsKey(event.participant, false);
            if (localKey !== lastLocalTrackIdsRef.current) {
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
            if (localVideoRef.current) {
              attachTracks(event.participant, localVideoRef.current, true);
            }
          } else {
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                source: "participant_updated",
              });
            }
            const remoteKey = getTrackIdsKey(event.participant, true);
            if (remoteKey !== lastRemoteTrackIdsRef.current) {
              lastRemoteTrackIdsRef.current = remoteKey;
              if (remoteVideoRef.current) {
                attachTracks(event.participant, remoteVideoRef.current, false);
              }
              lastRemoteStreamRef.current = null;
              vdbg("daily_remote_tracks_changed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                key: remoteKey,
              });
            }
          }
        });

        callObject.on("participant-left", (event) => {
          if (event && !event.participant?.local) {
            setIsConnected(false);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            optionsRef.current?.onPartnerLeft?.();
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
          toast.error("Connection error. Please try again.");
          setIsConnecting(false);
          setIsConnected(false);
        });

        callObject.on("left-meeting", () => {
          vdbg("daily_call_left_meeting", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
          });
          setIsConnected(false);
          setIsConnecting(false);
        });

        callObject.on("network-connection", (event: { event?: string } | undefined) => {
          if (event?.event === "interrupted") {
            console.log("[Daily] Network interrupted — partner may be reconnecting");
            optionsRef.current?.onPartnerLeft?.();
          }
        });

        callObject.on("network-quality-change", (event: { threshold?: string; quality?: number }) => {
          setNetworkTier(tierFromNetworkQualityEvent(event));
        });

        callObject.on("camera-error", (event: { errorMsg?: string; error?: unknown } | undefined) => {
          vdbg("daily_camera_error", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            errorMsg: event?.errorMsg ?? null,
            error: event?.error ?? null,
          });
          Sentry.captureMessage("daily_camera_error", { level: "error", extra: { event } });
        });

        callObject.on("track-stopped", (event: { participant?: DailyParticipant; track?: MediaStreamTrack } | undefined) => {
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
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
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
          }
        }

        const participants = callObject.participants();
        const remoteParticipants = Object.values(participants).filter((p) => !p.local);
        if (remoteParticipants.length > 0) {
          if (!firstRemoteObservedRef.current) {
            firstRemoteObservedRef.current = true;
            vdbg("first_remote_participant_seen", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              source: "post_join_snapshot",
            });
          }
          setIsConnected(true);
          setIsConnecting(false);
          toast.success("Connected! Your video date is live 🎉");
          optionsRef.current?.onPartnerJoined?.();
          attachTracks(remoteParticipants[0], remoteVideoRef.current, false);
        }

        return true;
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
        return false;
      }
    },
    [attachTracks, cleanupCallObject]
  );

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

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    networkTier,
    localVideoRef,
    remoteVideoRef,
    localStream,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
    // Stable getter for the canonical room name after startCall succeeds.
    getRoomName: useCallback(() => roomNameRef.current, []),
  };
};
