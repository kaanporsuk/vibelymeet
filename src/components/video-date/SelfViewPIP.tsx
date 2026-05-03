import { motion } from "framer-motion";
import { VideoOff, MicOff } from "lucide-react";
import { RefObject, useRef, useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";

interface SelfViewPIPProps {
  stream: MediaStream | null;
  isVideoOff: boolean;
  isMuted: boolean;
  containerRef: RefObject<HTMLDivElement>;
  blurAmount?: number;
  sessionId?: string | null;
  eventId?: string | null;
}

export const SelfViewPIP = ({
  stream,
  isVideoOff,
  isMuted,
  containerRef,
  blurAmount = 0,
  sessionId,
  eventId,
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
      className="absolute right-4 top-[6.75rem] w-[112px] h-[154px] sm:w-[124px] sm:h-[170px] rounded-[1.35rem] overflow-hidden z-40 cursor-grab active:cursor-grabbing bg-black"
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
        // Self-view PIP is a small draggable portrait tile, so this local preview intentionally crops.
        // The remote Vibe Video Date surface must use contain instead.
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{
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

      {/* Muted indicator */}
      {isMuted && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-2 left-2 w-8 h-8 rounded-full bg-destructive/95 flex items-center justify-center shadow-[0_8px_20px_hsl(var(--destructive)/0.32)]"
        >
          <MicOff className="w-4 h-4 text-destructive-foreground" />
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
