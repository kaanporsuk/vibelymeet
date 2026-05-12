import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { SelfViewPIP } from "@/components/video-date/SelfViewPIP";
import { cn } from "@/lib/utils";

type MediaTrackStatus =
  | "off"
  | "blocked"
  | "loading"
  | "interrupted"
  | "playable"
  | "playing"
  | "sendable"
  | "receivable";

type CallEndReason =
  | "declined"
  | "hangup"
  | "caller_cancelled"
  | "missed"
  | "timeout"
  | "join_failed"
  | "stale_active"
  | "provider_error"
  | "blocked_pair"
  | "unmatched_pair"
  | "busy"
  | "connection_lost"
  | "media_failure";

export type LastCallOutcome = {
  callId: string;
  reason: CallEndReason;
  endedByMe: boolean;
  endedByPartner: boolean;
  partnerName: string;
  callType: "voice" | "video";
  role: "caller" | "callee";
};

interface ActiveCallOverlayProps {
  isRinging: boolean;
  isInCall: boolean;
  isReconnecting: boolean;
  callType: "voice" | "video";
  isMuted: boolean;
  isVideoOff: boolean;
  audioStatus: MediaTrackStatus;
  videoStatus: MediaTrackStatus;
  isAudioTogglePending: boolean;
  isVideoTogglePending: boolean;
  callDuration: number;
  partnerName: string;
  partnerAvatar?: string;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  localStream?: MediaStream | null;
  canFlipCamera: boolean;
  isFlippingCamera: boolean;
  lastOutcome: LastCallOutcome | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onFlipCamera: () => void;
  onEndCall: () => void;
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

/**
 * Localised banner copy for a terminal call outcome. Lets the user know exactly
 * why the call ended, who ended it, and whether they can re-attempt.
 */
function formatOutcomeMessage(outcome: LastCallOutcome): string {
  const { reason, endedByMe, endedByPartner, partnerName, role } = outcome;
  switch (reason) {
    case "hangup":
      if (endedByMe) return "You ended the call.";
      if (endedByPartner) return `${partnerName} ended the call.`;
      return "Call ended.";
    case "declined":
      return role === "caller" ? `${partnerName} declined the call.` : "Call declined.";
    case "caller_cancelled":
      return role === "caller" ? "Call canceled." : `Missed call from ${partnerName}.`;
    case "missed":
      return role === "caller" ? "No answer." : `Missed call from ${partnerName}.`;
    case "connection_lost":
      return "Call ended because the connection was lost.";
    case "media_failure":
      return "Call ended — microphone or camera unavailable.";
    case "provider_error":
      return "Call ended due to a technical issue.";
    case "timeout":
      return "Call timed out.";
    case "join_failed":
      return "Couldn't connect — please try again.";
    case "stale_active":
      return "Call ended.";
    case "busy":
      return `${partnerName} is busy on another call.`;
    case "blocked_pair":
      return "Call ended.";
    case "unmatched_pair":
      if (endedByMe) return "You unmatched. Call ended.";
      if (endedByPartner) return `${partnerName} unmatched. Call ended.`;
      return "Call ended.";
  }
  return "Call ended.";
}

/**
 * Microphone control with rich state. The button no longer flips on a local boolean —
 * it reflects Daily's participant track status directly. The pending state debounces
 * the post-toggle period until Daily confirms via participant-updated.
 */
function MicButton({
  audioStatus,
  isMuted,
  pending,
  onToggle,
  flavor,
}: {
  audioStatus: MediaTrackStatus;
  isMuted: boolean;
  pending: boolean;
  onToggle: () => void;
  flavor: "voice" | "video";
}) {
  const blocked = audioStatus === "blocked";
  const baseClasses =
    flavor === "voice"
      ? "w-12 h-12 rounded-full flex items-center justify-center"
      : "w-12 h-12 rounded-full flex items-center justify-center";
  const stateClass = blocked
    ? "bg-yellow-500/30 ring-1 ring-yellow-400/60"
    : isMuted
      ? flavor === "voice"
        ? "bg-destructive/20"
        : "bg-red-500/80"
      : flavor === "voice"
        ? "bg-secondary"
        : "bg-white/20 backdrop-blur-sm";
  const iconClass =
    flavor === "voice"
      ? blocked
        ? "text-yellow-500"
        : isMuted
          ? "text-destructive"
          : "text-foreground"
      : "text-white";
  const ariaLabel = blocked
    ? "Microphone blocked by browser"
    : isMuted
      ? "Unmute microphone"
      : "Mute microphone";
  return (
    <button
      onClick={onToggle}
      disabled={pending}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(baseClasses, stateClass, pending && "opacity-60")}
    >
      {isMuted || blocked ? (
        <MicOff className={cn("w-5 h-5", iconClass)} />
      ) : (
        <Mic className={cn("w-5 h-5", iconClass)} />
      )}
    </button>
  );
}

function CamButton({
  videoStatus,
  isVideoOff,
  pending,
  onToggle,
}: {
  videoStatus: MediaTrackStatus;
  isVideoOff: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const blocked = videoStatus === "blocked";
  const ariaLabel = blocked
    ? "Camera blocked by browser"
    : isVideoOff
      ? "Turn camera on"
      : "Turn camera off";
  const stateClass = blocked
    ? "bg-yellow-500/30 ring-1 ring-yellow-400/60"
    : isVideoOff
      ? "bg-red-500/80"
      : "bg-white/20 backdrop-blur-sm";
  return (
    <button
      onClick={onToggle}
      disabled={pending}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center",
        stateClass,
        pending && "opacity-60",
      )}
    >
      {isVideoOff || blocked ? (
        <VideoOff className="w-5 h-5 text-white" />
      ) : (
        <Video className="w-5 h-5 text-white" />
      )}
    </button>
  );
}

/** Inline banner explaining why the call ended; lingers ~5s after teardown. */
function OutcomeBanner({ outcome }: { outcome: LastCallOutcome }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 max-w-sm w-[calc(100%-2rem)] rounded-2xl bg-card border border-border/40 shadow-2xl backdrop-blur-xl px-5 py-4 text-center"
    >
      <p className="text-sm font-medium text-foreground">
        {formatOutcomeMessage(outcome)}
      </p>
    </motion.div>
  );
}

export const ActiveCallOverlay = ({
  isRinging,
  isInCall,
  isReconnecting,
  callType,
  isMuted,
  isVideoOff,
  audioStatus,
  videoStatus,
  isAudioTogglePending,
  isVideoTogglePending,
  callDuration,
  partnerName,
  partnerAvatar,
  remoteVideoRef,
  remoteAudioRef,
  localStream,
  canFlipCamera,
  isFlippingCamera,
  lastOutcome,
  onToggleMute,
  onToggleVideo,
  onFlipCamera,
  onEndCall,
}: ActiveCallOverlayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Track remote video intrinsic aspect ratio so we can avoid object-cover cropping
  // for portrait (mobile) feeds rendered into a landscape web canvas.
  const [remoteAspect, setRemoteAspect] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    const handleMeta = () => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (w > 0 && h > 0) setRemoteAspect({ w, h });
    };
    handleMeta();
    el.addEventListener("loadedmetadata", handleMeta);
    el.addEventListener("resize", handleMeta);
    return () => {
      el.removeEventListener("loadedmetadata", handleMeta);
      el.removeEventListener("resize", handleMeta);
    };
  }, [remoteVideoRef, isInCall]);

  const isRemotePortrait = !!(remoteAspect && remoteAspect.h > remoteAspect.w);

  // Terminal-only state: render the outcome banner without any of the live UI.
  if (lastOutcome && !isRinging && !isInCall) {
    return (
      <AnimatePresence>
        <OutcomeBanner key={lastOutcome.callId} outcome={lastOutcome} />
      </AnimatePresence>
    );
  }

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
          aria-label="Cancel call"
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
        {/* Hidden audio element for remote participant audio. Required because Daily's
            createCallObject() (low-level) mode does not auto-attach audio — without this,
            voice calls have no sound. */}
        <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />

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
        <p className="text-sm text-muted-foreground tabular-nums mb-2">{formatDuration(callDuration)}</p>
        {isReconnecting && (
          <p className="text-xs text-amber-500 font-medium mb-6">
            Connection interrupted. Waiting for {partnerName} to reconnect…
          </p>
        )}
        {!isReconnecting && <div className="mb-6" />}

        <div className="flex items-center gap-6">
          <MicButton
            audioStatus={audioStatus}
            isMuted={isMuted}
            pending={isAudioTogglePending}
            onToggle={onToggleMute}
            flavor="voice"
          />
          <button
            onClick={onEndCall}
            aria-label="End call"
            title="End call"
            className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center"
          >
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
      {/* Match/chat calls are intentionally full-bleed today for landscape remote video;
          Video Date keeps its stricter contain-only contract in src/pages/VideoDate.tsx.
          Blurred-fill background for portrait sources so the framing isn't aggressively
          cropped to landscape. Same track as the foreground; rendered behind it. We
          attach a separate <video> with srcObject mirrored from the foreground via an
          effect so both stay in sync. The foreground video gets object-contain, which
          preserves the full person but leaves margins — the blurred background fills
          them attractively without revealing the user's environment edges. */}
      {isRemotePortrait && (
        <BlurredBackdropVideo source={remoteVideoRef} aria-hidden />
      )}

      <video
        ref={remoteVideoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full",
          isRemotePortrait ? "object-contain" : "object-cover",
        )}
      />

      {/* Dedicated remote audio element — driven separately from the video element so that
          audio survives even if the remote camera is off or the video track has not yet
          transitioned to playable. */}
      <audio ref={remoteAudioRef as React.RefObject<HTMLAudioElement>} autoPlay playsInline className="hidden" />

      {/* Duration */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm">
        <span className="text-white text-sm tabular-nums font-medium">{formatDuration(callDuration)}</span>
      </div>

      {isReconnecting && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-amber-500/90 backdrop-blur-sm">
          <span className="text-white text-xs font-medium">
            Connection interrupted. Waiting for {partnerName}…
          </span>
        </div>
      )}

      {/* Local PIP — now receives camera-flip props so the user can switch between
          front/back cameras without breaking the call. */}
      <SelfViewPIP
        stream={localStream || null}
        isVideoOff={isVideoOff}
        isMuted={isMuted}
        containerRef={containerRef as React.RefObject<HTMLDivElement>}
        canFlipCamera={canFlipCamera}
        isFlippingCamera={isFlippingCamera}
        onFlipCamera={canFlipCamera ? onFlipCamera : undefined}
      />

      {/* Controls */}
      <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-5 z-10">
        <MicButton
          audioStatus={audioStatus}
          isMuted={isMuted}
          pending={isAudioTogglePending}
          onToggle={onToggleMute}
          flavor="video"
        />
        <CamButton
          videoStatus={videoStatus}
          isVideoOff={isVideoOff}
          pending={isVideoTogglePending}
          onToggle={onToggleVideo}
        />
        <button
          onClick={onEndCall}
          aria-label="End call"
          title="End call"
          className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center"
        >
          <PhoneOff className="w-6 h-6 text-white" />
        </button>
      </div>
    </motion.div>
  );
};

/**
 * A `<video>` element that mirrors srcObject from a foreground video, blurred and
 * dimmed to provide a visual fill for portrait sources in a landscape canvas. We
 * read the foreground video's stream rather than re-attaching the Daily track —
 * keeps things lightweight (no extra subscription) and stays in sync automatically.
 */
function BlurredBackdropVideo({
  source,
}: {
  source: React.RefObject<HTMLVideoElement | null>;
  "aria-hidden"?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const target = ref.current;
    const fg = source.current;
    if (!target || !fg) return;
    const sync = () => {
      if (target.srcObject !== fg.srcObject) {
        target.srcObject = fg.srcObject;
        target.play().catch(() => {});
      }
    };
    sync();
    const interval = setInterval(sync, 1000);
    return () => clearInterval(interval);
  }, [source]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      aria-hidden
      className="absolute inset-0 w-full h-full object-cover scale-110"
      style={{ filter: "blur(28px) brightness(0.55)" }}
    />
  );
}
