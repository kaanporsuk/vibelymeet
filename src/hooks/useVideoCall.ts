import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface UseVideoCallOptions {
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<PeerConnection | null>(null);

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

  // Start a video call
  const startCall = useCallback(async () => {
    setIsConnecting(true);
    
    try {
      const hasAccess = await checkPermissions();
      if (!hasAccess) {
        setIsConnecting(false);
        return false;
      }

      const localStream = await initializeMedia();

      // Create peer connection with STUN servers
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
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
        
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        
        options?.onPartnerJoined?.();
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setIsConnected(false);
          options?.onPartnerLeft?.();
        }
      };

      // Store references
      peerConnectionRef.current = {
        pc,
        localStream,
        remoteStream
      };

      // For demo purposes, simulate connection after 2 seconds
      setTimeout(() => {
        setIsConnected(true);
        setIsConnecting(false);
        toast.success("Connected to video call!");
      }, 2000);

      return true;
    } catch (error) {
      console.error("Failed to start call:", error);
      setIsConnecting(false);
      toast.error("Failed to start video call");
      return false;
    }
  }, [checkPermissions, initializeMedia, options]);

  // End the call
  const endCall = useCallback(() => {
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
      if (peerConnectionRef.current) {
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
