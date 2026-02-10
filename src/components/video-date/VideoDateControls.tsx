import { motion } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  User,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoDateControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onViewProfile: () => void;
}

export const VideoDateControls = ({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
  onViewProfile,
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

      {/* Right: Add Time (premium) */}
      <motion.div whileTap={{ scale: 0.95 }} className="relative">
        <Button
          variant="secondary"
          size="icon"
          disabled
          className={`${controlBtn} bg-secondary/30 border border-border/30 opacity-40 cursor-not-allowed`}
        >
          <Clock className="w-5 h-5" />
        </Button>
        <div className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-[7px] font-bold text-primary-foreground">
          PRO
        </div>
      </motion.div>
    </motion.div>
  );
};
