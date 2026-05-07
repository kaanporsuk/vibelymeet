import { motion } from "framer-motion";
import { MicOff, SwitchCamera, VideoOff } from "lucide-react";
import { RefObject, useRef, useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { VIDEO_DATE_SELF_VIEW_OBJECT_FIT } from "@clientShared/matching/videoDateMediaContract";

interface SelfViewPIPProps {
  stream: MediaStream | null;
  isVideoOff: boolean;
  isMuted: boolean;
  containerRef: RefObject<HTMLDivElement>;
  blurAmount?: number;
  sessionId?: string | null;
  eventId?: string | null;
  canFlipCamera?: boolean;
  isFlippingCamera?: boolean;
  onFlipCamera?: () => void | Promise<void>;
}

export const SelfViewPIP = ({
  stream,
  isVideoOff,
  isMuted,
  containerRef,
  blurAmount = 0,
  sessionId,
  eventId,
  canFlipCamera = false,
  isFlippingCamera = false,
  onFlipCamera,
}: SelfViewPIPProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise
          .then(() => setPlaybackBlocked(false))
          .catch((error: unknown) => {
            setPlaybackBlocked(true);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
              platform: "web",
              session_id: sessionId ?? null,
              event_id: eventId ?? null,
              surface: "local_self_view",
              reason: error instanceof Error ? error.name : "play_rejected",
            });
          });
      }
    } else if (!stream && el.srcObject) {
      el.srcObject = null;
      setPlaybackBlocked(false);
    }
  }, [eventId, sessionId, stream]);

  const retryPlayback = () => {
    const el = videoRef.current;
    if (!el) return;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RETRY, {
      platform: "web",
      session_id: sessionId ?? null,
      event_id: eventId ?? null,
      surface: "local_self_view",
    });
    const playPromise = el.play();
    if (playPromise && typeof playPromise.then === "function") {
      void playPromise
        .then(() => {
          setPlaybackBlocked(false);
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RECOVERED, {
            platform: "web",
            session_id: sessionId ?? null,
            event_id: eventId ?? null,
            surface: "local_self_view",
          });
        })
        .catch(() => {
          setPlaybackBlocked(true);
        });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, type: "spring", stiffness: 260, damping: 20 }}
      drag
      dragConstraints={containerRef}
      dragElastic={0.05}
      dragMomentum={false}
      whileDrag={{ scale: 1.05 }}
      className="absolute right-4 top-[6.75rem] aspect-[9/16] w-[96px] rounded-[1.35rem] overflow-hidden z-40 cursor-grab active:cursor-grabbing bg-black sm:w-[104px] md:right-5 md:top-[7.125rem] md:w-[112px]"
      style={{
        boxShadow:
          "0 20px 54px rgba(0,0,0,0.5), 0 0 0 1.5px hsl(var(--primary) / 0.48), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      {isVideoOff ? (
        <div className="w-full h-full bg-secondary flex flex-col items-center justify-center gap-1.5">
          <VideoOff className="w-6 h-6 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Camera off</span>
        </div>
      ) : (
        // Self-view must preserve the sender's full frame; face crops feel especially harsh on mobile Safari.
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full bg-black object-contain"
          style={{
            objectFit: VIDEO_DATE_SELF_VIEW_OBJECT_FIT,
            transform: "scaleX(-1)",
            filter: `blur(${blurAmount}px)`,
            transition: "filter 10s linear",
          }}
        />
      )}

      {playbackBlocked && !isVideoOff && (
        <button
          type="button"
          onClick={retryPlayback}
          className="absolute inset-0 flex items-center justify-center bg-black/70 px-2 text-center text-[10px] font-medium text-white"
        >
          Tap to resume video
        </button>
      )}

      {canFlipCamera && !isVideoOff && onFlipCamera ? (
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void onFlipCamera();
          }}
          disabled={isFlippingCamera}
          className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-white/[0.12] bg-black/[0.45] text-white shadow-[0_8px_20px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-colors hover:bg-black/60 disabled:opacity-60"
          aria-label="Switch camera"
          title="Switch camera"
        >
          <SwitchCamera className={`h-3.5 w-3.5 ${isFlippingCamera ? "animate-pulse" : ""}`} aria-hidden />
        </motion.button>
      ) : null}

      {/* Muted indicator */}
      {isMuted && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-1.5 left-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-destructive/95 shadow-[0_8px_20px_hsl(var(--destructive)/0.32)]"
        >
          <MicOff className="h-3.5 w-3.5 text-destructive-foreground" />
        </motion.div>
      )}

      {/* Speaking indicator ring */}
      {!isMuted && (
        <motion.div
          className="absolute inset-0 rounded-[1.35rem] pointer-events-none"
          animate={{
            boxShadow: [
              "inset 0 0 0px hsl(var(--neon-cyan) / 0)",
              "inset 0 0 8px hsl(var(--neon-cyan) / 0.4)",
              "inset 0 0 0px hsl(var(--neon-cyan) / 0)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Drag handle */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
        <div className="w-8 h-1 bg-white/30 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.45)]" />
      </div>
    </motion.div>
  );
};
