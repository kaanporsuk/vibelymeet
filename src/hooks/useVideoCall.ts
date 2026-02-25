import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
}

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const checkPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setHasPermission(true);
      return true;
    } catch {
      setHasPermission(false);
      toast.error("Camera and microphone access is required for video calls");
      return false;
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
      if (isLocal) setLocalStream(stream);
    },
    []
  );

  const startCall = useCallback(
    async (roomId?: string) => {
      const sessionId = roomId || optionsRef.current?.roomId;
      if (!sessionId) {
        toast.error("No session ID provided");
        return false;
      }

      setIsConnecting(true);

      try {
        const hasAccess = await checkPermissions();
        if (!hasAccess) {
          setIsConnecting(false);
          return false;
        }

        const { data: roomData, error: roomError } = await supabase.functions.invoke(
          "daily-room",
          { body: { action: "create_date_room", sessionId } }
        );

        if (roomError || !roomData?.token) {
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

        callObject.on("participant-joined", (event) => {
          if (event && !event.participant?.local) {
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
            attachTracks(event.participant, localVideoRef.current, true);
          } else {
            attachTracks(event.participant, remoteVideoRef.current, false);
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
          toast.error("Connection error. Please try again.");
          setIsConnecting(false);
          setIsConnected(false);
        });

        callObject.on("left-meeting", () => {
          setIsConnected(false);
          setIsConnecting(false);
        });

        callObject.on("network-connection", (event: any) => {
          if (event?.event === "interrupted") {
            console.log("[Daily] Network interrupted — partner may be reconnecting");
            optionsRef.current?.onPartnerLeft?.();
          }
        });

        callObject.on("network-quality-change", (event: any) => {
          if (event?.threshold === "low" || event?.quality < 30) {
            toast.warning("Weak connection — try moving closer to WiFi 📶", { duration: 3000, id: "network-quality" });
          }
        });

        await callObject.join({ url: roomData.room_url, token: roomData.token });

        const localParticipant = callObject.participants().local;
        if (localParticipant) {
          attachTracks(localParticipant, localVideoRef.current, true);
        }

        // Check if partner already present
        const participants = callObject.participants();
        const remoteParticipants = Object.values(participants).filter((p) => !p.local);
        if (remoteParticipants.length > 0) {
          setIsConnected(true);
          setIsConnecting(false);
          toast.success("Connected! Your video date is live 🎉");
          optionsRef.current?.onPartnerJoined?.();
          attachTracks(remoteParticipants[0], remoteVideoRef.current, false);
        }

        return true;
      } catch (error) {
        console.error("[Daily] Failed to start call:", error);
        toast.error("Video is temporarily unavailable. Please try again.");
        setIsConnecting(false);
        return false;
      }
    },
    [checkPermissions, attachTracks]
  );

  const endCall = useCallback(async () => {
    const callObject = callObjectRef.current;
    if (callObject) {
      try {
        await callObject.leave();
        callObject.destroy();
      } catch {}
      callObjectRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setLocalStream(null);

    if (roomNameRef.current) {
      supabase.functions
        .invoke("daily-room", {
          body: { action: "delete_room", roomName: roomNameRef.current },
        })
        .catch(() => {});
      roomNameRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    optionsRef.current?.onCallEnded?.();
  }, []);

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
      const co = callObjectRef.current;
      if (co) {
        try {
          co.leave();
          co.destroy();
        } catch {}
      }
    };
  }, []);

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    localVideoRef,
    remoteVideoRef,
    localStream,
    checkPermissions,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
};
