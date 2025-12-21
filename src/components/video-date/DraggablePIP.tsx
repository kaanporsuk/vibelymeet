import { motion, useDragControls, PanInfo } from "framer-motion";
import { useState, useRef } from "react";
import { VideoOff } from "lucide-react";

interface DraggablePIPProps {
  isVideoOff: boolean;
  isMicActive: boolean;
  imageSrc: string;
}

export const DraggablePIP = ({ isVideoOff, isMicActive, imageSrc }: DraggablePIPProps) => {
  const constraintsRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragControls = useDragControls();

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Snap to corners
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    const pipWidth = 112;
    const pipHeight = 160;
    const margin = 16;

    const currentX = position.x + info.offset.x;
    const currentY = position.y + info.offset.y;

    // Calculate snap positions
    const snapX = currentX > windowWidth / 2 - pipWidth / 2 
      ? windowWidth - pipWidth - margin - 16 // Right side (accounting for initial right-16)
      : -windowWidth + pipWidth + margin + 16; // Left side

    setPosition({ x: snapX - (windowWidth - pipWidth - 16), y: position.y + info.offset.y });
  };

  return (
    <motion.div
      ref={constraintsRef}
      className="absolute inset-0 pointer-events-none"
    >
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.1}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, scale: 0.8, x: 0, y: 0 }}
        animate={{ 
          opacity: 1, 
          scale: 1,
          x: position.x,
          y: position.y
        }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="absolute top-20 right-4 w-28 h-40 rounded-3xl overflow-hidden pointer-events-auto cursor-grab active:cursor-grabbing"
        style={{
          boxShadow: isMicActive 
            ? "0 0 20px hsl(var(--neon-violet) / 0.6), 0 0 40px hsl(var(--neon-violet) / 0.3), 0 8px 32px rgba(0,0,0,0.4)"
            : "0 8px 32px rgba(0,0,0,0.4)",
          border: isMicActive 
            ? "2px solid hsl(var(--neon-violet) / 0.8)"
            : "2px solid hsl(var(--border) / 0.5)"
        }}
      >
        {/* Mic active indicator ring */}
        {isMicActive && (
          <motion.div
            className="absolute inset-0 rounded-3xl"
            animate={{ 
              boxShadow: [
                "inset 0 0 10px hsl(var(--neon-violet) / 0.3)",
                "inset 0 0 20px hsl(var(--neon-violet) / 0.5)",
                "inset 0 0 10px hsl(var(--neon-violet) / 0.3)"
              ]
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {isVideoOff ? (
          <div className="w-full h-full bg-secondary flex flex-col items-center justify-center gap-2">
            <VideoOff className="w-8 h-8 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Camera off</span>
          </div>
        ) : (
          <img
            src={imageSrc}
            alt="You"
            className="w-full h-full object-cover"
          />
        )}

        {/* Drag handle indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
          <div className="w-8 h-1 bg-white/30 rounded-full" />
        </div>
      </motion.div>
    </motion.div>
  );
};
