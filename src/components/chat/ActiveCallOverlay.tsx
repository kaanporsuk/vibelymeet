import { useRef } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from "lucide-react";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { SelfViewPIP } from "@/components/video-date/SelfViewPIP";
import { cn } from "@/lib/utils";

interface ActiveCallOverlayProps {
  isRinging: boolean;
  isInCall: boolean;
  callType: "voice" | "video";
  isMuted: boolean;
  isVideoOff: boolean;
  callDuration: number;
  partnerName: string;
  partnerAvatar?: string;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localStream?: MediaStream | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

export const ActiveCallOverlay = ({
  isRinging,
  isInCall,
  callType,
  isMuted,
  isVideoOff,
  callDuration,
  partnerName,
  partnerAvatar,
  localVideoRef,
  remoteVideoRef,
  localStream,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: ActiveCallOverlayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Ringing state (caller waiting)
  if (isRinging && !isInCall) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl"
      >
        <div className="relative mb-6">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-primary/20"
              style={{ width: 96, height: 96, top: -8, left: -8 }}
              animate={{ scale: [1, 1.6, 2], opacity: [0.4, 0.1, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
            />
          ))}
          <ProfilePhoto avatarUrl={partnerAvatar} name={partnerName} size="lg" rounded="full" className="w-20 h-20" />
        </div>
        <h2 className="text-lg font-display font-semibold text-foreground mb-1">Calling {partnerName}...</h2>
        <p className="text-sm text-muted-foreground mb-8">
          {callType === "video" ? "Video call" : "Voice call"}
        </p>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onEndCall}
          className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center"
        >
          <PhoneOff className="w-6 h-6 text-destructive-foreground" />
        </motion.button>
      </motion.div>
    );
  }

  // Active voice call
  if (callType === "voice") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
      >
        {/* Sound wave rings */}
        <div className="relative mb-6">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-primary/20"
              style={{ width: 96, height: 96, top: -8, left: -8 }}
              animate={{ scale: [1, 1.5 + i * 0.3], opacity: [0.3, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.4, ease: "easeOut" }}
            />
          ))}
          <ProfilePhoto avatarUrl={partnerAvatar} name={partnerName} size="lg" rounded="full" className="w-20 h-20" />
        </div>
        <h2 className="text-lg font-display font-semibold text-foreground mb-1">{partnerName}</h2>
        <p className="text-sm text-muted-foreground tabular-nums mb-8">{formatDuration(callDuration)}</p>

        <div className="flex items-center gap-6">
          <button onClick={onToggleMute} className={cn("w-12 h-12 rounded-full flex items-center justify-center", isMuted ? "bg-destructive/20" : "bg-secondary")}>
            {isMuted ? <MicOff className="w-5 h-5 text-destructive" /> : <Mic className="w-5 h-5 text-foreground" />}
          </button>
          <button onClick={onEndCall} className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center">
            <PhoneOff className="w-6 h-6 text-destructive-foreground" />
          </button>
        </div>
      </motion.div>
    );
  }

  // Active video call
  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      {/* Remote video */}
      <video
        ref={remoteVideoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Duration */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm">
        <span className="text-white text-sm tabular-nums font-medium">{formatDuration(callDuration)}</span>
      </div>

      {/* Local PIP */}
      <SelfViewPIP
        stream={localStream || null}
        isVideoOff={isVideoOff}
        isMuted={isMuted}
        containerRef={containerRef as React.RefObject<HTMLDivElement>}
      />

      {/* Controls */}
      <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-5 z-10">
        <button onClick={onToggleMute} className={cn("w-12 h-12 rounded-full flex items-center justify-center", isMuted ? "bg-red-500/80" : "bg-white/20 backdrop-blur-sm")}>
          {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>
        <button onClick={onToggleVideo} className={cn("w-12 h-12 rounded-full flex items-center justify-center", isVideoOff ? "bg-red-500/80" : "bg-white/20 backdrop-blur-sm")}>
          {isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
        </button>
        <button onClick={onEndCall} className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center">
          <PhoneOff className="w-6 h-6 text-white" />
        </button>
      </div>
    </motion.div>
  );
};
