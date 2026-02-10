import { motion } from "framer-motion";
import { VideoOff, MicOff } from "lucide-react";
import { RefObject } from "react";

interface SelfViewPIPProps {
  videoRef: RefObject<HTMLVideoElement>;
  isVideoOff: boolean;
  isMuted: boolean;
  containerRef: RefObject<HTMLDivElement>;
}

export const SelfViewPIP = ({
  videoRef,
  isVideoOff,
  isMuted,
  containerRef,
}: SelfViewPIPProps) => {
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
      className="absolute top-16 right-3 w-[100px] h-[140px] rounded-2xl overflow-hidden z-40 cursor-grab active:cursor-grabbing"
      style={{
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1.5px hsl(var(--primary) / 0.4)",
      }}
    >
      {isVideoOff ? (
        <div className="w-full h-full bg-secondary flex flex-col items-center justify-center gap-1.5">
          <VideoOff className="w-6 h-6 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Camera off</span>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
      )}

      {/* Muted indicator */}
      {isMuted && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-destructive/90 flex items-center justify-center"
        >
          <MicOff className="w-3 h-3 text-destructive-foreground" />
        </motion.div>
      )}

      {/* Speaking indicator ring */}
      {!isMuted && (
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
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
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2">
        <div className="w-6 h-0.5 bg-foreground/30 rounded-full" />
      </div>
    </motion.div>
  );
};
