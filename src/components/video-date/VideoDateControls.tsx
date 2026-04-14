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
}

export const VideoDateControls = ({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
  onSafety,
}: VideoDateControlsProps) => {
  const controlBtn =
    "h-14 w-14 rounded-full transition-all duration-200";

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.4, type: "spring", stiffness: 220, damping: 22 }}
      className="glass-card px-5 py-3.5 flex items-center justify-between gap-2"
    >
      {/* Left: Profile */}
      <motion.div whileTap={{ scale: 0.9 }}>
        <Button
          variant="secondary"
          size="icon"
          className={`${controlBtn} bg-secondary/60 border border-border/50 hover:bg-secondary`}
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
            className={`${controlBtn} ${
              !isMuted
                ? "bg-secondary/60 border border-border/50 hover:bg-secondary"
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
            className={`${controlBtn} bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg`}
            style={{
              boxShadow: "0 0 20px hsl(var(--destructive) / 0.4)",
            }}
            onClick={onLeave}
          >
            <PhoneOff className="w-5 h-5" />
          </Button>
        </motion.div>

        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            variant={isVideoOff ? "destructive" : "secondary"}
            size="icon"
            className={`${controlBtn} ${
              !isVideoOff
                ? "bg-secondary/60 border border-border/50 hover:bg-secondary"
                : ""
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
            className={`${controlBtn} bg-secondary/60 border border-border/50 hover:bg-secondary`}
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
