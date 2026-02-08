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
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
];

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isInitiatorRef = useRef(false);
  const partnerJoinedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  // Check media permissions
  const checkPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
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
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  }, []);

  // Create RTCPeerConnection
  const createPeerConnection = useCallback(
    (localStream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // Add local tracks
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Handle remote tracks
      pc.ontrack = (event) => {
        console.log("[WebRTC] Remote track received:", event.track.kind);
        if (remoteVideoRef.current) {
          // Use the first stream from the event
          remoteVideoRef.current.srcObject = event.streams[0];
        }
        if (!partnerJoinedRef.current) {
          partnerJoinedRef.current = true;
          options?.onPartnerJoined?.();
        }
      };

      // Send ICE candidates via Supabase Realtime
      pc.onicecandidate = (event) => {
        if (event.candidate && channelRef.current) {
          console.log("[WebRTC] Sending ICE candidate");
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

      // Connection state
      pc.onconnectionstatechange = () => {
        console.log("[WebRTC] Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
          toast.success("Connected! Your video date is live 🎉");
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setIsConnected(false);
          options?.onPartnerLeft?.();
          if (pc.connectionState === "failed") {
            toast.error("Connection lost. Please try again.");
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE state:", pc.iceConnectionState);
      };

      pcRef.current = pc;
      return pc;
    },
    [options]
  );

  // Handle incoming signaling messages
  const handleSignalingMessage = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const pc = pcRef.current;
      if (!pc) return;

      // Ignore messages from ourselves
      if (payload.fromUserId === currentUserIdRef.current) return;

      console.log("[Signaling] Received:", event, "from:", payload.fromUserId);

      switch (event) {
        case "peer-joined": {
          console.log("[Signaling] Peer joined, I am initiator:", isInitiatorRef.current);
          // If we joined first (initiator), create and send offer
          if (isInitiatorRef.current) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              console.log("[Signaling] Sending offer");
              channelRef.current?.send({
                type: "broadcast",
                event: "offer",
                payload: {
                  sdp: offer,
                  fromUserId: currentUserIdRef.current,
                },
              });
            } catch (err) {
              console.error("[WebRTC] Error creating offer:", err);
            }
          }
          break;
        }

        case "offer": {
          console.log("[Signaling] Received offer, creating answer");
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit));

            // Flush pending candidates
            for (const c of pendingCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingCandidatesRef.current = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            channelRef.current?.send({
              type: "broadcast",
              event: "answer",
              payload: {
                sdp: answer,
                fromUserId: currentUserIdRef.current,
              },
            });
          } catch (err) {
            console.error("[WebRTC] Error handling offer:", err);
          }
          break;
        }

        case "answer": {
          console.log("[Signaling] Received answer");
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit));

            // Flush pending candidates
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
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate as RTCIceCandidateInit));
            } else {
              pendingCandidatesRef.current.push(payload.candidate as RTCIceCandidateInit);
            }
          } catch (err) {
            console.error("[WebRTC] Error adding ICE candidate:", err);
          }
          break;
        }

        case "peer-left": {
          console.log("[Signaling] Peer left");
          toast.info("Partner left the call");
          options?.onPartnerLeft?.();
          break;
        }
      }
    },
    [options]
  );

  // Start the video call using Supabase Realtime for signaling
  const startCall = useCallback(
    async (roomId?: string) => {
      setIsConnecting(true);

      // Get authenticated user
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        toast.error("Please sign in to start a video call");
        setIsConnecting(false);
        return false;
      }

      const callRoomId = roomId || options?.roomId;
      if (!callRoomId) {
        toast.error("No room ID provided");
        setIsConnecting(false);
        return false;
      }

      currentUserIdRef.current = session.user.id;

      try {
        // Check permissions & initialize media
        const hasAccess = await checkPermissions();
        if (!hasAccess) {
          setIsConnecting(false);
          return false;
        }

        const localStream = await initializeMedia();
        const pc = createPeerConnection(localStream);

        // Subscribe to Supabase Realtime channel for signaling
        const channelName = `video-room:${callRoomId}`;
        console.log("[Signaling] Joining channel:", channelName);

        const channel = supabase.channel(channelName, {
          config: { broadcast: { self: false } },
        });

        // Listen for signaling messages
        channel
          .on("broadcast", { event: "offer" }, ({ payload }) => {
            handleSignalingMessage("offer", payload);
          })
          .on("broadcast", { event: "answer" }, ({ payload }) => {
            handleSignalingMessage("answer", payload);
          })
          .on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
            handleSignalingMessage("ice-candidate", payload);
          })
          .on("broadcast", { event: "peer-joined" }, ({ payload }) => {
            handleSignalingMessage("peer-joined", payload);
          })
          .on("broadcast", { event: "peer-left" }, ({ payload }) => {
            handleSignalingMessage("peer-left", payload);
          })
          .on("presence", { event: "join" }, ({ newPresences }) => {
            console.log("[Presence] User joined:", newPresences);
            // If someone else joins, we are the initiator (we were here first)
            const otherUsers = newPresences.filter(
              (p: Record<string, unknown>) => p.user_id !== currentUserIdRef.current
            );
            if (otherUsers.length > 0) {
              isInitiatorRef.current = true;
              // Trigger offer creation
              handleSignalingMessage("peer-joined", {
                fromUserId: otherUsers[0].user_id,
              });
            }
          })
          .on("presence", { event: "sync" }, () => {
            const state = channel.presenceState();
            console.log("[Presence] Sync - current state:", Object.keys(state).length, "users");

            // Check if there's already someone else in the room
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
              // Someone is already here, they should be the initiator
              // Broadcast that we joined so they create an offer
              console.log("[Presence] Found existing user, notifying them");
              channel.send({
                type: "broadcast",
                event: "peer-joined",
                payload: { fromUserId: currentUserIdRef.current },
              });
            } else if (allUsers.length === 0) {
              // We're first - we'll become initiator when someone joins
              isInitiatorRef.current = true;
              console.log("[Presence] We are first in the room, waiting for partner...");
            }
          });

        channelRef.current = channel;

        // Subscribe and track presence
        await channel.subscribe(async (status) => {
          console.log("[Signaling] Channel status:", status);
          if (status === "SUBSCRIBED") {
            // Track our presence in the channel
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
        toast.error("Failed to start video call");
        return false;
      }
    },
    [checkPermissions, initializeMedia, createPeerConnection, handleSignalingMessage, options]
  );

  // End the call
  const endCall = useCallback(async () => {
    // Broadcast that we're leaving
    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: "broadcast",
          event: "peer-left",
          payload: { fromUserId: currentUserIdRef.current },
        });
        await channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
      } catch {
        // Ignore cleanup errors
      }
      channelRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    // Clear video elements
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    pendingCandidatesRef.current = [];
    partnerJoinedRef.current = false;
    isInitiatorRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    options?.onCallEnded?.();
  }, [options]);

  // Toggle mute
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

  // Toggle video
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
      // Clean up on unmount
      if (channelRef.current) {
        try {
          channelRef.current.send({
            type: "broadcast",
            event: "peer-left",
            payload: { fromUserId: currentUserIdRef.current },
          });
          channelRef.current.untrack();
          supabase.removeChannel(channelRef.current);
        } catch {
          // Ignore
        }
      }
      if (pcRef.current) pcRef.current.close();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
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
    checkPermissions,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
};
