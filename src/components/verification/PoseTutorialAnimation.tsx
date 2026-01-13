import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { User, Smile, ArrowRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface PoseTutorialAnimationProps {
  onComplete?: () => void;
  autoPlay?: boolean;
}

const POSES = [
  { 
    id: "straight", 
    label: "Look Straight", 
    icon: "👀", 
    instruction: "Face the camera directly",
    faceRotation: 0,
    faceTranslateX: 0,
  },
  { 
    id: "smile", 
    label: "Smile", 
    icon: "😊", 
    instruction: "Give us your best smile",
    faceRotation: 0,
    faceTranslateX: 0,
    isSmiling: true,
  },
  { 
    id: "left", 
    label: "Turn Left", 
    icon: "👈", 
    instruction: "Slowly turn your head left",
    faceRotation: -25,
    faceTranslateX: -5,
  },
  { 
    id: "right", 
    label: "Turn Right", 
    icon: "👉", 
    instruction: "Slowly turn your head right",
    faceRotation: 25,
    faceTranslateX: 5,
  },
];

export const PoseTutorialAnimation = ({ 
  onComplete, 
  autoPlay = true 
}: PoseTutorialAnimationProps) => {
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setCurrentPoseIndex((prev) => {
        if (prev >= POSES.length - 1) {
          if (onComplete) {
            setTimeout(onComplete, 500);
          }
          return 0;
        }
        return prev + 1;
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [isPlaying, onComplete]);

  const currentPose = POSES[currentPoseIndex];

  return (
    <div className="space-y-6">
      {/* Animated Face Demo */}
      <div className="relative mx-auto w-48 h-56">
        {/* Phone frame */}
        <div className="absolute inset-0 rounded-3xl border-4 border-border bg-secondary/30 overflow-hidden">
          {/* Camera viewfinder effect */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Face oval guide */}
            <motion.div
              className="w-28 h-36 rounded-[50%] border-2 border-dashed border-neon-cyan/50"
              animate={{ 
                borderColor: ["hsl(var(--neon-cyan) / 0.5)", "hsl(var(--neon-cyan))", "hsl(var(--neon-cyan) / 0.5)"]
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            
            {/* Animated face avatar */}
            <motion.div
              className="absolute w-24 h-28 flex items-center justify-center"
              animate={{
                rotateY: currentPose.faceRotation,
                x: currentPose.faceTranslateX,
              }}
              transition={{ type: "spring", stiffness: 100, damping: 15 }}
            >
              {/* Face circle */}
              <div className="relative w-20 h-24 rounded-[50%] bg-gradient-to-b from-amber-200 to-amber-300 flex items-center justify-center overflow-hidden">
                {/* Hair */}
                <div className="absolute top-0 left-2 right-2 h-8 rounded-t-full bg-gradient-to-b from-amber-800 to-amber-700" />
                
                {/* Face features */}
                <div className="relative mt-4 flex flex-col items-center gap-3">
                  {/* Eyes */}
                  <div className="flex gap-4">
                    <motion.div 
                      className="w-3 h-3 rounded-full bg-slate-800"
                      animate={currentPose.isSmiling ? { scaleY: 0.5 } : {}}
                    />
                    <motion.div 
                      className="w-3 h-3 rounded-full bg-slate-800"
                      animate={currentPose.isSmiling ? { scaleY: 0.5 } : {}}
                    />
                  </div>
                  
                  {/* Nose */}
                  <div className="w-1 h-2 rounded-full bg-amber-400" />
                  
                  {/* Mouth */}
                  <motion.div
                    className={cn(
                      "rounded-full bg-rose-400",
                      currentPose.isSmiling ? "w-6 h-3" : "w-4 h-1.5"
                    )}
                    animate={currentPose.isSmiling ? { 
                      borderRadius: "0 0 100px 100px",
                      height: 8,
                    } : {}}
                    transition={{ type: "spring" }}
                  />
                </div>
              </div>
            </motion.div>
          </div>

          {/* Corner brackets */}
          <div className="absolute top-4 left-4 w-6 h-6 border-l-2 border-t-2 border-neon-cyan/60 rounded-tl" />
          <div className="absolute top-4 right-4 w-6 h-6 border-r-2 border-t-2 border-neon-cyan/60 rounded-tr" />
          <div className="absolute bottom-4 left-4 w-6 h-6 border-l-2 border-b-2 border-neon-cyan/60 rounded-bl" />
          <div className="absolute bottom-4 right-4 w-6 h-6 border-r-2 border-b-2 border-neon-cyan/60 rounded-br" />
        </div>

        {/* Instruction bubble */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPose.id}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium whitespace-nowrap shadow-lg"
          >
            <span className="mr-2">{currentPose.icon}</span>
            {currentPose.label}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-2">
        {POSES.map((pose, index) => (
          <motion.button
            key={pose.id}
            onClick={() => setCurrentPoseIndex(index)}
            className={cn(
              "w-2.5 h-2.5 rounded-full transition-all",
              index === currentPoseIndex 
                ? "bg-primary w-6" 
                : index < currentPoseIndex 
                  ? "bg-neon-cyan" 
                  : "bg-secondary"
            )}
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.9 }}
          />
        ))}
      </div>

      {/* Instruction text */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPose.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-center"
        >
          <p className="text-sm text-muted-foreground">{currentPose.instruction}</p>
        </motion.div>
      </AnimatePresence>

      {/* Tips */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
            <span className="text-sm">💡</span>
          </div>
          <p className="text-xs text-muted-foreground">Hold each pose for 2 seconds</p>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <span className="text-sm">☀️</span>
          </div>
          <p className="text-xs text-muted-foreground">Good lighting helps us see you clearly</p>
        </div>
      </div>
    </div>
  );
};
