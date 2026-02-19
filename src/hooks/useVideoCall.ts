import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const CONNECTION_TIMEOUT_MS = 15000;

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isInitiatorRef = useRef(false);
  const partnerJoinedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Check media permissions
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

  // Initialize local media
  const initializeMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  }, []);

  const clearConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  // Create RTCPeerConnection
  const createPeerConnection = useCallback(
    (localStream: MediaStream) => {
      // Close existing connection if any
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.ontrack = (event) => {
        console.log("[WebRTC] Remote track received:", event.track.kind);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        if (!partnerJoinedRef.current) {
          partnerJoinedRef.current = true;
          optionsRef.current?.onPartnerJoined?.();
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "ice-candidate",
            payload: {
              candidate: event.candidate.toJSON(),
              fromUserId: currentUserIdRef.current,
            },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          connectedRef.current = true;
          setIsConnected(true);
          setIsConnecting(false);
          clearConnectionTimeout();
          toast.success("Connected! Your video date is live 🎉");
        } else if (pc.connectionState === "disconnected") {
          setIsConnected(false);
          connectedRef.current = false;
          optionsRef.current?.onPartnerLeft?.();
        } else if (pc.connectionState === "failed") {
          setIsConnected(false);
          connectedRef.current = false;
          optionsRef.current?.onPartnerLeft?.();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE state:", pc.iceConnectionState);
      };

      pcRef.current = pc;
      return pc;
    },
    [clearConnectionTimeout]
  );

  // Handle incoming signaling messages
  const handleSignalingMessage = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const pc = pcRef.current;
      if (!pc) return;
      if (payload.fromUserId === currentUserIdRef.current) return;

      console.log("[Signaling] Received:", event);

      switch (event) {
        case "peer-joined": {
          if (isInitiatorRef.current) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              channelRef.current?.send({
                type: "broadcast",
                event: "offer",
                payload: { sdp: offer, fromUserId: currentUserIdRef.current },
              });
            } catch (err) {
              console.error("[WebRTC] Error creating offer:", err);
            }
          }
          break;
        }

        case "offer": {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit)
            );
            // Flush pending candidates now that remote description is set
            for (const c of pendingCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingCandidatesRef.current = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channelRef.current?.send({
              type: "broadcast",
              event: "answer",
              payload: { sdp: answer, fromUserId: currentUserIdRef.current },
            });
          } catch (err) {
            console.error("[WebRTC] Error handling offer:", err);
          }
          break;
        }

        case "answer": {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit)
            );
            for (const c of pendingCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingCandidatesRef.current = [];
          } catch (err) {
            console.error("[WebRTC] Error handling answer:", err);
          }
          break;
        }

        case "ice-candidate": {
          try {
            // Only add candidates after remote description is set
            if (pc.remoteDescription) {
              await pc.addIceCandidate(
                new RTCIceCandidate(payload.candidate as RTCIceCandidateInit)
              );
            } else {
              // Buffer candidates until remote description arrives
              pendingCandidatesRef.current.push(payload.candidate as RTCIceCandidateInit);
            }
          } catch (err) {
            console.error("[WebRTC] Error adding ICE candidate:", err);
          }
          break;
        }

        case "peer-left": {
          console.log("[Signaling] Peer left");
          optionsRef.current?.onPartnerLeft?.();
          break;
        }
      }
    },
    []
  );

  // Start the video call
  const startCall = useCallback(
    async (roomId?: string) => {
      setIsConnecting(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        toast.error("Please sign in to start a video call");
        setIsConnecting(false);
        return false;
      }

      const callRoomId = roomId || optionsRef.current?.roomId;
      if (!callRoomId) {
        toast.error("No room ID provided");
        setIsConnecting(false);
        return false;
      }

      currentUserIdRef.current = session.user.id;

      try {
        const hasAccess = await checkPermissions();
        if (!hasAccess) {
          setIsConnecting(false);
          return false;
        }

        const localStream = await initializeMedia();
        const pc = createPeerConnection(localStream);

        // 15-second connection timeout with retry
        clearConnectionTimeout();
        connectionTimeoutRef.current = setTimeout(() => {
          if (!connectedRef.current) {
            console.log("[WebRTC] Connection timeout, retrying...");
            toast("Having trouble connecting... Retrying", { duration: 3000 });
            setConnectionAttempt((prev) => prev + 1);

            // Recreate peer connection with same local stream
            pendingCandidatesRef.current = [];
            isInitiatorRef.current = false;
            partnerJoinedRef.current = false;

            const newPc = createPeerConnection(localStream);

            // Re-announce presence to trigger new negotiation
            channelRef.current?.send({
              type: "broadcast",
              event: "peer-joined",
              payload: { fromUserId: currentUserIdRef.current },
            });

            // Second timeout — give up after another 15s
            connectionTimeoutRef.current = setTimeout(() => {
              if (!connectedRef.current) {
                toast.error("Unable to connect. Please try again later.");
                setIsConnecting(false);
              }
            }, CONNECTION_TIMEOUT_MS);
          }
        }, CONNECTION_TIMEOUT_MS);

        // Subscribe to Supabase Realtime channel
        const channelName = `video-room:${callRoomId}`;
        const channel = supabase.channel(channelName, {
          config: { broadcast: { self: false } },
        });

        channel
          .on("broadcast", { event: "offer" }, ({ payload }) =>
            handleSignalingMessage("offer", payload)
          )
          .on("broadcast", { event: "answer" }, ({ payload }) =>
            handleSignalingMessage("answer", payload)
          )
          .on("broadcast", { event: "ice-candidate" }, ({ payload }) =>
            handleSignalingMessage("ice-candidate", payload)
          )
          .on("broadcast", { event: "peer-joined" }, ({ payload }) =>
            handleSignalingMessage("peer-joined", payload)
          )
          .on("broadcast", { event: "peer-left" }, ({ payload }) =>
            handleSignalingMessage("peer-left", payload)
          )
          .on("presence", { event: "join" }, ({ newPresences }) => {
            const otherUsers = newPresences.filter(
              (p: Record<string, unknown>) => p.user_id !== currentUserIdRef.current
            );
            if (otherUsers.length > 0) {
              isInitiatorRef.current = true;
              handleSignalingMessage("peer-joined", {
                fromUserId: otherUsers[0].user_id,
              });
            }
          })
          .on("presence", { event: "sync" }, () => {
            const state = channel.presenceState();
            const allUsers: string[] = [];
            for (const key of Object.keys(state)) {
              const presences = state[key] as Array<Record<string, unknown>>;
              for (const p of presences) {
                if (p.user_id && p.user_id !== currentUserIdRef.current) {
                  allUsers.push(p.user_id as string);
                }
              }
            }

            if (allUsers.length > 0 && !isInitiatorRef.current) {
              channel.send({
                type: "broadcast",
                event: "peer-joined",
                payload: { fromUserId: currentUserIdRef.current },
              });
            } else if (allUsers.length === 0) {
              isInitiatorRef.current = true;
            }
          });

        channelRef.current = channel;

        await channel.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await channel.track({
              user_id: currentUserIdRef.current,
              joined_at: new Date().toISOString(),
            });
          }
        });

        return true;
      } catch (error) {
        console.error("[VideoCall] Failed to start:", error);
        setIsConnecting(false);
        clearConnectionTimeout();
        toast.error("Failed to start video call");
        return false;
      }
    },
    [checkPermissions, initializeMedia, createPeerConnection, handleSignalingMessage, clearConnectionTimeout]
  );

  // End the call
  const endCall = useCallback(async () => {
    clearConnectionTimeout();

    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: "broadcast",
          event: "peer-left",
          payload: { fromUserId: currentUserIdRef.current },
        });
        await channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    pendingCandidatesRef.current = [];
    partnerJoinedRef.current = false;
    isInitiatorRef.current = false;
    connectedRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    optionsRef.current?.onCallEnded?.();
  }, [clearConnectionTimeout]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    } else {
      setIsMuted((prev) => !prev);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    } else {
      setIsVideoOff((prev) => !prev);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearConnectionTimeout();
      if (channelRef.current) {
        try {
          channelRef.current.send({
            type: "broadcast",
            event: "peer-left",
            payload: { fromUserId: currentUserIdRef.current },
          });
          channelRef.current.untrack();
          supabase.removeChannel(channelRef.current);
        } catch {}
      }
      if (pcRef.current) pcRef.current.close();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [clearConnectionTimeout]);

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    connectionAttempt,
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
