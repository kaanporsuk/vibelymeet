import { motion } from "framer-motion";
import { Mic, MicOff, Video, VideoOff, Shield, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
}

export const VideoControls = ({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onLeave,
}: VideoControlsProps) => {
  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
      className="glass-card px-6 py-4 flex items-center justify-center gap-3"
    >
      {/* Mute */}
      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="icon"
          className={`h-12 w-12 rounded-full ${
            !isMuted ? "bg-secondary/80 hover:bg-secondary border border-white/10" : ""
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

      {/* Camera */}
      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="icon"
          className={`h-12 w-12 rounded-full ${
            !isVideoOff ? "bg-secondary/80 hover:bg-secondary border border-white/10" : ""
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

      {/* Divider */}
      <div className="w-px h-8 bg-border mx-1" />

      {/* Safety / Leave */}
      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
        <Button
          variant="secondary"
          size="icon"
          className="h-12 w-12 rounded-full bg-secondary/80 hover:bg-destructive/20 border border-white/10"
          onClick={onLeave}
        >
          <Shield className="w-5 h-5 text-muted-foreground" />
        </Button>
      </motion.div>

      {/* Add Time (disabled/premium) */}
      <motion.div 
        whileHover={{ scale: 1.02 }}
        className="relative"
      >
        <Button
          variant="secondary"
          size="sm"
          disabled
          className="h-12 px-4 rounded-full bg-secondary/40 border border-white/5 opacity-50 cursor-not-allowed"
        >
          <Clock className="w-4 h-4 mr-2" />
          <span className="text-xs">+2m</span>
        </Button>
        
        {/* Premium badge */}
        <div className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-[8px] font-bold text-white">
          PRO
        </div>
      </motion.div>
    </motion.div>
  );
};
