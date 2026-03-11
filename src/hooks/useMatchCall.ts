import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

interface UseMatchCallOptions {
  matchId: string;
  onCallEnded?: () => void;
}

export interface IncomingCallData {
  callId: string;
  callerId: string;
  callerName: string;
  callType: "voice" | "video";
}

export const useMatchCall = ({ matchId, onCallEnded }: UseMatchCallOptions) => {
  const { user } = useUserProfile();
  const [isInCall, setIsInCall] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callType, setCallType] = useState<"voice" | "video">("video");
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);

  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const isRingingRef = useRef(false);

  useEffect(() => {
    isRingingRef.current = isRinging;
  }, [isRinging]);

  const attachTracks = useCallback(
    (participant: DailyParticipant | undefined, videoEl: HTMLVideoElement | null, isLocal: boolean) => {
      if (!videoEl || !participant?.tracks) return;
      const stream = new MediaStream();
      const vt = participant.tracks.video?.persistentTrack;
      const at = participant.tracks.audio?.persistentTrack;
      if (vt) stream.addTrack(vt);
      if (at && !isLocal) stream.addTrack(at);
      videoEl.srcObject = stream;
    },
    []
  );

  const startDurationTimer = useCallback(() => {
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // Listen for incoming calls
  useEffect(() => {
    if (!user?.id || !matchId) return;

    const channel = supabase
      .channel(`match-calls-${user.id}-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_calls",
          filter: `callee_id=eq.${user.id}`,
        },
        async (payload) => {
          const call = payload.new as any;
          if (call.status === "ringing" && call.match_id === matchId) {
            const { data: callerProfile } = await supabase
              .from("profiles")
              .select("name")
              .eq("id", call.caller_id)
              .maybeSingle();

            setIncomingCall({
              callId: call.id,
              callerId: call.caller_id,
              callerName: callerProfile?.name || "Your match",
              callType: call.call_type,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, matchId]);

  const endCall = useCallback(async () => {
    stopDurationTimer();

    const co = callObjectRef.current;
    if (co) {
      try { await co.leave(); co.destroy(); } catch {}
      callObjectRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    if (activeCallIdRef.current) {
      supabase
        .from("match_calls")
        .update({ status: "ended", ended_at: new Date().toISOString(), duration_seconds: callDuration })
        .eq("id", activeCallIdRef.current)
        .then(() => {});
      activeCallIdRef.current = null;
    }

    if (roomNameRef.current) {
      supabase.functions.invoke("daily-room", { body: { action: "delete_room", roomName: roomNameRef.current } }).catch(() => {});
      roomNameRef.current = null;
    }

    setIsInCall(false);
    setIsRinging(false);
    setIncomingCall(null);
    onCallEnded?.();
  }, [stopDurationTimer, callDuration, onCallEnded]);

  const setupCallEvents = useCallback(
    (callObject: DailyCall, currentCallType: "voice" | "video") => {
      callObject.on("participant-joined", (event) => {
        if (event && !event.participant?.local) {
          setIsRinging(false);
          setIsInCall(true);
          startDurationTimer();
          toast.success(currentCallType === "voice" ? "Voice call connected 📞" : "Video call connected 📹");
          attachTracks(event.participant, remoteVideoRef.current, false);
        }
      });

      callObject.on("participant-updated", (event) => {
        if (!event?.participant) return;
        if (event.participant.local) attachTracks(event.participant, localVideoRef.current, true);
        else attachTracks(event.participant, remoteVideoRef.current, false);
      });

      callObject.on("participant-left", (event) => {
        if (event && !event.participant?.local) endCall();
      });

      callObject.on("error", (event) => {
        console.error("[MatchCall] Daily error:", event);
        toast.error("Call connection error");
        endCall();
      });

      callObject.on("left-meeting", () => {
        setIsInCall(false);
        setIsRinging(false);
        stopDurationTimer();
      });
    },
    [attachTracks, startDurationTimer, stopDurationTimer, endCall]
  );

  const startCall = useCallback(
    async (type: "voice" | "video") => {
      setCallType(type);
      setIsRinging(true);

      try {
        const { data, error } = await supabase.functions.invoke("daily-room", {
          body: { action: "create_match_call", matchId, callType: type },
        });

        if (error || !data?.token) {
          toast.error("Couldn't start call — try again");
          setIsRinging(false);
          return;
        }

        activeCallIdRef.current = data.call_id;
        roomNameRef.current = data.room_name;

        const co = DailyIframe.createCallObject({
          audioSource: true,
          videoSource: type === "video",
        });
        callObjectRef.current = co;
        setupCallEvents(co, type);

        await co.join({ url: data.room_url, token: data.token });
        const local = co.participants().local;
        if (local) attachTracks(local, localVideoRef.current, true);

        // Auto-miss after 30s
        setTimeout(() => {
          if (!callObjectRef.current) return;
          const remotes = Object.values(callObjectRef.current.participants()).filter((p) => !p.local);
          if (remotes.length === 0 && isRingingRef.current) {
            toast.info("No answer — try again later 💚");
            if (activeCallIdRef.current) {
              supabase.from("match_calls").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", activeCallIdRef.current);
            }
            endCall();
          }
        }, 30000);
      } catch (error) {
        console.error("[MatchCall] Start error:", error);
        toast.error("Couldn't start call");
        setIsRinging(false);
      }
    },
    [matchId, setupCallEvents, attachTracks, endCall]
  );

  const answerCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      const { data, error } = await supabase.functions.invoke("daily-room", {
        body: { action: "answer_match_call", callId: incomingCall.callId },
      });

      if (error || !data?.token) {
        toast.error("Couldn't connect call");
        setIncomingCall(null);
        return;
      }

      setCallType(incomingCall.callType);
      activeCallIdRef.current = incomingCall.callId;
      roomNameRef.current = data.room_name;

      const co = DailyIframe.createCallObject({
        audioSource: true,
        videoSource: incomingCall.callType === "video",
      });
      callObjectRef.current = co;
      setupCallEvents(co, incomingCall.callType);

      await co.join({ url: data.room_url, token: data.token });
      const local = co.participants().local;
      if (local) attachTracks(local, localVideoRef.current, true);

      await supabase.from("match_calls").update({ status: "active", started_at: new Date().toISOString() }).eq("id", incomingCall.callId);

      setIncomingCall(null);
    } catch (error) {
      console.error("[MatchCall] Answer error:", error);
      toast.error("Couldn't connect call");
      setIncomingCall(null);
    }
  }, [incomingCall, setupCallEvents, attachTracks]);

  const declineCall = useCallback(async () => {
    if (!incomingCall) return;
    await supabase.from("match_calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", incomingCall.callId);
    setIncomingCall(null);
  }, [incomingCall]);

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (co) { co.setLocalAudio(isMuted); setIsMuted(!isMuted); }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const co = callObjectRef.current;
    if (co) { co.setLocalVideo(isVideoOff); setIsVideoOff(!isVideoOff); }
  }, [isVideoOff]);

  useEffect(() => {
    return () => {
      stopDurationTimer();
      const co = callObjectRef.current;
      if (co) { try { co.leave(); co.destroy(); } catch {} }
    };
  }, [stopDurationTimer]);

  return {
    isInCall, isRinging, isMuted, isVideoOff, callType, callDuration,
    incomingCall, localVideoRef, remoteVideoRef,
    startCall, answerCall, declineCall, endCall, toggleMute, toggleVideo,
  };
};
