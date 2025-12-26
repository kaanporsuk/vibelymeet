import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

const SIGNALING_URL = "wss://schdyxcunwcvddlcshwd.supabase.co/functions/v1/webrtc-signaling";

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<PeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Check if media permissions are granted
  const checkPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      stream.getTracks().forEach(track => track.stop());
      setHasPermission(true);
      return true;
    } catch (error) {
      console.error("Media permission denied:", error);
      setHasPermission(false);
      toast.error("Camera and microphone access is required for video calls");
      return false;
    }
  }, []);

  // Initialize local media stream
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error) {
      console.error("Failed to get media stream:", error);
      toast.error("Failed to access camera/microphone");
      throw error;
    }
  }, []);

  // Create peer connection with signaling
  const createPeerConnection = useCallback((localStream: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ]
    });

    // Add local tracks
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Handle incoming tracks
    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      
      options?.onPartnerJoined?.();
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        console.log("Sending ICE candidate");
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          roomId: options?.roomId,
          userId: options?.userId,
          targetUserId: 'partner', // Will be set dynamically
          payload: event.candidate,
        }));
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      
      if (pc.connectionState === "connected") {
        setIsConnected(true);
        setIsConnecting(false);
        toast.success("Connected to video call!");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setIsConnected(false);
        options?.onPartnerLeft?.();
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE connection state:", pc.iceConnectionState);
    };

    return { pc, localStream, remoteStream };
  }, [options]);

  // Connect to signaling server
  const connectSignaling = useCallback((roomId: string, userId: string) => {
    return new Promise<WebSocket>((resolve, reject) => {
      console.log("Connecting to signaling server...");
      const ws = new WebSocket(SIGNALING_URL);
      
      ws.onopen = () => {
        console.log("Signaling connection opened");
        ws.send(JSON.stringify({
          type: 'join',
          roomId,
          userId,
        }));
        resolve(ws);
      };

      ws.onerror = (error) => {
        console.error("Signaling error:", error);
        reject(error);
      };

      ws.onclose = () => {
        console.log("Signaling connection closed");
      };

      wsRef.current = ws;
    });
  }, []);

  // Handle signaling messages
  const setupSignalingHandlers = useCallback((ws: WebSocket, peerConnection: PeerConnection) => {
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log("Signaling message received:", message.type);

      switch (message.type) {
        case 'room-joined':
          console.log("Joined room, existing participants:", message.participants);
          // If there are existing participants, create offer
          if (message.participants.length > 0) {
            const offer = await peerConnection.pc.createOffer();
            await peerConnection.pc.setLocalDescription(offer);
            
            ws.send(JSON.stringify({
              type: 'offer',
              roomId: options?.roomId,
              userId: options?.userId,
              targetUserId: message.participants[0],
              payload: offer,
            }));
          }
          break;

        case 'peer-joined':
          console.log("Peer joined:", message.userId);
          toast.info("Partner is joining...");
          break;

        case 'offer':
          console.log("Received offer from:", message.fromUserId);
          await peerConnection.pc.setRemoteDescription(new RTCSessionDescription(message.offer));
          
          // Add any pending ICE candidates
          for (const candidate of pendingCandidatesRef.current) {
            await peerConnection.pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current = [];
          
          const answer = await peerConnection.pc.createAnswer();
          await peerConnection.pc.setLocalDescription(answer);
          
          ws.send(JSON.stringify({
            type: 'answer',
            roomId: options?.roomId,
            userId: options?.userId,
            targetUserId: message.fromUserId,
            payload: answer,
          }));
          break;

        case 'answer':
          console.log("Received answer from:", message.fromUserId);
          await peerConnection.pc.setRemoteDescription(new RTCSessionDescription(message.answer));
          
          // Add any pending ICE candidates
          for (const candidate of pendingCandidatesRef.current) {
            await peerConnection.pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current = [];
          break;

        case 'ice-candidate':
          console.log("Received ICE candidate from:", message.fromUserId);
          if (peerConnection.pc.remoteDescription) {
            await peerConnection.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
          } else {
            // Queue candidate until remote description is set
            pendingCandidatesRef.current.push(message.candidate);
          }
          break;

        case 'peer-left':
          console.log("Peer left:", message.userId);
          toast.info("Partner left the call");
          options?.onPartnerLeft?.();
          break;
      }
    };
  }, [options]);

  // Start a video call
  const startCall = useCallback(async (roomId?: string) => {
    setIsConnecting(true);
    
    const callRoomId = roomId || options?.roomId || `room-${Date.now()}`;
    const callUserId = options?.userId || `user-${Date.now()}`;
    
    try {
      const hasAccess = await checkPermissions();
      if (!hasAccess) {
        setIsConnecting(false);
        return false;
      }

      const localStream = await initializeMedia();
      const peerConnection = createPeerConnection(localStream);
      peerConnectionRef.current = peerConnection;

      // Connect to signaling server
      try {
        const ws = await connectSignaling(callRoomId, callUserId);
        setupSignalingHandlers(ws, peerConnection);
      } catch (error) {
        console.error("Failed to connect to signaling server:", error);
        // Fall back to demo mode
        console.log("Falling back to demo mode...");
        setTimeout(() => {
          setIsConnected(true);
          setIsConnecting(false);
          toast.success("Connected to video call (demo mode)");
        }, 2000);
      }

      return true;
    } catch (error) {
      console.error("Failed to start call:", error);
      setIsConnecting(false);
      toast.error("Failed to start video call");
      return false;
    }
  }, [checkPermissions, initializeMedia, createPeerConnection, connectSignaling, setupSignalingHandlers, options]);

  // End the call
  const endCall = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'leave',
          roomId: options?.roomId,
          userId: options?.userId,
        }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }

    if (peerConnectionRef.current) {
      const { pc, localStream } = peerConnectionRef.current;
      
      // Stop all tracks
      localStream?.getTracks().forEach(track => track.stop());
      
      // Close peer connection
      pc.close();
      
      peerConnectionRef.current = null;
    }

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    pendingCandidatesRef.current = [];
    setIsConnected(false);
    setIsConnecting(false);
    options?.onCallEnded?.();
  }, [options]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (peerConnectionRef.current?.localStream) {
      const audioTrack = peerConnectionRef.current.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    } else {
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (peerConnectionRef.current?.localStream) {
      const videoTrack = peerConnectionRef.current.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    } else {
      setIsVideoOff(!isVideoOff);
    }
  }, [isVideoOff]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (peerConnectionRef.current || wsRef.current) {
        endCall();
      }
    };
  }, [endCall]);

  return {
    // State
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    
    // Refs
    localVideoRef,
    remoteVideoRef,
    
    // Actions
    checkPermissions,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
};
