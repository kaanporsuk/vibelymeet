import { motion } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  User,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoDateControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onViewProfile: () => void;
  /** In-call safety report (canonical `submit_user_report`); omit when not in active call. */
  onSafety?: () => void;
  isLeaving?: boolean;
}

export const VideoDateControls = ({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
  onSafety,
  isLeaving = false,
}: VideoDateControlsProps) => {
  const controlBtn =
    "h-14 w-14 rounded-full transition-all duration-200";
  const quietBtn =
    "bg-white/[0.07] border border-white/10 hover:bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]";

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.4, type: "spring", stiffness: 220, damping: 22 }}
      className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-2 rounded-[2rem] border border-white/10 bg-black/40 px-4 py-3.5 shadow-[0_22px_70px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl"
    >
      {/* Left: Profile */}
      <motion.div whileTap={{ scale: 0.9 }}>
        <Button
          variant="secondary"
          size="icon"
          aria-label="View profile"
          className={`${controlBtn} ${quietBtn}`}
          onClick={onViewProfile}
        >
          <User className="w-5 h-5 text-foreground" />
        </Button>
      </motion.div>

      {/* Center: Core controls */}
      <div className="flex items-center gap-2.5">
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            variant={isMuted ? "destructive" : "secondary"}
            size="icon"
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            className={`${controlBtn} ${
              !isMuted
                ? quietBtn
                : ""
            }`}
            onClick={onToggleMute}
          >
            {isMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </Button>
        </motion.div>

        {/* End Call */}
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            size="icon"
            aria-label={isLeaving ? "Ending date" : "End date"}
            className={`${controlBtn} bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg`}
            style={{
              boxShadow: "0 0 20px hsl(var(--destructive) / 0.4)",
            }}
            onClick={onLeave}
            disabled={isLeaving}
          >
            <PhoneOff className="w-5 h-5" />
          </Button>
        </motion.div>

        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            variant={isVideoOff ? "destructive" : "secondary"}
            size="icon"
            aria-label={isVideoOff ? "Turn camera on" : "Turn camera off"}
            className={`${controlBtn} ${
              !isVideoOff ? quietBtn : ""
            }`}
            onClick={onToggleVideo}
          >
            {isVideoOff ? (
              <VideoOff className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )}
          </Button>
        </motion.div>
      </div>

      {/* Right: in-call safety */}
      {onSafety ? (
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className={`${controlBtn} ${quietBtn}`}
            onClick={onSafety}
            aria-label="Safety and report"
          >
            <Shield className="w-5 h-5 text-primary" />
          </Button>
        </motion.div>
      ) : (
        <div className={`${controlBtn}`} aria-hidden />
      )}
    </motion.div>
  );
};
